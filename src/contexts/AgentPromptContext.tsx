import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { agentLogs } from "@/lib/diagnostics";
import {
  ensureNotificationPermission,
  showDesktopNotification,
} from "@/lib/notify";
import { useSettings } from "./SettingsContext";
import type { AgentPromptRequest } from "@/lib/agentPromptBridge";
import {
  registerAgentPromptHandler,
  unregisterAgentPromptHandler,
} from "@/lib/agentPromptBridge";

export interface PendingAgentPrompt extends AgentPromptRequest {
  id: string;
  createdAt: number;
  resolve: (answer: string | null) => void;
}

interface AgentPromptContextValue {
  pending: PendingAgentPrompt | null;
  requestAgentPrompt: (req: AgentPromptRequest) => Promise<string | null>;
}

const AgentPromptContext = createContext<(AgentPromptContextValue & { _respond: (answer: string | null) => void }) | null>(null);

export const AgentPromptProvider = ({ children }: { children: ReactNode }) => {
  const { settings } = useSettings();
  const [pending, setPending] = useState<PendingAgentPrompt | null>(null);
  const queueRef = useRef<PendingAgentPrompt[]>([]);
  const settingsRef = useRef(settings);

  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const advanceQueue = useCallback(() => {
    setPending(queueRef.current.shift() ?? null);
  }, []);

  const requestAgentPrompt = useCallback((req: AgentPromptRequest) => {
    return new Promise<string | null>((resolve) => {
      const full: PendingAgentPrompt = {
        ...req,
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        createdAt: Date.now(),
        resolve,
      };

      setPending((prev) => {
        if (!prev) return full;
        queueRef.current.push(full);
        return prev;
      });

      agentLogs.push({
        source: "chat",
        level: "info",
        summary: `[agent-prompt] waiting for user: ${req.prompt}`,
        detail: req.context,
      });

      if (
        settingsRef.current.desktopNotifications &&
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        void ensureNotificationPermission().then((perm) => {
          if (perm === "granted") {
            showDesktopNotification("Ronbot needs your choice", req.prompt.slice(0, 120));
          }
        });
      }
    });
  }, []);

  useEffect(() => {
    const handler = (req: AgentPromptRequest) => requestAgentPrompt(req);
    registerAgentPromptHandler(handler);
    return () => unregisterAgentPromptHandler(handler);
  }, [requestAgentPrompt]);

  const respond = useCallback((answer: string | null) => {
    const current = pending;
    if (!current) return;

    agentLogs.push({
      source: "chat",
      level: answer ? "info" : "warn",
      summary: answer ? "[agent-prompt] user answered setup prompt" : "[agent-prompt] user dismissed setup prompt",
      detail: current.prompt,
    });

    current.resolve(answer);
    advanceQueue();
  }, [advanceQueue, pending]);

  const value = useMemo(
    () => ({ pending, requestAgentPrompt, _respond: respond }),
    [pending, requestAgentPrompt, respond],
  );

  return (
    <AgentPromptContext.Provider value={value}>
      {children}
    </AgentPromptContext.Provider>
  );
};

export const useAgentPrompt = () => {
  const ctx = useContext(AgentPromptContext);
  if (!ctx) throw new Error("useAgentPrompt must be used within AgentPromptProvider");
  return { pending: ctx.pending, requestAgentPrompt: ctx.requestAgentPrompt };
};

export const useRespondToAgentPrompt = () => {
  const ctx = useContext(AgentPromptContext);
  if (!ctx) throw new Error("useRespondToAgentPrompt must be used within AgentPromptProvider");
  return ctx._respond;
};
