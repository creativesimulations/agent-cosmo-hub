/**
 * Permission types & helpers shared by SettingsContext, PermissionsContext,
 * the approval dialog, and the Hermes prompt detector.
 *
 * The agent has 6 broad permission classes. Each can be set to one of three
 * defaults the renderer enforces BEFORE the agent ever asks:
 *   - 'allow'  — auto-approve, no dialog
 *   - 'deny'   — auto-deny, no dialog
 *   - 'ask'    — pop the approval dialog
 *
 * Path-scoped classes (file reads/writes) also support an "allow inside
 * listed folders" mode via `scope: 'scoped'`. Anything outside falls back
 * to the chosen `outOfScope` policy ('ask' or 'deny').
 */

export type PermissionDefault = 'allow' | 'ask' | 'deny';
export type PermissionScope = 'anywhere' | 'scoped';

export type PermissionAction =
  | 'shell'        // run any shell command
  | 'shellSafe'    // read-only commands (ls, cat, pwd, …) — used as a relaxation of `shell`
  | 'fileRead'
  | 'fileWrite'
  | 'internet'
  | 'script'       // python / node / bash scripts
  | 'browser'      // browser_* tools (navigate, click, type, screenshot)
  | 'codeExecution'// hermes-cli code_execution tool
  | 'delegation'   // spawn sub-agents
  | 'cronjob'      // schedule recurring tasks
  | 'messaging'    // send messages on telegram/discord/slack/etc.
  | 'imageGen'     // image generation tools
  | 'tts';         // text-to-speech / voice

export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny';

/**
 * The persisted shape stored on `AppSettings.permissions`. Designed so a
 * future field addition stays backwards-compatible (just set defaults in
 * SettingsContext.DEFAULT_SETTINGS.permissions).
 */
export interface PermissionsConfig {
  shell: PermissionDefault;
  /** Auto-allow obviously safe read-only commands even when `shell` is 'ask'. */
  shellAllowReadOnly: boolean;

  fileRead: PermissionDefault;
  fileReadScope: PermissionScope;
  fileWrite: PermissionDefault;
  fileWriteScope: PermissionScope;

  internet: PermissionDefault;
  script: PermissionDefault;

  // Per-tool defaults aligned with the official `hermes-cli` toolset.
  browser: PermissionDefault;
  codeExecution: PermissionDefault;
  delegation: PermissionDefault;
  cronjob: PermissionDefault;
  messaging: PermissionDefault;
  imageGen: PermissionDefault;
  tts: PermissionDefault;

  /** Folders the agent may freely read/write inside (when scope = 'scoped'). */
  allowedFolders: string[];
  /** Folders the agent must never touch — overrides everything else. */
  blockedFolders: string[];

  /** What to do when no rule matches (no specific class hit). */
  fallback: PermissionDefault;
}

export const DEFAULT_PERMISSIONS: PermissionsConfig = {
  shell: 'ask',
  shellAllowReadOnly: true,
  fileRead: 'allow',
  fileReadScope: 'scoped',
  fileWrite: 'ask',
  fileWriteScope: 'scoped',
  // Internet defaults to allow so basic web_search / web_extract work
  // immediately after install — the #1 user complaint when this was 'ask'.
  internet: 'allow',
  script: 'ask',
  browser: 'ask',
  codeExecution: 'ask',
  delegation: 'allow',
  cronjob: 'ask',
  messaging: 'ask',
  imageGen: 'allow',
  tts: 'allow',
  allowedFolders: [],
  blockedFolders: [],
  fallback: 'ask',
};

export const PERMISSION_LABELS: Record<PermissionAction, string> = {
  shell: 'Shell command',
  shellSafe: 'Safe shell command',
  fileRead: 'File read',
  fileWrite: 'File write',
  internet: 'Internet access',
  script: 'Script execution',
  browser: 'Browser automation',
  codeExecution: 'Code execution',
  delegation: 'Spawn sub-agents',
  cronjob: 'Scheduled tasks',
  messaging: 'Send messages',
  imageGen: 'Image generation',
  tts: 'Text-to-speech',
};

export const RISK_BY_ACTION: Record<PermissionAction, 'low' | 'medium' | 'high'> = {
  shell: 'high',
  shellSafe: 'low',
  fileRead: 'low',
  fileWrite: 'medium',
  internet: 'medium',
  script: 'high',
  browser: 'medium',
  codeExecution: 'high',
  delegation: 'low',
  cronjob: 'medium',
  messaging: 'medium',
  imageGen: 'low',
  tts: 'low',
};

/** A single permission event recorded in history (and shown in chat/terminal). */
export interface PermissionEvent {
  id: string;
  timestamp: number;
  action: PermissionAction;
  /** Short human-readable description of what was being attempted. */
  target: string;
  /** Resolution of the request. */
  decision: 'allowed' | 'denied' | 'session-allowed' | 'always-allowed' | 'auto-allowed' | 'auto-denied';
  /** Whether the user was actually prompted (vs auto-resolved by config). */
  prompted: boolean;
  /** Optional reason / agent stated intent. */
  reason?: string;
}

/** Heuristic — is this command a read-only "safe" shell op? */
const SAFE_SHELL_RE =
  /^(ls|cat|head|tail|less|more|pwd|whoami|id|date|uname|env|printenv|which|where|file|stat|wc|sort|uniq|find|grep|rg|tree|du|df|ps|hostname|echo)\b/i;

export const isSafeReadonlyShell = (cmd: string): boolean => {
  const trimmed = cmd.trim();
  if (!trimmed) return false;
  // Reject anything that smells like writing/piping/redirecting/sudo.
  if (/[|;&><]/.test(trimmed)) return false;
  if (/^sudo\b/i.test(trimmed)) return false;
  return SAFE_SHELL_RE.test(trimmed);
};

/** Expand a leading `~` so path comparisons work uniformly. */
export const expandHome = (p: string, home: string): string => {
  if (!p) return p;
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return home + p.slice(1);
  return p;
};

/** Does `child` live under `parent`? Both already absolute / expanded. */
export const isUnder = (child: string, parent: string): boolean => {
  if (!child || !parent) return false;
  const norm = (s: string) => s.replace(/[/\\]+$/, '').toLowerCase();
  const c = norm(child);
  const p = norm(parent);
  if (c === p) return true;
  return c.startsWith(p + '/') || c.startsWith(p + '\\');
};
