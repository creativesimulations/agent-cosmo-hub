import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { systemAPI } from "@/lib/systemAPI";
import { useSettings } from "./SettingsContext";

const AGENT_RUNNING_KEY = "ronbot-agent-running-v1";
const CONNECTED_SINCE_KEY = "ronbot-connected-since-v1";
const FROZEN_UPTIME_KEY = "ronbot-frozen-uptime-v1";

interface AgentConnectionValue {
  connected: boolean;
  status: "unknown" | "checking" | "connected" | "disconnected";
  error: string | null;
  location: string | null;
  agentRunning: boolean;
  setAgentRunning: (on: boolean) => void;
  refresh: () => Promise<boolean>;
  markConnected: (location?: string) => void;
  /** Epoch ms when the current uptime period began (null if agent is off). */
  connectedSince: number | null;
  /** Frozen elapsed ms from the last run, shown while agent is off. */
  frozenUptimeMs: number | null;
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
  const [connectedSince, setConnectedSince] = useState<number | null>(() => {
    try {
      const raw = window.localStorage.getItem(CONNECTED_SINCE_KEY);
      const n = raw ? parseInt(raw, 10) : NaN;
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  });
  const inFlight = useRef(false);
  const autoStartedRef = useRef(false);

  // Stamp / clear the connection start time so uptime survives tab switches
  // and route changes. Lives at the app-wide context level (not inside
  // Dashboard) so the timer keeps ticking even when the Dashboard tab has
  // never been opened in this session.
  useEffect(() => {
    if (connected) {
      if (connectedSince === null) {
        const now = Date.now();
        try { window.localStorage.setItem(CONNECTED_SINCE_KEY, String(now)); } catch { /* ignore */ }
        setConnectedSince(now);
      }
    } else {
      if (connectedSince !== null) {
        try { window.localStorage.removeItem(CONNECTED_SINCE_KEY); } catch { /* ignore */ }
        setConnectedSince(null);
      }
    }
  }, [connected, connectedSince]);

  const setAgentRunning = useCallback((on: boolean) => {
    setAgentRunningState(on);
    try {
      window.localStorage.setItem(AGENT_RUNNING_KEY, String(on));
    } catch { /* best effort */ }
    // Update tray tooltip to reflect agent state
    void systemAPI.setAgentRunningState(on);
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

  // Listen for tray-menu toggles so the Dashboard switch stays in sync.
  useEffect(() => {
    if (!window.electronAPI?.onAgentRunningChanged) return;
    const unsubscribe = window.electronAPI.onAgentRunningChanged((running) => {
      setAgentRunningState(running);
      try {
        window.localStorage.setItem(AGENT_RUNNING_KEY, String(running));
      } catch { /* best effort */ }
    });
    return unsubscribe;
  }, []);

  // On mount, push current state to Electron so the tray reflects it.
  useEffect(() => {
    void systemAPI.setAgentRunningState(agentRunning);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AgentConnectionContext.Provider value={{ connected, status, error, location, agentRunning, setAgentRunning, refresh, markConnected, connectedSince }}>
      {children}
    </AgentConnectionContext.Provider>
  );
};

export const useAgentConnection = () => {
  const ctx = useContext(AgentConnectionContext);
  if (!ctx) throw new Error("useAgentConnection must be used within AgentConnectionProvider");
  return ctx;
};
