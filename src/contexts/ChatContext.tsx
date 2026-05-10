import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { systemAPI } from "@/lib/systemAPI";
import { toast } from "@/hooks/use-toast";
import { useSettings } from "./SettingsContext";
import { handleAgentReplyArrived } from "@/lib/notify";
import { liveSubAgents } from "@/lib/liveSubAgents";
import { detectToolUnavailable } from "@/lib/toolUnavailable";
import { useCapabilities } from "./CapabilitiesContext";
import {
  splitIntentsFromText,
  formatIntentResponse,
  type AgentIntent,
  type IntentResponse,
} from "@/lib/agentIntents";
import { useAgentConnection } from "./AgentConnectionContext";
import {
  CHAT_STORAGE_KEY,
  SESSION_STORAGE_KEY,
  DISK_HISTORY_PATH,
  DISK_SESSION_PATH,
  resolveHomePath,
  ensureParentDir,
  loadStoredMessages,
  loadStoredSessionId,
} from "@/lib/chat/persistence";
import type { ChatMessage } from "@/lib/chat/types";
import { analyzePermissionMismatch } from "@/lib/chat/permissionMismatch";
import { ChatStreamTurnState } from "@/lib/chat/streamHandlers";
import { fireToolUnavailableNotice } from "@/lib/chat/toolUnavailableNotice";

export type { ChatMessage };

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

interface QueueItem {
  /** id of the user message in the chat list */
  userMsgId: string;
  /** id of the assistant placeholder reserved for this turn */
  placeholderId: string;
  prompt: string;
}

interface ChatContextValue {
  messages: ChatMessage[];
  isStreaming: boolean;
  queuedCount: number;
  unreadCount: number;
  sessionId: string | null;
  liveSubAgentCount: number;
  sendMessage: (prompt: string) => Promise<void>;
  stop: () => Promise<void>;
  deleteMessage: (id: string) => void;
  clearAll: () => void;
  markChatViewed: () => void;
  startNewSession: () => void;
  draft: string;
  setDraft: (value: string) => void;
  sendIntentResponse: (
    assistantMsgId: string,
    intent: AgentIntent,
    response: IntentResponse,
  ) => Promise<void>;
  /**
   * True after a personality-update draft is sent. AgentChat shows a
   * "restart now to apply" reminder banner. Cleared when the user dismisses
   * it or restarts the agent.
   */
  personalityRestartPending: boolean;
  markPersonalityDraftSent: () => void;
  clearPersonalityRestart: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export const ChatProvider = ({ children }: { children: ReactNode }) => {
  const { settings } = useSettings();
  const { agentRunning } = useAgentConnection();
  const { recordUse, openCapabilityDecision } = useCapabilities();
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadStoredMessages());
  const [isStreaming, setIsStreaming] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [draft, setDraft] = useState("");
  const [liveSubAgentCount, setLiveSubAgentCount] = useState(0);
  const [personalityRestartPending, setPersonalityRestartPending] = useState(false);
  // Honor "Auto-resume last session" — when disabled, we drop any persisted id
  // so the next message starts a fresh Hermes session.
  const [sessionId, setSessionId] = useState<string | null>(() =>
    settings.autoResumeSession ? loadStoredSessionId() : null,
  );

  // Track the current route via a ref so the async worker can read the
  // latest value without re-creating itself on every navigation.
  const location = useLocation();
  const onChatPageRef = useRef(location.pathname === "/");
  useEffect(() => {
    onChatPageRef.current = location.pathname === "/";
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
  // Mirror to BOTH localStorage (fast/sync) and a disk file under ~/.ronbot
  // (resilient to localStorage wipes in packaged Electron builds).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const max = settings.maxStoredMessages;
    const toStore = max > 0 && messages.length > max ? messages.slice(-max) : messages;
    const serialized = JSON.stringify(
      toStore.map((m) => ({ ...m, timestamp: m.timestamp.toISOString() })),
    );
    try { window.localStorage.setItem(CHAT_STORAGE_KEY, serialized); } catch { /* quota / private mode */ }

    // Mirror to disk asynchronously — never block the render.
    if (window.electronAPI) {
      void (async () => {
        const full = await resolveHomePath(DISK_HISTORY_PATH);
        if (!full) return;
        await ensureParentDir(full);
        await window.electronAPI!.writeFile(full, serialized).catch(() => { /* best effort */ });
      })();
    }
  }, [messages, settings.maxStoredMessages]);

  // On mount: ensure Hermes file logging is enabled (one-time, idempotent)
  // so the SubAgents tab can show post-hoc activity, and hydrate from disk
  // mirror if localStorage was empty.
  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI) return;
    // Best-effort: enable file logging silently. The managed-block writer
    // is a no-op when the block is already present.
    void systemAPI.enableHermesFileLogging?.().catch(() => undefined);
    // Periodically prune completed live sub-agent entries older than 24h.
    const pruneId = window.setInterval(() => liveSubAgents.prune(), 60_000);
    let cancelled = false;
    if (messages.length === 0) {
      void (async () => {
        const histPath = await resolveHomePath(DISK_HISTORY_PATH);
        if (!histPath) return;
        const result = await window.electronAPI!.readFile(histPath).catch(() => null);
        if (cancelled || !result?.success || !result.content) return;
        try {
          const parsed = JSON.parse(result.content) as Array<Omit<ChatMessage, "timestamp"> & { timestamp: string }>;
          if (!Array.isArray(parsed) || parsed.length === 0) return;
          setMessages(parsed.map((m) => ({
            ...m,
            timestamp: new Date(m.timestamp),
            streaming: false,
            queued: false,
          })));
        } catch { /* corrupt file — ignore */ }

        // Also try to recover session id if localStorage lost it.
        if (!sessionIdRef.current) {
          const sidPath = await resolveHomePath(DISK_SESSION_PATH);
          if (!sidPath) return;
          const sidRes = await window.electronAPI!.readFile(sidPath).catch(() => null);
          if (sidRes?.success && sidRes.content) {
            const sid = sidRes.content.trim();
            if (sid) {
              sessionIdRef.current = sid;
              setSessionId(sid);
            }
          }
        }
      })();
    }
    return () => { cancelled = true; window.clearInterval(pruneId); };
    // Run exactly once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the limit is lowered, trim in-memory list to match.
  useEffect(() => {
    const max = settings.maxStoredMessages;
    if (max > 0 && messages.length > max) {
      setMessages((prev) => prev.slice(-max));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.maxStoredMessages]);

  // Persist session id (localStorage + disk mirror) so app restarts can keep
  // talking to the same agent session.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionId) {
      try { window.localStorage.setItem(SESSION_STORAGE_KEY, sessionId); } catch { /* */ }
    } else {
      try { window.localStorage.removeItem(SESSION_STORAGE_KEY); } catch { /* */ }
    }
    if (window.electronAPI) {
      void (async () => {
        const full = await resolveHomePath(DISK_SESSION_PATH);
        if (!full) return;
        await ensureParentDir(full);
        await window.electronAPI!.writeFile(full, sessionId || "").catch(() => { /* best effort */ });
      })();
    }
  }, [sessionId]);

  const markChatViewed = useCallback(() => setUnreadCount(0), []);

  // Auto-clear the unread badge when the user is actually viewing /chat.
  useEffect(() => {
    if (location.pathname === "/") setUnreadCount(0);
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
          const timeoutMs = Math.max(60, settingsRef.current.chatTimeoutSec || 600) * 1000;

          setLiveSubAgentCount(0);
          const streamTurn = new ChatStreamTurnState();
          const onStream = (chunk: { type: string; data?: string }) => {
            streamTurn.handleChunk(chunk, { recordUse, setLiveSubAgentCount });
          };

          const result = await systemAPI.chatAgent(
            item.prompt,
            onStream,
            sessionIdRef.current ?? undefined,
            (id) => { activeStreamIdRef.current = id; },
            timeoutMs,
            settingsRef.current.permissions,
          );

          // Any sub-agents still marked running at end-of-turn must have
          // finished (sub-agents die with their parent turn). This guards
          // against missed completion markers in noisy streams.
          liveSubAgents.finalizeRunning();

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
          } else if (result.sessionId === null && sessionIdRef.current) {
            // Hermes refused our cached resume id and we recovered with a
            // fresh session that didn't print a new id — drop the stale one
            // so we don't keep trying it on every turn.
            sessionIdRef.current = null;
            setSessionId(null);
          }

          const permissionMismatch = analyzePermissionMismatch(
            reply,
            settingsRef.current.permissions,
            streamTurn.activityThisTurn,
            streamTurn.approvalPromptSeen,
          );

          // ── Tool-unavailable detection ──
          // Independent of permissionMismatch — a single reply can hit both.
          const toolUnavailable = result.success && !result.missingKey
            ? detectToolUnavailable(reply)
            : undefined;

          // ── Agent intents ──
          // Pull `ronbot-intent` fenced JSON blocks out of the visible reply.
          // Strips them from the rendered text so the user only sees the
          // surrounding prose; the cards render alongside the bubble.
          const split = result.success && !result.missingKey
            ? splitIntentsFromText(reply)
            : { text: reply, intents: [] as AgentIntent[], errors: [] };

          setMessages((prev) =>
            prev.map((m) =>
              m.id === item.placeholderId
                ? {
                    ...m,
                    content: result.success && !result.missingKey
                      ? split.text
                      : matFailed
                        ? `Failed to sync your secrets to the agent. Open App Diagnostics for the exact shell error.\n\n${result.stderr || ""}`
                        : result.missingKey
                          ? `No API key found for ${result.missingKey.provider}. Add ${result.missingKey.envVar} in the Secrets tab to start chatting.`
                          : `Error: ${result.stderr || reply}`,
                    streaming: false,
                    missingKey: matFailed ? undefined : result.missingKey,
                    diagnostics: result.diagnostics,
                    materializeFailed: matFailed,
                    permissionMismatch,
                    toolUnavailable,
                    usedCapabilities: Array.from(streamTurn.usedCapsThisTurn),
                    intents: split.intents.length > 0 ? split.intents : undefined,
                  }
                : m,
            ),
          );

          // ── LOUD notice: when tool is reported unavailable, run the real
          // readiness probe and surface a persistent toast + modal so the
          // user is never left wondering. The probe overrides the agent's
          // (often hallucinated) self-diagnosis with ground truth.
          if (toolUnavailable) {
            fireToolUnavailableNotice(toolUnavailable, openCapabilityDecision);
          }

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
          setLiveSubAgentCount(0);
        }
      }
    } finally {
      workerRunningRef.current = false;
      stopRequestedRef.current = false;
      setIsStreaming(false);
      setQueuedCount(0);
    }
  }, [openCapabilityDecision, recordUse]);

  const sendMessage = useCallback(async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed) return;
    if (!agentRunning) {
      toast({
        title: "Agent is turned off",
        description: "Turn the agent on from the Dashboard to send messages.",
        variant: "destructive",
      });
      return;
    }

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
  }, [drainQueue, agentRunning]);

  const sendIntentResponse = useCallback(
    async (assistantMsgId: string, intent: AgentIntent, response: IntentResponse) => {
      // Lock the card on the carrier message so it can't be re-submitted.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                intentResponses: { ...(m.intentResponses || {}), [intent.id]: response },
              }
            : m,
        ),
      );
      const { prompt, summary } = formatIntentResponse(response, intent);

      // Send the prompt as the next user turn, but tag the resulting user
      // message with `intentResponseSummary` so the UI can render the
      // redacted summary instead of the raw JSON. We do this by patching
      // the most recent user message after `sendMessage` enqueues it.
      const beforeIds = new Set<string>();
      // Capture current user-msg ids — we'll find the new one by diff.
      setMessages((prev) => {
        for (const m of prev) if (m.role === "user") beforeIds.add(m.id);
        return prev;
      });
      await sendMessage(prompt);
      setMessages((prev) =>
        prev.map((m) =>
          m.role === "user" && !beforeIds.has(m.id) && m.content === prompt.trim()
            ? { ...m, intentResponseSummary: summary }
            : m,
        ),
      );
    },
    [sendMessage],
  );

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
        liveSubAgentCount,
        sendMessage,
        stop,
        deleteMessage,
        clearAll,
        markChatViewed,
        startNewSession,
        draft,
        setDraft,
        sendIntentResponse,
        personalityRestartPending,
        markPersonalityDraftSent: () => setPersonalityRestartPending(true),
        clearPersonalityRestart: () => setPersonalityRestartPending(false),
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
