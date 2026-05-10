import { toast as sonnerToast } from "sonner";
import { capabilityProbe } from "@/lib/capabilityProbe";
import type { ToolUnavailableHit } from "@/lib/toolUnavailable";

const CAP_ID_MAP: Record<string, string> = {
  browser: "webBrowser",
  webSearch: "webSearch",
  imageGen: "imageGen",
  voice: "voice",
  email: "email",
  messaging: "messaging",
  memory: "memory",
  codeInterpreter: "script",
  filesystem: "fileWrite",
};

/**
 * When the agent reports a blocked tool, probe real readiness and surface a
 * long-lived toast with a "Fix it" action (same behavior as ChatContext).
 */
export function fireToolUnavailableNotice(
  toolUnavailable: ToolUnavailableHit,
  openCapabilityDecision: (
    capId: string,
    probe: Awaited<ReturnType<typeof capabilityProbe>>,
    context: string,
  ) => void,
): void {
  const capId = CAP_ID_MAP[toolUnavailable.capability] ?? toolUnavailable.capability;
  void (async () => {
    try {
      const probe = await capabilityProbe(capId);
      sonnerToast(`Ron tried to use ${toolUnavailable.label} and was blocked`, {
        description: probe.message,
        duration: 30_000,
        action: {
          label: "Fix it",
          onClick: () =>
            openCapabilityDecision(
              capId,
              probe,
              `The agent reported: "${toolUnavailable.matchedText.slice(0, 120)}…"`,
            ),
        },
      });
    } catch {
      sonnerToast(`Ron tried to use ${toolUnavailable.label} and was blocked`, {
        description: toolUnavailable.hint,
        duration: 30_000,
      });
    }
  })();
}
