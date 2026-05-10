import { useEffect } from "react";
import { systemAPI } from "@/lib/systemAPI";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";

/**
 * Once per session (after the agent is connected), refresh the Ronbot UI
 * protocol primer in ~/.hermes/AGENTS.md so the agent knows how to emit
 * `ronbot-intent` cards. Idempotent and cheap — just a file diff/write.
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
