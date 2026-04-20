import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { systemAPI } from "@/lib/systemAPI";
import { toast } from "@/hooks/use-toast";

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
 */

const CHAT_STORAGE_KEY = "ainoval-agent-chat-history-v2";
const SESSION_STORAGE_KEY = "ainoval-agent-chat-session-id-v1";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  streaming?: boolean;
  missingKey?: { provider: string; envVar: string };
  diagnostics?: string;
  materializeFailed?: boolean;
}

interface ChatContextValue {
  messages: ChatMessage[];
  isStreaming: boolean;
  unreadCount: number;
  sessionId: string | null;
  sendMessage: (prompt: string) => Promise<void>;
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
    return parsed.map((m) => ({ ...m, timestamp: new Date(m.timestamp), streaming: false }));
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
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadStoredMessages());
  const [isStreaming, setIsStreaming] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(() => loadStoredSessionId());

  // Track the current route via a ref so the async sendMessage callback can
  // read the latest value without re-creating itself on every navigation.
  const location = useLocation();
  const onChatPageRef = useRef(location.pathname === "/chat");
  useEffect(() => {
    onChatPageRef.current = location.pathname === "/chat";
  }, [location.pathname]);

  // Persist messages.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify(messages.map((m) => ({ ...m, timestamp: m.timestamp.toISOString() }))),
    );
  }, [messages]);

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
    toast({ title: "New session started", description: "Your next message will start a fresh agent session." });
  }, []);

  const sendMessage = useCallback(async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed || isStreaming) return;

    const placeholderId = `${Date.now()}-r`;
    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), role: "user", content: trimmed, timestamp: new Date() },
      { id: placeholderId, role: "assistant", content: "", timestamp: new Date(), streaming: true },
    ]);
    setIsStreaming(true);

    try {
      // Pass the persisted session id so Hermes resumes the same conversation
      // instead of opening a fresh session every turn.
      const result = await systemAPI.chatAgent(trimmed, undefined, sessionId ?? undefined);
      const reply = result.reply || result.stdout?.trim() || "(no response)";
      const matFailed = (result as { materializeFailed?: boolean }).materializeFailed === true;

      // Capture the session id Hermes returned so the next turn resumes it.
      if (result.sessionId && result.sessionId !== sessionId) {
        setSessionId(result.sessionId);
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === placeholderId
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

      // Bump unread count if the user isn't currently looking at the chat.
      if (!onChatPageRef.current) {
        setUnreadCount((n) => n + 1);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === placeholderId ? { ...m, content: `Error: ${msg}`, streaming: false } : m,
        ),
      );
      toast({ title: "Agent error", description: msg, variant: "destructive" });
      if (!onChatPageRef.current) setUnreadCount((n) => n + 1);
    } finally {
      setIsStreaming(false);
    }
  }, [isStreaming, sessionId]);

  return (
    <ChatContext.Provider
      value={{
        messages,
        isStreaming,
        unreadCount,
        sessionId,
        sendMessage,
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
