import type { ToolUnavailableHit } from "@/lib/toolUnavailable";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  streaming?: boolean;
  queued?: boolean;
  cancelled?: boolean;
  missingKey?: { provider: string; envVar: string };
  diagnostics?: string;
  materializeFailed?: boolean;
  permissionMismatch?: {
    kind:
      | "internet"
      | "shell"
      | "fileWrite"
      | "fileRead"
      | "script"
      | "shellNoPrompt"
      | "fileWriteNoPrompt"
      | "fileReadNoPrompt"
      | "internetNoPrompt"
      | "scriptNoPrompt";
    agentSetting: string;
    detail?: string;
  };
  toolUnavailable?: ToolUnavailableHit;
  usedCapabilities?: string[];
}

export interface ChatPersonaFileSignature {
  path: string;
  exists: boolean;
  hash?: string;
}

export interface ChatPersonaSignature {
  agentName?: string | null;
  files: ChatPersonaFileSignature[];
  capturedAt: Date;
}

export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  sessionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt?: Date;
  personaSignature?: ChatPersonaSignature;
}
