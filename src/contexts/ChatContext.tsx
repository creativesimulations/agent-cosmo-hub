import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { systemAPI } from "@/lib/systemAPI";
import { toast } from "@/hooks/use-toast";
import { useSettings } from "./SettingsContext";
import { handleAgentReplyArrived } from "@/lib/notify";

/**
 * Chat is hoisted into a top-level context so:
 *   1. The Hermes session id survives navigation — every turn calls
 *      `hermes chat --resume <id>` against the same conversation, so the
 *      agent actually remembers what we just said.
 *   2. An in-flight reply keeps streaming even when the user clicks away
 *      from /chat — the promise lives on the provider, not the page, so
 *      its `setMessages` callback always reaches a mounted component.
 *   3. We can show an unread indicator on the Agent Chat sidebar entry
 *      whenever a reply lands while the user is viewing another route.
 *   4. The user can keep typing/sending while the agent is still replying —
 *      additional prompts are queued and processed strictly in order, so
 *      the agent never sees two "user" turns interleaved out of sequence.
 */

const CHAT_STORAGE_KEY = "ronbot-agent-chat-history-v2";
const SESSION_STORAGE_KEY = "ronbot-agent-chat-session-id-v1";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  /** This message is the assistant placeholder currently being filled. */
  streaming?: boolean;
  /** This is a user message still waiting in the queue. */
  queued?: boolean;
  /** This message was cancelled by the user clicking Stop. */
  cancelled?: boolean;
  missingKey?: { provider: string; envVar: string };
  diagnostics?: string;
  materializeFailed?: boolean;
}

interface QueueItem {
  /** id of the user message in the chat list */
  userMsgId: string;
  /** id of the assistant placeholder reserved for this turn */
  placeholderId: string;
  prompt: string;
}

interface ChatContextValue {
  messages: ChatMessage[];
  /** True while the worker is actively waiting on Hermes for the current turn. */
  isStreaming: boolean;
  /** Number of user prompts queued behind the active turn (does not include the active one). */
  queuedCount: number;
  unreadCount: number;
  sessionId: string | null;
  sendMessage: (prompt: string) => Promise<void>;
  /** Interrupt the active reply and discard everything still queued. */
  stop: () => Promise<void>;
  deleteMessage: (id: string) => void;
  clearAll: () => void;
  /** Reset the unread badge — called when the chat page mounts/focuses. */
  markChatViewed: () => void;
  /** Start a brand-new Hermes session (drops the resume id). */
  startNewSession: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

const loadStoredMessages = (): ChatMessage[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Omit<ChatMessage, "timestamp"> & { timestamp: string }>;
    if (!Array.isArray(parsed)) return [];
    // Drop any half-finished streaming/queued markers from a previous run —
    // they would otherwise confuse the UI on reload.
    return parsed.map((m) => ({
      ...m,
      timestamp: new Date(m.timestamp),
      streaming: false,
      queued: false,
    }));
  } catch {
    return [];
  }
};

const loadStoredSessionId = (): string | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
};

export const ChatProvider = ({ children }: { children: ReactNode }) => {
  const { settings } = useSettings();
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadStoredMessages());
  const [isStreaming, setIsStreaming] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  // Honor "Auto-resume last session" — when disabled, we drop any persisted id
  // so the next message starts a fresh Hermes session.
  const [sessionId, setSessionId] = useState<string | null>(() =>
    settings.autoResumeSession ? loadStoredSessionId() : null,
  );

  // Track the current route via a ref so the async worker can read the
  // latest value without re-creating itself on every navigation.
  const location = useLocation();
  const onChatPageRef = useRef(location.pathname === "/chat");
  useEffect(() => {
    onChatPageRef.current = location.pathname === "/chat";
  }, [location.pathname]);

  // Mirror settings into a ref so the long-lived worker can read the
  // latest sound/notification preferences without re-creating itself.
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // The current Hermes session id is read by the worker on every turn —
  // keep it in a ref so updates from a previous turn are visible to the
  // next dequeue without restarting the worker.
  const sessionIdRef = useRef<string | null>(sessionId);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Worker state: a serial queue + a flag so we never start two turns at once.
  const queueRef = useRef<QueueItem[]>([]);
  const workerRunningRef = useRef(false);
  // streamId of the in-flight Hermes process (so Stop can kill it).
  const activeStreamIdRef = useRef<string | null>(null);
  // Set when the user clicks Stop — the worker checks this and aborts the
  // remaining queue rather than continuing on to the next prompt.
  const stopRequestedRef = useRef(false);

  // Persist messages, capped to settings.maxStoredMessages (0 = unlimited).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const max = settings.maxStoredMessages;
    const toStore = max > 0 && messages.length > max ? messages.slice(-max) : messages;
    window.localStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify(toStore.map((m) => ({ ...m, timestamp: m.timestamp.toISOString() }))),
    );
  }, [messages, settings.maxStoredMessages]);

  // When the limit is lowered, trim in-memory list to match.
  useEffect(() => {
    const max = settings.maxStoredMessages;
    if (max > 0 && messages.length > max) {
      setMessages((prev) => prev.slice(-max));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.maxStoredMessages]);

  // Persist session id so app restarts can keep talking to the same Hermes session.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionId) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    } else {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, [sessionId]);

  const markChatViewed = useCallback(() => setUnreadCount(0), []);

  // Auto-clear the unread badge when the user is actually viewing /chat.
  useEffect(() => {
    if (location.pathname === "/chat") setUnreadCount(0);
  }, [location.pathname]);

  const deleteMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setMessages([]);
    toast({ title: "Conversation cleared", description: "All messages have been removed." });
  }, []);

  const startNewSession = useCallback(() => {
    setSessionId(null);
    sessionIdRef.current = null;
    toast({ title: "New session started", description: "Your next message will start a fresh agent session." });
  }, []);

  /** Process the queue strictly serially. */
  const drainQueue = useCallback(async () => {
    if (workerRunningRef.current) return;
    workerRunningRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        if (stopRequestedRef.current) {
          // Mark every remaining queued user message as cancelled so the user
          // can see what got dropped.
          const dropped = queueRef.current.splice(0);
          setQueuedCount(0);
          setMessages((prev) =>
            prev.map((m) =>
              dropped.some((d) => d.userMsgId === m.id || d.placeholderId === m.id)
                ? { ...m, queued: false, cancelled: true, streaming: false, content: m.content || "(cancelled before sending)" }
                : m,
            ),
          );
          break;
        }

        const item = queueRef.current.shift()!;
        setQueuedCount(queueRef.current.length);

        // Promote the user message out of "queued" state and the placeholder
        // into "streaming" state.
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id === item.userMsgId) return { ...m, queued: false };
            if (m.id === item.placeholderId) return { ...m, streaming: true };
            return m;
          }),
        );
        setIsStreaming(true);

        try {
          const result = await systemAPI.chatAgent(
            item.prompt,
            undefined,
            sessionIdRef.current ?? undefined,
            (id) => { activeStreamIdRef.current = id; },
          );

          // Even on success, if Stop fired during the call, treat as cancelled.
          if (stopRequestedRef.current) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === item.placeholderId
                  ? { ...m, content: "(stopped by user)", streaming: false, cancelled: true }
                  : m,
              ),
            );
            activeStreamIdRef.current = null;
            continue;
          }

          const reply = result.reply || result.stdout?.trim() || "(no response)";
          const matFailed = (result as { materializeFailed?: boolean }).materializeFailed === true;

          if (result.sessionId && result.sessionId !== sessionIdRef.current) {
            sessionIdRef.current = result.sessionId;
            setSessionId(result.sessionId);
          }

          setMessages((prev) =>
            prev.map((m) =>
              m.id === item.placeholderId
                ? {
                    ...m,
                    content: result.success && !result.missingKey
                      ? reply
                      : matFailed
                        ? `Failed to sync your secrets to the agent. Open Diagnostics for the exact shell error.\n\n${result.stderr || ""}`
                        : result.missingKey
                          ? `No API key found for ${result.missingKey.provider}. Add ${result.missingKey.envVar} in the Secrets tab to start chatting.`
                          : `Error: ${result.stderr || reply}`,
                    streaming: false,
                    missingKey: matFailed ? undefined : result.missingKey,
                    diagnostics: result.diagnostics,
                    materializeFailed: matFailed,
                  }
                : m,
            ),
          );

          if (!result.success && !result.missingKey) {
            toast({
              title: matFailed ? "Secret sync failed" : "Agent error",
              description: result.stderr?.split("\n")[0] || "Failed to get a reply from the agent.",
              variant: "destructive",
            });
          }

          if (result.success && !result.missingKey && !matFailed) {
            handleAgentReplyArrived(settingsRef.current, reply);
          }
          if (!onChatPageRef.current) {
            setUnreadCount((n) => n + 1);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === item.placeholderId
                ? { ...m, content: `Error: ${msg}`, streaming: false }
                : m,
            ),
          );
          toast({ title: "Agent error", description: msg, variant: "destructive" });
          if (!onChatPageRef.current) setUnreadCount((n) => n + 1);
        } finally {
          activeStreamIdRef.current = null;
        }
      }
    } finally {
      workerRunningRef.current = false;
      stopRequestedRef.current = false;
      setIsStreaming(false);
      setQueuedCount(0);
    }
  }, []);

  const sendMessage = useCallback(async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed) return;

    // Reserve a user message + an assistant placeholder. They appear instantly
    // even if the worker is still chewing through earlier prompts; the
    // placeholder shows as "queued" until its turn arrives.
    const stamp = Date.now();
    const userMsgId = `${stamp}-u-${Math.random().toString(36).slice(2, 6)}`;
    const placeholderId = `${stamp}-r-${Math.random().toString(36).slice(2, 6)}`;
    const willBeQueued = queueRef.current.length > 0 || workerRunningRef.current;

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", content: trimmed, timestamp: new Date(), queued: willBeQueued },
      { id: placeholderId, role: "assistant", content: "", timestamp: new Date(), streaming: !willBeQueued, queued: willBeQueued },
    ]);

    queueRef.current.push({ userMsgId, placeholderId, prompt: trimmed });
    setQueuedCount(queueRef.current.length - (workerRunningRef.current ? 0 : 1));

    void drainQueue();
  }, [drainQueue]);

  const stop = useCallback(async () => {
    stopRequestedRef.current = true;
    const sid = activeStreamIdRef.current;
    if (sid) {
      await systemAPI.killStream(sid).catch(() => { /* best effort */ });
      activeStreamIdRef.current = null;
    }
    // Mark queued items as cancelled immediately for UI feedback; the worker
    // will also flush them when it loops.
    const dropped = queueRef.current.splice(0);
    if (dropped.length > 0) {
      setMessages((prev) =>
        prev.map((m) =>
          dropped.some((d) => d.userMsgId === m.id || d.placeholderId === m.id)
            ? { ...m, queued: false, cancelled: true, streaming: false, content: m.content || "(cancelled before sending)" }
            : m,
        ),
      );
    }
    setQueuedCount(0);
    toast({ title: "Stopped", description: "The agent was interrupted and any queued messages were cancelled." });
  }, []);

  return (
    <ChatContext.Provider
      value={{
        messages,
        isStreaming,
        queuedCount,
        unreadCount,
        sessionId,
        sendMessage,
        stop,
        deleteMessage,
        clearAll,
        markChatViewed,
        startNewSession,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
};
