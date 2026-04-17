import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { systemAPI } from "@/lib/systemAPI";

interface AgentConnectionValue {
  /** True when we've verified the agent is installed and configured locally. */
  connected: boolean;
  /** Friendly status string for UI display. */
  status: "unknown" | "checking" | "connected" | "disconnected";
  /** Last detection error, if any. */
  error: string | null;
  /** Path / location where the local agent lives. */
  location: string | null;
  /** Re-run detection on demand. */
  refresh: () => Promise<boolean>;
  /** Mark connected immediately (used right after a successful install). */
  markConnected: (location?: string) => void;
}

const AgentConnectionContext = createContext<AgentConnectionValue | null>(null);

export const AgentConnectionProvider = ({ children }: { children: ReactNode }) => {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<AgentConnectionValue["status"]>("unknown");
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return connected;
    inFlight.current = true;
    setStatus("checking");
    setError(null);
    try {
      // The local agent is "connected" if its config dir exists. We don't
      // require a running HTTP server because Hermes is a local CLI, not a
      // web service.
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

  return (
    <AgentConnectionContext.Provider value={{ connected, status, error, location, refresh, markConnected }}>
      {children}
    </AgentConnectionContext.Provider>
  );
};

export const useAgentConnection = () => {
  const ctx = useContext(AgentConnectionContext);
  if (!ctx) throw new Error("useAgentConnection must be used within AgentConnectionProvider");
  return ctx;
};
