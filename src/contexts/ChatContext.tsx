// Hermes v0.13.0 sync — May 2026 (Ronbot)
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useLocation } from "react-router-dom";
import { systemAPI } from "@/lib/systemAPI";
import { toast } from "@/hooks/use-toast";
import { useSettings } from "./SettingsContext";
import { handleAgentReplyArrived } from "@/lib/notify";
import { liveSubAgents } from "@/lib/liveSubAgents";
import { detectToolUnavailable } from "@/lib/toolUnavailable";
import { useCapabilities } from "./CapabilitiesContext";
import { useAgentConnection } from "./AgentConnectionContext";
import {
  ACTIVE_CONVERSATION_STORAGE_KEY,
  CONVERSATIONS_STORAGE_KEY,
  DISK_ACTIVE_CONVERSATION_PATH,
  DISK_CONVERSATIONS_PATH,
  DISK_HISTORY_PATH,
  DISK_SESSION_PATH,
  buildConversationState,
  createConversation,
  deriveConversationTitle,
  ensureParentDir,
  loadStoredConversationState,
  parseStoredConversations,
  resolveHomePath,
  restoreMessage,
  serializeConversations,
} from "@/lib/chat/persistence";
import { capturePersonaSignature, personaSignaturesMatch } from "@/lib/chat/personaSignature";
import type { ChatConversation, ChatMessage, ChatPersonaSignature } from "@/lib/chat/types";
import { analyzePermissionMismatch } from "@/lib/chat/permissionMismatch";
import { ChatStreamTurnState } from "@/lib/chat/streamHandlers";
import { fireToolUnavailableNotice } from "@/lib/chat/toolUnavailableNotice";
import {
  extractTerminalQrMarkers,
  stripHermesMarkers,
  publishHermesMarkers,
  publishDashboardRefresh,
  type HermesMarker,
} from "@/lib/chat/hermesMarkers";
import { mergeHermesMarkers } from "@/lib/chat/mergeHermesMarkers";

export type { ChatConversation, ChatMessage };

interface QueueItem {
  conversationId: string;
  userMsgId: string;
  placeholderId: string;
  prompt: string;
}

export interface PersonaMismatchWarning {
  conversationId: string;
  conversationTitle: string;
  saved: ChatPersonaSignature;
  current: ChatPersonaSignature;
}

interface ChatContextValue {
  messages: ChatMessage[];
  conversations: ChatConversation[];
  activeConversationId: string;
  personaMismatch: PersonaMismatchWarning | null;
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
  startNewConversation: () => Promise<void>;
  switchConversation: (id: string, options?: { force?: boolean }) => Promise<void>;
  archiveConversation: (id: string) => void;
  continueWithCurrentPersona: () => Promise<void>;
  dismissPersonaMismatch: () => void;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  personalityRestartPending: boolean;
  markPersonalityDraftSent: () => void;
  clearPersonalityRestart: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

const isBusy = (worker: React.MutableRefObject<boolean>, queue: React.MutableRefObject<QueueItem[]>) =>
  worker.current || queue.current.length > 0;

const updateMessages = (conversation: ChatConversation, messages: ChatMessage[]): ChatConversation => ({
  ...conversation,
  title: deriveConversationTitle(messages),
  messages,
  updatedAt: messages[messages.length - 1]?.timestamp ?? new Date(),
});

export const ChatProvider = ({ children }: { children: ReactNode }) => {
  const { settings } = useSettings();
  const { agentRunning } = useAgentConnection();
  const { recordUse, openCapabilityDecision } = useCapabilities();
  const initialState = useMemo(
    () => loadStoredConversationState({ autoResumeSession: settings.autoResumeSession }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [conversations, setConversations] = useState<ChatConversation[]>(initialState.conversations);
  const [activeConversationId, setActiveConversationId] = useState(initialState.activeConversationId);
  const [personaMismatch, setPersonaMismatch] = useState<PersonaMismatchWarning | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [draft, setDraft] = useState("");
  const [liveSubAgentCount, setLiveSubAgentCount] = useState(0);
  const [personalityRestartPending, setPersonalityRestartPending] = useState(false);

  const activeConversation =
    conversations.find((c) => c.id === activeConversationId) ||
    conversations.find((c) => !c.archivedAt) ||
    conversations[0] ||
    createConversation();
  const messages = activeConversation.messages;
  const sessionId = activeConversation.sessionId;

  const conversationsRef = useRef(conversations);
  const activeConversationIdRef = useRef(activeConversation.id);
  const messagesRef = useRef(messages);
  const sessionIdRef = useRef<string | null>(sessionId);
  const diskHydratedRef = useRef(false);
  const queueRef = useRef<QueueItem[]>([]);
  const workerRunningRef = useRef(false);
  const activeStreamIdRef = useRef<string | null>(null);
  const stopRequestedRef = useRef(false);

  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => {
    activeConversationIdRef.current = activeConversation.id;
    if (activeConversation.id !== activeConversationId) setActiveConversationId(activeConversation.id);
  }, [activeConversation.id, activeConversationId]);

  const location = useLocation();
  const onChatPageRef = useRef(location.pathname === "/");
  useEffect(() => { onChatPageRef.current = location.pathname === "/"; }, [location.pathname]);

  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const setActiveId = useCallback((id: string) => {
    activeConversationIdRef.current = id;
    const next = conversationsRef.current.find((c) => c.id === id);
    sessionIdRef.current = next?.sessionId ?? null;
    setActiveConversationId(id);
  }, []);

  const patchConversation = useCallback((id: string, patcher: (conversation: ChatConversation) => ChatConversation) => {
    setConversations((prev) => prev.map((conversation) => conversation.id === id ? patcher(conversation) : conversation));
  }, []);

  const patchMessages = useCallback((id: string, patcher: (messages: ChatMessage[]) => ChatMessage[]) => {
    patchConversation(id, (conversation) => updateMessages(conversation, patcher(conversation.messages)));
  }, [patchConversation]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const serialized = serializeConversations(conversations, settings.maxStoredMessages);
    try {
      window.localStorage.setItem(CONVERSATIONS_STORAGE_KEY, serialized);
      window.localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, activeConversation.id);
    } catch {
      /* quota / private mode */
    }
    if (!window.electronAPI || !diskHydratedRef.current) return;
    void (async () => {
      const full = await resolveHomePath(DISK_CONVERSATIONS_PATH);
      if (full) {
        await ensureParentDir(full);
        await window.electronAPI!.writeFile(full, serialized).catch(() => undefined);
      }
      const activePath = await resolveHomePath(DISK_ACTIVE_CONVERSATION_PATH);
      if (activePath) {
        await ensureParentDir(activePath);
        await window.electronAPI!.writeFile(activePath, activeConversation.id).catch(() => undefined);
      }
    })();
  }, [activeConversation.id, conversations, settings.maxStoredMessages]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI) {
      diskHydratedRef.current = true;
      return;
    }
    void systemAPI.enableHermesFileLogging?.().catch(() => undefined);
    const pruneId = window.setInterval(() => liveSubAgents.prune(), 60_000);
    let cancelled = false;
    void (async () => {
      try {
        const hasLocalConversations = window.localStorage.getItem(CONVERSATIONS_STORAGE_KEY);
        if (hasLocalConversations) return;

        const full = await resolveHomePath(DISK_CONVERSATIONS_PATH);
        const activePath = await resolveHomePath(DISK_ACTIVE_CONVERSATION_PATH);
        const [conversationResult, activeResult] = await Promise.all([
          full ? window.electronAPI!.readFile(full).catch(() => null) : Promise.resolve(null),
          activePath ? window.electronAPI!.readFile(activePath).catch(() => null) : Promise.resolve(null),
        ]);
        const diskConversations = parseStoredConversations(conversationResult?.content);
        if (!cancelled && diskConversations.length > 0) {
          const state = buildConversationState(diskConversations, activeResult?.content?.trim());
          conversationsRef.current = state.conversations;
          setConversations(state.conversations);
          setActiveId(state.activeConversationId);
          return;
        }

        const legacyHistoryPath = await resolveHomePath(DISK_HISTORY_PATH);
        const legacySessionPath = await resolveHomePath(DISK_SESSION_PATH);
        const [legacyHistory, legacySession] = await Promise.all([
          legacyHistoryPath ? window.electronAPI!.readFile(legacyHistoryPath).catch(() => null) : Promise.resolve(null),
          legacySessionPath ? window.electronAPI!.readFile(legacySessionPath).catch(() => null) : Promise.resolve(null),
        ]);
        if (!cancelled && legacyHistory?.success && legacyHistory.content) {
          const parsed = JSON.parse(legacyHistory.content);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const legacyMessages = parsed.map(restoreMessage);
            const legacy = createConversation({
              messages: legacyMessages,
              sessionId: settingsRef.current.autoResumeSession ? legacySession?.content?.trim() || null : null,
              now: legacyMessages[0]?.timestamp ?? new Date(),
            });
            conversationsRef.current = [legacy];
            setConversations([legacy]);
            setActiveId(legacy.id);
          }
        }
      } catch {
        /* corrupt disk mirror — ignore */
      } finally {
        diskHydratedRef.current = true;
      }
    })();
    return () => { cancelled = true; window.clearInterval(pruneId); };
  }, [setActiveId]);

  useEffect(() => {
    const max = settings.maxStoredMessages;
    if (max > 0) {
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.messages.length > max
            ? updateMessages(conversation, conversation.messages.slice(-max))
            : conversation,
        ),
      );
    }
  }, [settings.maxStoredMessages]);

  const markChatViewed = useCallback(() => setUnreadCount(0), []);
  useEffect(() => { if (location.pathname === "/") setUnreadCount(0); }, [location.pathname]);

  const deleteMessage = useCallback((id: string) => {
    patchMessages(activeConversationIdRef.current, (prev) => prev.filter((m) => m.id !== id));
  }, [patchMessages]);

  const clearAll = useCallback(() => {
    patchConversation(activeConversationIdRef.current, (conversation) => ({
      ...conversation,
      title: "New conversation",
      messages: [],
      updatedAt: new Date(),
    }));
    toast({ title: "Conversation cleared", description: "All messages have been removed from this conversation." });
  }, [patchConversation]);

  const startNewConversation = useCallback(async () => {
    if (isBusy(workerRunningRef, queueRef)) {
      toast({ title: "Agent is busy", description: "Wait for the current reply to finish before switching conversations." });
      return;
    }
    const personaSignature = await capturePersonaSignature().catch(() => undefined);
    const conversation = createConversation({ personaSignature });
    setConversations((prev) => [conversation, ...prev]);
    conversationsRef.current = [conversation, ...conversationsRef.current];
    setActiveId(conversation.id);
    setPersonaMismatch(null);
    toast({ title: "New conversation", description: "Your next message will start a fresh agent session." });
  }, [setActiveId]);

  const startNewSession = useCallback(() => { void startNewConversation(); }, [startNewConversation]);

  const switchConversation = useCallback(async (id: string, options?: { force?: boolean }) => {
    if (id === activeConversationIdRef.current) return;
    if (isBusy(workerRunningRef, queueRef)) {
      toast({ title: "Agent is busy", description: "Wait for the current reply to finish before switching conversations." });
      return;
    }
    const target = conversationsRef.current.find((conversation) => conversation.id === id);
    if (!target || target.archivedAt) return;
    const currentSignature = await capturePersonaSignature().catch(() => undefined);
    if (!options?.force && target.personaSignature && currentSignature && !personaSignaturesMatch(target.personaSignature, currentSignature)) {
      setPersonaMismatch({ conversationId: target.id, conversationTitle: target.title, saved: target.personaSignature, current: currentSignature });
      return;
    }
    if (currentSignature && (options?.force || !target.personaSignature)) {
      patchConversation(target.id, (conversation) => ({ ...conversation, personaSignature: currentSignature, updatedAt: new Date() }));
    }
    setPersonaMismatch(null);
    setActiveId(target.id);
  }, [patchConversation, setActiveId]);

  const archiveConversation = useCallback((id: string) => {
    if (isBusy(workerRunningRef, queueRef)) {
      toast({ title: "Agent is busy", description: "Wait for the current reply to finish before archiving conversations." });
      return;
    }
    const now = new Date();
    const isActive = id === activeConversationIdRef.current;
    const nextActive = isActive ? conversationsRef.current.find((c) => c.id !== id && !c.archivedAt) : undefined;
    const replacement = isActive && !nextActive ? createConversation({ now }) : undefined;
    setConversations((prev) => {
      const archived = prev.map((conversation) =>
        conversation.id === id ? { ...conversation, archivedAt: now, updatedAt: now } : conversation,
      );
      return replacement ? [replacement, ...archived] : archived;
    });
    if (replacement) conversationsRef.current = [replacement, ...conversationsRef.current];
    if (isActive) setActiveId(nextActive?.id || replacement?.id || id);
    if (personaMismatch?.conversationId === id) setPersonaMismatch(null);
    toast({ title: "Conversation archived", description: "It has been removed from the active list." });
  }, [personaMismatch?.conversationId, setActiveId]);

  const continueWithCurrentPersona = useCallback(async () => {
    if (personaMismatch?.conversationId) await switchConversation(personaMismatch.conversationId, { force: true });
  }, [personaMismatch?.conversationId, switchConversation]);

  const dismissPersonaMismatch = useCallback(() => setPersonaMismatch(null), []);

  const drainQueue = useCallback(async () => {
    if (workerRunningRef.current) return;
    workerRunningRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        if (stopRequestedRef.current) {
          const dropped = queueRef.current.splice(0);
          setQueuedCount(0);
          for (const item of dropped) {
            patchMessages(item.conversationId, (prev) =>
              prev.map((m) =>
                item.userMsgId === m.id || item.placeholderId === m.id
                  ? { ...m, queued: false, cancelled: true, streaming: false, content: m.content || "(cancelled before sending)" }
                  : m,
              ),
            );
          }
          break;
        }

        const item = queueRef.current.shift()!;
        setQueuedCount(queueRef.current.length);
        patchMessages(item.conversationId, (prev) =>
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
          const result = await systemAPI.chatAgent(
            item.prompt,
            (chunk: { type: string; data?: string }) => {
              streamTurn.handleChunk(chunk, { recordUse, setLiveSubAgentCount });
              if (chunk.type !== "stdout" && chunk.type !== "stderr") return;
              const qrMarkers = extractTerminalQrMarkers(streamTurn.streamBuf);
              if (!qrMarkers.length) return;
              patchMessages(item.conversationId, (prev) =>
                prev.map((m) =>
                  m.id === item.placeholderId
                    ? { ...m, inlineMarkers: mergeHermesMarkers(m.inlineMarkers, qrMarkers) }
                    : m,
                ),
              );
            },
            sessionIdRef.current ?? undefined,
            (id) => { activeStreamIdRef.current = id; },
            timeoutMs,
            settingsRef.current.permissions,
          );

          liveSubAgents.finalizeRunning();
          if (stopRequestedRef.current) {
            patchMessages(item.conversationId, (prev) =>
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
            patchConversation(item.conversationId, (conversation) => ({ ...conversation, sessionId: result.sessionId ?? null }));
          } else if (result.sessionId === null && sessionIdRef.current) {
            sessionIdRef.current = null;
            patchConversation(item.conversationId, (conversation) => ({ ...conversation, sessionId: null }));
          }

          const currentConversation = conversationsRef.current.find((c) => c.id === item.conversationId);
          if (currentConversation && !currentConversation.personaSignature) {
            const signature = await capturePersonaSignature().catch(() => undefined);
            if (signature) patchConversation(item.conversationId, (conversation) => ({ ...conversation, personaSignature: signature }));
          }

          const permissionMismatch = analyzePermissionMismatch(
            reply,
            settingsRef.current.permissions,
            streamTurn.activityThisTurn,
            streamTurn.approvalPromptSeen,
          );
          const toolUnavailable = result.success && !result.missingKey ? detectToolUnavailable(reply) : undefined;
          let assistantVisible = reply;
          let inlineMarkers: HermesMarker[] | undefined;
          if (result.success && !result.missingKey && !matFailed) {
            const stripped = stripHermesMarkers(reply);
            assistantVisible = stripped.text;
            inlineMarkers = mergeHermesMarkers(
              mergeHermesMarkers(undefined, stripped.markers),
              extractTerminalQrMarkers(result.stdout || ""),
            );
            const modalMarkers = stripped.markers.filter((m) => m.kind === "password");
            if (modalMarkers.length) publishHermesMarkers(modalMarkers);
            if (stripped.dashboardRefresh) publishDashboardRefresh();
          }

          patchMessages(item.conversationId, (prev) =>
            prev.map((m) =>
              m.id === item.placeholderId
                ? {
                    ...m,
                    content: result.success && !result.missingKey
                      ? assistantVisible
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
                    inlineMarkers: inlineMarkers?.length ? inlineMarkers : m.inlineMarkers,
                  }
                : m,
            ),
          );

          if (toolUnavailable) fireToolUnavailableNotice(toolUnavailable, openCapabilityDecision);
          if (!result.success && !result.missingKey) {
            toast({
              title: matFailed ? "Secret sync failed" : "Agent error",
              description: result.stderr?.split("\n")[0] || "Failed to get a reply from the agent.",
              variant: "destructive",
            });
          }
          if (result.success && !result.missingKey && !matFailed) handleAgentReplyArrived(settingsRef.current, reply);
          if (!onChatPageRef.current) setUnreadCount((n) => n + 1);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          patchMessages(item.conversationId, (prev) =>
            prev.map((m) => m.id === item.placeholderId ? { ...m, content: `Error: ${msg}`, streaming: false } : m),
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
  }, [openCapabilityDecision, patchConversation, patchMessages, recordUse]);

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

    const conversationId = activeConversationIdRef.current;
    const stamp = Date.now();
    const userMsgId = `${stamp}-u-${Math.random().toString(36).slice(2, 6)}`;
    const placeholderId = `${stamp}-r-${Math.random().toString(36).slice(2, 6)}`;
    const willBeQueued = queueRef.current.length > 0 || workerRunningRef.current;

    patchMessages(conversationId, (prev) => [
      ...prev,
      { id: userMsgId, role: "user", content: trimmed, timestamp: new Date(), queued: willBeQueued },
      { id: placeholderId, role: "assistant", content: "", timestamp: new Date(), streaming: !willBeQueued, queued: willBeQueued },
    ]);
    queueRef.current.push({ conversationId, userMsgId, placeholderId, prompt: trimmed });
    setQueuedCount(queueRef.current.length - (workerRunningRef.current ? 0 : 1));
    void drainQueue();
  }, [agentRunning, drainQueue, patchMessages]);

  const stop = useCallback(async () => {
    stopRequestedRef.current = true;
    const sid = activeStreamIdRef.current;
    if (sid) {
      await systemAPI.killStream(sid).catch(() => undefined);
      activeStreamIdRef.current = null;
    }
    const dropped = queueRef.current.splice(0);
    for (const item of dropped) {
      patchMessages(item.conversationId, (prev) =>
        prev.map((m) =>
          item.userMsgId === m.id || item.placeholderId === m.id
            ? { ...m, queued: false, cancelled: true, streaming: false, content: m.content || "(cancelled before sending)" }
            : m,
        ),
      );
    }
    setQueuedCount(0);
    toast({ title: "Stopped", description: "The agent was interrupted and any queued messages were cancelled." });
  }, [patchMessages]);

  return (
    <ChatContext.Provider
      value={{
        messages,
        conversations,
        activeConversationId: activeConversation.id,
        personaMismatch,
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
        startNewConversation,
        switchConversation,
        archiveConversation,
        continueWithCurrentPersona,
        dismissPersonaMismatch,
        draft,
        setDraft,
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
