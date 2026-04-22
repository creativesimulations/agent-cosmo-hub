import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { systemAPI } from "@/lib/systemAPI";
import { useSettings } from "./SettingsContext";

const AGENT_RUNNING_KEY = "ronbot-agent-running-v1";

interface AgentConnectionValue {
  /** True when we've verified the agent is installed and configured locally. */
  connected: boolean;
  /** Friendly status string for UI display. */
  status: "unknown" | "checking" | "connected" | "disconnected";
  /** Last detection error, if any. */
  error: string | null;
  /** Path / location where the local agent lives. */
  location: string | null;
  /** Whether the agent is "turned on" — chat commands are accepted. */
  agentRunning: boolean;
  /** Toggle the agent on/off. */
  setAgentRunning: (on: boolean) => void;
  /** Re-run detection on demand. */
  refresh: () => Promise<boolean>;
  /** Mark connected immediately (used right after a successful install). */
  markConnected: (location?: string) => void;
}

const AgentConnectionContext = createContext<AgentConnectionValue | null>(null);

export const AgentConnectionProvider = ({ children }: { children: ReactNode }) => {
  const { settings } = useSettings();
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<AgentConnectionValue["status"]>("unknown");
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [agentRunning, setAgentRunningState] = useState<boolean>(() => {
    try {
      const stored = window.localStorage.getItem(AGENT_RUNNING_KEY);
      return stored === null ? true : stored === "true";
    } catch {
      return true;
    }
  });
  const inFlight = useRef(false);
  const autoStartedRef = useRef(false);

  const setAgentRunning = useCallback((on: boolean) => {
    setAgentRunningState(on);
    try {
      window.localStorage.setItem(AGENT_RUNNING_KEY, String(on));
    } catch { /* best effort */ }
    // Notify Electron tray of new state
    if (window.electronAPI?.isElectron) {
      window.electronAPI.runCommand?.("echo noop").catch(() => {});
    }
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return connected;
    inFlight.current = true;
    setStatus("checking");
    setError(null);
    try {
      const configured = await systemAPI.isConfigured();
      if (configured) {
        setConnected(true);
        setStatus("connected");
        setLocation("~/.hermes");
        return true;
      }
      setConnected(false);
      setStatus("disconnected");
      setLocation(null);
      return false;
    } catch (e) {
      setConnected(false);
      setStatus("disconnected");
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      inFlight.current = false;
    }
  }, [connected]);

  const markConnected = useCallback((loc?: string) => {
    setConnected(true);
    setStatus("connected");
    setLocation(loc ?? "~/.hermes");
    setError(null);
  }, []);

  // Initial detection on mount.
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-start the agent (background hermes status warm-up) once after
  // detection if the user enabled it.
  useEffect(() => {
    if (!settings.autoStartAgent || !connected || autoStartedRef.current) return;
    autoStartedRef.current = true;
    void systemAPI.hermesStatus().catch(() => {});
  }, [settings.autoStartAgent, connected]);

  return (
    <AgentConnectionContext.Provider value={{ connected, status, error, location, agentRunning, setAgentRunning, refresh, markConnected }}>
      {children}
    </AgentConnectionContext.Provider>
  );
};

export const useAgentConnection = () => {
  const ctx = useContext(AgentConnectionContext);
  if (!ctx) throw new Error("useAgentConnection must be used within AgentConnectionProvider");
  return ctx;
};
