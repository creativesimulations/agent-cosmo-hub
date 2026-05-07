import { useEffect } from "react";
import { systemAPI } from "@/lib/systemAPI";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";

/**
 * Once per session (after the agent is connected), refresh the Ronbot UI
 * protocol primer in ~/.hermes/AGENTS.md so the agent knows how to emit
 * `ronbot-intent` cards. Idempotent and cheap — just a file diff/write.
 */
const RonbotRulesBridge = () => {
  const { connected } = useAgentConnection();
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    (async () => {
      try {
        if (cancelled) return;
        await systemAPI.writeRonbotAgentRules?.();
      } catch {
        /* best effort */
      }
    })();
    return () => { cancelled = true; };
  }, [connected]);
  return null;
};

export default RonbotRulesBridge;
