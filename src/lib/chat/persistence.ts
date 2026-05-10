import type { ChatMessage } from "./types";

export const CHAT_STORAGE_KEY = "ronbot-agent-chat-history-v2";
export const SESSION_STORAGE_KEY = "ronbot-agent-chat-session-id-v1";
export const DISK_HISTORY_PATH = ".ronbot/chat-history.json";
export const DISK_SESSION_PATH = ".ronbot/chat-session-id.txt";

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

export const loadStoredMessages = (): ChatMessage[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Omit<ChatMessage, "timestamp"> & { timestamp: string }>;
    if (!Array.isArray(parsed)) return [];
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

export const loadStoredSessionId = (): string | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
};
