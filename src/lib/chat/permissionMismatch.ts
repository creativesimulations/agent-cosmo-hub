import type { PermissionsConfig } from "@/lib/permissions";
import type { ChatMessage } from "./types";

export type ActivityThisTurn = {
  shell: number;
  fileWrite: number;
  fileRead: number;
  internet: number;
  script: number;
};

/**
 * Derive inline permission warnings for a completed assistant turn:
 * (a) agent denied capability while Ronbot is set to Allow, or
 * (b) activity ran with no approval prompt while Ronbot is set to Ask.
 */
export function analyzePermissionMismatch(
  reply: string,
  perms: PermissionsConfig,
  activityThisTurn: ActivityThisTurn,
  approvalPromptSeen: number,
): ChatMessage["permissionMismatch"] | undefined {
  const lower = (reply || "").toLowerCase();
  let permissionMismatch: ChatMessage["permissionMismatch"] | undefined;

  const denyPatterns: Array<{
    kind: "internet" | "shell" | "fileWrite" | "fileRead" | "script";
    check: typeof perms.shell;
    re: RegExp;
  }> = [
    {
      kind: "internet",
      check: perms.internet,
      re: /(no internet|cannot access the internet|internet access (?:denied|blocked|disabled)|not (?:allowed|permitted) to (?:access|use) the (?:internet|web|network))/i,
    },
    {
      kind: "shell",
      check: perms.shell,
      re: /(cannot (?:run|execute) (?:the )?(?:shell|command)|shell (?:access|command).*denied|not (?:allowed|permitted) to (?:run|execute) (?:shell|commands))/i,
    },
    {
      kind: "fileWrite",
      check: perms.fileWrite,
      re: /(cannot (?:write|create|edit|modify) (?:the )?file|file write.*denied|not (?:allowed|permitted) to (?:write|create|modify) files)/i,
    },
    {
      kind: "fileRead",
      check: perms.fileRead,
      re: /(cannot (?:read|open|view) (?:the )?file|file read.*denied|not (?:allowed|permitted) to (?:read|open) files)/i,
    },
    {
      kind: "script",
      check: perms.script,
      re: /(cannot (?:run|execute) (?:the )?script|script execution.*denied|not (?:allowed|permitted) to (?:run|execute) scripts)/i,
    },
  ];
  for (const p of denyPatterns) {
    if (p.check === "allow" && p.re.test(lower)) {
      permissionMismatch = { kind: p.kind, agentSetting: "Allow" };
      break;
    }
  }

  if (!permissionMismatch && approvalPromptSeen === 0) {
    const askChecks: Array<{
      kind: "shellNoPrompt" | "fileWriteNoPrompt" | "fileReadNoPrompt" | "internetNoPrompt" | "scriptNoPrompt";
      check: typeof perms.shell;
      count: number;
      label: string;
    }> = [
      { kind: "shellNoPrompt", check: perms.shell, count: activityThisTurn.shell, label: "Shell command" },
      { kind: "fileWriteNoPrompt", check: perms.fileWrite, count: activityThisTurn.fileWrite, label: "File write" },
      { kind: "internetNoPrompt", check: perms.internet, count: activityThisTurn.internet, label: "Internet access" },
      { kind: "scriptNoPrompt", check: perms.script, count: activityThisTurn.script, label: "Script execution" },
      { kind: "fileReadNoPrompt", check: perms.fileRead, count: activityThisTurn.fileRead, label: "File read" },
    ];
    for (const a of askChecks) {
      if (a.check === "ask" && a.count > 0) {
        permissionMismatch = {
          kind: a.kind,
          agentSetting: "Ask each time",
          detail: `${a.label}: ${a.count} call${a.count === 1 ? "" : "s"} ran without prompting.`,
        };
        break;
      }
    }
  }

  return permissionMismatch;
}
