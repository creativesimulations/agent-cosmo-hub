import type { ChatConversation, ChatMessage, ChatPersonaSignature } from "./types";

export const CHAT_STORAGE_KEY = "ronbot-agent-chat-history-v2";
export const SESSION_STORAGE_KEY = "ronbot-agent-chat-session-id-v1";
export const DISK_HISTORY_PATH = ".ronbot/chat-history.json";
export const DISK_SESSION_PATH = ".ronbot/chat-session-id.txt";
export const CONVERSATIONS_STORAGE_KEY = "ronbot-agent-chat-conversations-v1";
export const ACTIVE_CONVERSATION_STORAGE_KEY = "ronbot-agent-chat-active-conversation-id-v1";
export const DISK_CONVERSATIONS_PATH = ".ronbot/chat-conversations.json";
export const DISK_ACTIVE_CONVERSATION_PATH = ".ronbot/chat-active-conversation-id.txt";

type StoredChatMessage = Omit<ChatMessage, "timestamp"> & { timestamp: string };
type StoredPersonaSignature = Omit<ChatPersonaSignature, "capturedAt"> & { capturedAt: string };
type StoredConversation = Omit<ChatConversation, "messages" | "createdAt" | "updatedAt" | "archivedAt" | "personaSignature"> & {
  messages: StoredChatMessage[];
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  personaSignature?: StoredPersonaSignature;
};

export interface ConversationState {
  conversations: ChatConversation[];
  activeConversationId: string;
}

export const resolveHomePath = async (relative: string): Promise<string | null> => {
  if (typeof window === "undefined" || !window.electronAPI) return null;
  try {
    const platform = await window.electronAPI.getPlatform();
    const sep = platform.isWindows ? "\\" : "/";
    return `${platform.homeDir}${sep}${relative.replace(/\//g, sep)}`;
  } catch {
    return null;
  }
};

export const ensureParentDir = async (fullPath: string): Promise<void> => {
  if (typeof window === "undefined" || !window.electronAPI) return;
  try {
    const sep = fullPath.includes("\\") ? "\\" : "/";
    const parent = fullPath.substring(0, fullPath.lastIndexOf(sep));
    if (parent) await window.electronAPI.mkdir(parent);
  } catch {
    /* best effort */
  }
};

const toDate = (value: unknown, fallback = new Date()): Date => {
  if (value instanceof Date) return value;
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
};

export const restoreMessage = (message: StoredChatMessage): ChatMessage => ({
  ...message,
  timestamp: toDate(message.timestamp),
  streaming: false,
  queued: false,
});

const serializeMessage = (message: ChatMessage): StoredChatMessage => ({
  ...message,
  timestamp: message.timestamp.toISOString(),
});

const restorePersonaSignature = (signature?: StoredPersonaSignature): ChatPersonaSignature | undefined => {
  if (!signature || !Array.isArray(signature.files)) return undefined;
  return {
    agentName: signature.agentName,
    files: signature.files.map((f) => ({
      path: String(f.path || ""),
      exists: Boolean(f.exists),
      hash: typeof f.hash === "string" ? f.hash : undefined,
    })),
    capturedAt: toDate(signature.capturedAt),
  };
};

const serializePersonaSignature = (signature?: ChatPersonaSignature): StoredPersonaSignature | undefined => {
  if (!signature) return undefined;
  return {
    agentName: signature.agentName,
    files: signature.files,
    capturedAt: signature.capturedAt.toISOString(),
  };
};

export const deriveConversationTitle = (messages: ChatMessage[]): string => {
  const firstUser = messages.find((m) => m.role === "user" && m.content.trim());
  const source = firstUser?.content || "";
  const compact = source.replace(/\s+/g, " ").trim();
  if (!compact) return "New conversation";
  return compact.length > 42 ? `${compact.slice(0, 39)}...` : compact;
};

export const getConversationPreview = (conversation: ChatConversation): string => {
  const last = [...conversation.messages].reverse().find((m) => m.content.trim());
  const source = last?.content || "";
  const compact = source.replace(/\s+/g, " ").trim();
  if (!compact) return "No messages yet";
  return compact.length > 64 ? `${compact.slice(0, 61)}...` : compact;
};

export const createConversation = (options?: {
  id?: string;
  title?: string;
  messages?: ChatMessage[];
  sessionId?: string | null;
  now?: Date;
  personaSignature?: ChatPersonaSignature;
}): ChatConversation => {
  const now = options?.now ?? new Date();
  const messages = options?.messages ?? [];
  return {
    id: options?.id ?? `conv-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    title: options?.title || deriveConversationTitle(messages),
    messages,
    sessionId: options?.sessionId ?? null,
    createdAt: now,
    updatedAt: messages[messages.length - 1]?.timestamp ?? now,
    personaSignature: options?.personaSignature,
  };
};

const normalizeConversation = (raw: Partial<StoredConversation>): ChatConversation | null => {
  if (!raw || typeof raw.id !== "string") return null;
  const messages = Array.isArray(raw.messages) ? raw.messages.map(restoreMessage) : [];
  const createdAt = toDate(raw.createdAt, messages[0]?.timestamp ?? new Date());
  const updatedAt = toDate(raw.updatedAt, messages[messages.length - 1]?.timestamp ?? createdAt);
  return {
    id: raw.id,
    title: typeof raw.title === "string" && raw.title.trim()
      ? raw.title
      : deriveConversationTitle(messages),
    messages,
    sessionId: typeof raw.sessionId === "string" && raw.sessionId.trim() ? raw.sessionId : null,
    createdAt,
    updatedAt,
    archivedAt: raw.archivedAt ? toDate(raw.archivedAt) : undefined,
    personaSignature: restorePersonaSignature(raw.personaSignature),
  };
};

export const serializeConversations = (
  conversations: ChatConversation[],
  maxStoredMessages = 0,
): string => JSON.stringify(
  conversations.map((conversation): StoredConversation => {
    const messages = maxStoredMessages > 0 && conversation.messages.length > maxStoredMessages
      ? conversation.messages.slice(-maxStoredMessages)
      : conversation.messages;
    return {
      ...conversation,
      messages: messages.map(serializeMessage),
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      archivedAt: conversation.archivedAt?.toISOString(),
      personaSignature: serializePersonaSignature(conversation.personaSignature),
    };
  }),
);

export const parseStoredConversations = (raw: string | null | undefined): ChatConversation[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<StoredConversation>[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeConversation)
      .filter((conversation): conversation is ChatConversation => Boolean(conversation));
  } catch {
    return [];
  }
};

const getActiveIdFromStorage = (conversations: ChatConversation[]): string | null => {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY);
    if (stored && conversations.some((c) => c.id === stored)) return stored;
  } catch {
    /* ignore */
  }
  return null;
};

export const buildConversationState = (
  conversations: ChatConversation[],
  activeConversationId?: string | null,
): ConversationState => {
  const activeConversation =
    conversations.find((c) => c.id === activeConversationId && !c.archivedAt) ||
    conversations.find((c) => !c.archivedAt) ||
    conversations[0] ||
    createConversation();

  const normalized = conversations.some((c) => c.id === activeConversation.id)
    ? conversations
    : [activeConversation, ...conversations];

  return {
    conversations: normalized,
    activeConversationId: activeConversation.id,
  };
};

export const loadStoredConversationState = (options?: {
  autoResumeSession?: boolean;
}): ConversationState => {
  if (typeof window === "undefined") return buildConversationState([]);
  try {
    const raw = window.localStorage.getItem(CONVERSATIONS_STORAGE_KEY);
    const conversations = parseStoredConversations(raw);
    if (conversations.length > 0) {
      return buildConversationState(conversations, getActiveIdFromStorage(conversations));
    }
  } catch {
    /* fall through to legacy migration */
  }

  const legacyMessages = loadStoredMessages();
  const legacySessionId = options?.autoResumeSession === false ? null : loadStoredSessionId();
  const legacy = createConversation({
    messages: legacyMessages,
    sessionId: legacySessionId,
    now: legacyMessages[0]?.timestamp ?? new Date(),
  });
  return buildConversationState([legacy], legacy.id);
};

export const loadStoredMessages = (): ChatMessage[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredChatMessage[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(restoreMessage);
  } catch {
    return [];
  }
};

export const loadStoredSessionId = (): string | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
};
