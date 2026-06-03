import { useEffect } from "react";
import { systemAPI } from "@/lib/systemAPI";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";

/**
 * Once per session (after the agent is connected), refresh neutral Ronbot UI
 * protocol docs on disk (optional intents/markers). Does not change Hermes behavior.
 */
export function useRonbotRulesBridge(): void {
  const { connected } = useAgentConnection();
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    void (async () => {
      try {
        if (cancelled) return;
        await Promise.all([
          systemAPI.writeRonbotAgentRules?.(),
          systemAPI.writeRonbotAppGuide?.(),
          systemAPI.writeElectronAppGuide?.(),
        ]);
      } catch {
        /* best effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connected]);
}
