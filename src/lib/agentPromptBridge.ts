import type { AgentPromptDetection } from "@/lib/chat/agentPromptDetection";

export interface AgentPromptRequest extends AgentPromptDetection {
  source?: "chat" | "setup" | "install";
}

type Handler = (req: AgentPromptRequest) => Promise<string | null>;

let handler: Handler | null = null;

export const registerAgentPromptHandler = (h: Handler) => { handler = h; };
export const unregisterAgentPromptHandler = (h: Handler) => { if (handler === h) handler = null; };
export const getAgentPromptHandler = (): Handler | null => handler;
