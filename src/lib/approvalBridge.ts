/**
 * Bridge between the non-React Hermes runner (src/lib/systemAPI/hermes.ts)
 * and the React PermissionsContext.
 *
 * The chat() function in hermes.ts is a plain async function — it can't call
 * `usePermissions()`. So PermissionsProvider registers a global handler here
 * on mount, and hermes.ts pulls it via `getApprovalHandler()` whenever it
 * detects an interactive prompt in the agent's streamed output.
 */

import {
  ApprovalChoice,
  PermissionAction,
  PermissionEvent,
} from "./permissions";

export interface ApprovalRequest {
  action: PermissionAction;
  target: string;
  reason?: string;
}

type Handler = (req: ApprovalRequest) => Promise<ApprovalChoice>;
type EventRecorder = (event: Omit<PermissionEvent, "id" | "timestamp">) => void;

let handler: Handler | null = null;
let recorder: EventRecorder | null = null;

export const registerApprovalHandler = (h: Handler) => { handler = h; };
export const unregisterApprovalHandler = (h: Handler) => { if (handler === h) handler = null; };
export const getApprovalHandler = (): Handler | null => handler;

export const registerEventRecorder = (r: EventRecorder) => { recorder = r; };
export const unregisterEventRecorder = (r: EventRecorder) => { if (recorder === r) recorder = null; };
export const recordPermissionEvent = (event: Omit<PermissionEvent, "id" | "timestamp">) => {
  recorder?.(event);
};

// ─── Prompt detection ────────────────────────────────────────
//
// The Hermes CLI prints an inline approval prompt that looks like:
//
//   <command preview>
//   [o]nce  |  [s]ession  |  [a]lways  |  [d]eny
//   Choice [o/s/a/D]:
//
// We detect that final "Choice [o/s/a/D]:" line in the streamed stdout to
// know we need to show our dialog. The few lines preceding it usually
// describe what the agent was about to do (the command, the file path,
// etc.) — we capture them as the dialog's "what" body.

// Multiple shapes the agent might emit — different Hermes versions and tool
// adapters word their prompts differently. We accept any of them as a signal
// to pop the approval modal.
export const APPROVAL_PROMPT_PATTERNS: RegExp[] = [
  /Choice\s*\[\s*o\s*\/\s*s\s*\/\s*a\s*\/\s*D?\s*\]\s*:/i,
  /\[\s*o\s*\]\s*nce\s*[|/]\s*\[\s*s\s*\]\s*ession\s*[|/]\s*\[\s*a\s*\]\s*lways\s*[|/]\s*\[\s*d\s*\]\s*eny/i,
  /Approve\??\s*\(\s*o\s*\/\s*s\s*\/\s*a\s*\/\s*d\s*\)/i,
  /Permission\s+required/i,
  /Awaiting\s+approval/i,
  /Allow\s+this\s+(action|command|operation)\??/i,
  /\(once\s*\/\s*session\s*\/\s*always\s*\/\s*deny\)/i,
];

export const APPROVAL_PROMPT_RE = APPROVAL_PROMPT_PATTERNS[0];

/** True if any known approval-prompt pattern matches. */
export const matchesApprovalPrompt = (text: string): boolean => {
  for (const re of APPROVAL_PROMPT_PATTERNS) if (re.test(text)) return true;
  return false;
};

/** Crude classifier — guess the action from the prompt context. */
export const guessAction = (context: string): PermissionAction => {
  const t = context.toLowerCase();
  if (/sub[-\s]?agent|delegate_task|spawn.*agent/.test(t)) return "subAgent";
  if (/fetch|http|https?:|curl|wget|download/.test(t)) return "internet";
  if (/python|node\b|bash\b|\.py\b|\.js\b|\.sh\b|run script/.test(t)) return "script";
  if (/write file|edit file|patch|create file|save to|>\s*\S+|→\s*\S+/.test(t)) return "fileWrite";
  if (/read file|read\s+["']|cat\s+["']|view\s+["']/.test(t)) return "fileRead";
  return "shell";
};

/** Map a user choice to the single character Hermes expects on stdin. */
export const choiceToStdin = (choice: ApprovalChoice): string => {
  switch (choice) {
    case "once": return "o\n";
    case "session": return "s\n";
    case "always": return "a\n";
    case "deny": return "d\n";
  }
};
