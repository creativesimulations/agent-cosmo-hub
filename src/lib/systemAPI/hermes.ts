// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { coreAPI } from './core';
import { secretsStore } from './secretsStore';
import { sudoAPI } from './sudo';
import { isElectron } from './types';
import type { CommandResult } from './types';
import { agentLogs, truncateForLog } from '../diagnostics';
import {
  APPROVAL_PROMPT_RE,
  matchesApprovalPrompt,
  isDebugPromptDetection,
  choiceToStdin,
  getApprovalHandler,
  guessAction,
  recordPermissionEvent,
} from '../approvalBridge';
import type { PermissionsConfig } from '../permissions';
import {
  RONBOT_RULES_BLOCK,
  RONBOT_ELECTRON_APP_GUIDE,
  RONBOT_ELECTRON_APP_GUIDE_VERSION,
} from './hermes/ronbotRules';
import { buildDefaultSoulMarkdown, parseAgentDisplayNameFromSoul } from './hermes/defaultPersonalityMarkdown';
import { seedCustomPersonalityFiles } from './hermes/personalitySeed';
import {
  saveDefaultPersonalityPreset,
  listPersonalityPresets,
  savePersonalityPreset,
  applyPersonalityPreset as installPersonalityPresetFiles,
  deletePersonalityPreset,
} from './hermes/personalities';
import {
  HERMES_DIR,
  HERMES_ENV,
  HERMES_CONFIG,
  BROWSER_EXECUTABLE_FIX_SCRIPT,
} from './hermes/constants';
import { runOfficialHermesInstall, runLocalFolderHermesInstall } from './hermes/installRun';
import { buildHermesBrowserInstallScript, buildHermesCoreInstallScript } from './hermes/installScripts';
import { INSTALL_BROWSER_STREAM, INSTALL_CORE_STREAM } from './hermes/installTimeouts';
import { fetchInstalledSkillsList } from './hermes/listSkills';
import { materializeHermesEnv } from './hermes/materializeEnv';
import { parseBrowserBlock, type BrowserBlockState } from './hermes/browserBlock';
import type { HermesBrowserDiagnostics } from './hermes/browserDiagnostics';
import { collectBrowserDiagnostics } from './hermes/browserDiagnostics';
import type { CommandOutputHandler } from './hermes/shell';
import {
  encodeScript,
  toWslMountedPath,
  ensureHermesChatCaps,
  getHermesChatCaps,
  HERMES_PATH_EXPORT,
  runHermesShell,
  runHermesCli,
} from './hermes/shell';
import { readHermesFile, writeHermesFile } from './hermes/files';
import {
  PERMS_BEGIN,
  PERMS_END,
  LOG_BEGIN,
  LOG_END,
  BROWSER_BEGIN,
  BROWSER_END,
  TOOLSETS_BEGIN,
  TOOLSETS_END,
  stripManagedBlock,
  yamlList,
  buildManagedBlockYaml,
} from './hermes/managedBlocks';
import {
  parseCronListOutput,
  parseProfileListOutput,
  parsePluginsListOutput,
  parseInsightsOutput,
} from './hermes/cliParsers';
import {
  classifyChatError,
  extractSessionId,
  isEchoLine,
  stripAnsi,
} from './hermes/chatOutput';
import { finalizeTerminalTranscript } from '../chat/terminalStream';
import {
  disposeConversationChat as disposePersistentChat,
  runPersistentChatTurn,
} from './hermes/persistentChatSession';
import { finalizeTerminalTranscript } from '../chat/terminalStream';
import { parseSubAgentLog } from './hermes/subAgentLog';
import { tailAgentLog as runTailAgentLog } from './hermes/tailAgentLog';
import {
  parseKeyValueProbeLines,
  probeRecordToState,
  hasUsableHermesInstall,
  classifyHermesInstallProbe,
  formatHermesInstallProbe,
  type HermesInstallProbe,
  type HermesInstallProbeReason,
} from './hermes/installProbe';

export type { HermesInstallProbe, HermesInstallProbeReason } from './hermes/installProbe';
export { classifyHermesInstallProbe, formatHermesInstallProbe, hasUsableHermesInstall } from './hermes/installProbe';

export { buildOfficialHermesInstallScript, buildInstallerRunScript, BROWSER_EXECUTABLE_FIX_SCRIPT } from './hermes/constants';
export { parseCronListOutput, parseProfileListOutput, parsePluginsListOutput, parseInsightsOutput };
export type { CommandOutputHandler } from './hermes/shell';

export type StartupIssueSeverity = 'info' | 'warn' | 'error';
export interface StartupIssue {
  id: string;
  severity: StartupIssueSeverity;
  title: string;
  detail: string;
  fixable: boolean;
  fixAction?: 'sync-secrets' | 'init-skills-hub' | 'repair-config';
}

export interface StartupBootstrapStep {
  id: string;
  ok: boolean;
  detail: string;
  durationMs: number;
}

export interface StartupBootstrapReport {
  success: boolean;
  steps: StartupBootstrapStep[];
  issues: StartupIssue[];
}

const repairLegacyWindowsInstall = async (): Promise<void> => {
  const platform = await coreAPI.getPlatform();
  if (!platform.isWindows) return;

  const mountedHome = toWslMountedPath(platform.homeDir);
  if (!mountedHome) return;

  // Two known bogus locations created by older builds that wrote via Node fs
  // against the Windows home dir (or a literal "~" expansion bug):
  //   C:\Users\<user>\.hermes        →  /mnt/c/Users/<user>/.hermes
  //   C:\Users\<user>\~\.hermes      →  /mnt/c/Users/<user>/~/.hermes
  // We migrate any salvageable artifacts into the real WSL ~/.hermes, then
  // delete the stubs so the user doesn't see two competing folders.
  const legacyDirs = [`${mountedHome}/~/.hermes`, `${mountedHome}/.hermes`];
  await runHermesShell(
    [
      ...legacyDirs.flatMap((legacyDir, index) => [
        `LEGACY_${index}="${legacyDir}"`,
        `if [ -d "$LEGACY_${index}" ]; then`,
        '  TARGET="$HOME/.hermes"',
        '  mkdir -p "$TARGET"',
        '  for item in venv hermes-agent config.yaml .env skills state.db; do',
        `    if [ -e "$LEGACY_${index}/$item" ] && [ ! -e "$TARGET/$item" ]; then`,
        `      cp -R "$LEGACY_${index}/$item" "$TARGET/$item"`,
        '    fi',
        '  done',
        // Best-effort cleanup: remove the stub dir so it stops confusing the user.
        // Only delete if it now contains nothing we haven't already migrated.
        `  rm -rf "$LEGACY_${index}" 2>/dev/null || true`,
        'fi',
      ]),
    ].join('\n'),
    { timeout: 30000 },
  );
};

/** Bash fragment: in-place repair for configs left broken by older builds.
 *  Must not `exit` the shell — it is composed ahead of the install probe so
 *  both run in one `runHermesShell` (critical on Windows where each shell is
 *  a separate `wsl` launch). */
const repairBrokenYamlBashFragment = [
  `CFG="${HERMES_CONFIG}"`,
  'if [ -f "$CFG" ]; then',
  // Match keys followed immediately by `[` (no space) and insert one.
  `  if grep -Eq '^[[:space:]]*(allowed_paths|blocked_paths):\\[' "$CFG"; then`,
  '    echo "[repair] fixing missing space in allowed_paths/blocked_paths"',
  `    sed -i -E 's/^([[:space:]]*(allowed_paths|blocked_paths)):\\[/\\1: [/' "$CFG"`,
  '  fi',
  // Heal the null-browser-block case: bare `browser:` whose only child is a comment.
  `  if grep -Eq '^browser:[[:space:]]*$' "$CFG" && grep -Eq '^[[:space:]]+# \\(no overrides' "$CFG"; then`,
  '    echo "[repair] replacing null browser: block with empty mapping {}"',
  `    sed -i -E '/^[[:space:]]+# \\(no overrides[^)]*\\)[[:space:]]*$/d' "$CFG"`,
  `    sed -i -E 's/^browser:[[:space:]]*$/browser: {}/' "$CFG"`,
  '  fi',
  'fi',
].join('\n');

const inspectHermesInstall = async (): Promise<HermesInstallProbe> => {
  await repairLegacyWindowsInstall();
  // Match PATH expansion used by `runHermesCli` / chat so Homebrew, snap,
  // and ~/.local installs are visible — a bare venv+.local PATH misses
  // `/opt/homebrew/bin` and makes `isConfigured` false while `hermes --version`
  // from the GUI shell (richer PATH) still succeeds.
  const mergedScript = [
    repairBrokenYamlBashFragment,
    HERMES_PATH_EXPORT,
    `if [ -d "${HERMES_DIR}" ]; then echo "HAS_DIR=1"; else echo "HAS_DIR=0"; fi`,
    `if [ -f "${HERMES_ENV}" ]; then echo "HAS_ENV=1"; else echo "HAS_ENV=0"; fi`,
    `if [ -f "${HERMES_CONFIG}" ]; then echo "HAS_CONFIG=1"; else echo "HAS_CONFIG=0"; fi`,
    'if [ -x "$HOME/.hermes/venv/bin/hermes" ]; then echo "HAS_VENV_CLI=1"; else echo "HAS_VENV_CLI=0"; fi',
    'if command -v hermes >/dev/null 2>&1; then echo "HAS_PATH_CLI=1"; else echo "HAS_PATH_CLI=0"; fi',
    'HAS_MODEL=0',
    'if [ -f "$HOME/.hermes/config.yaml" ] && grep -qE \'^[[:space:]]*model:\' "$HOME/.hermes/config.yaml" 2>/dev/null; then HAS_MODEL=1; fi',
    'echo "HAS_MODEL=$HAS_MODEL"',
    'HAS_CLI_RUNS=0',
    'if [ -x "$HOME/.hermes/venv/bin/hermes" ]; then',
    '  if VER="$("$HOME/.hermes/venv/bin/hermes" --version 2>/dev/null)" && [ -n "$VER" ]; then',
    '    HAS_CLI_RUNS=1',
    '  fi',
    'elif command -v hermes >/dev/null 2>&1 && [ -f "$HOME/.hermes/config.yaml" ]; then',
    '  if VER="$(hermes --version 2>/dev/null)" && [ -n "$VER" ]; then',
    '    HAS_CLI_RUNS=1',
    '  fi',
    'fi',
    'echo "HAS_CLI_RUNS=$HAS_CLI_RUNS"',
  ].join('\n');

  const result = await runHermesShell(mergedScript, { timeout: 15000 }).catch(() => ({
    success: false,
    stdout: '',
    stderr: '',
    code: 1,
  }));

  return probeRecordToState(parseKeyValueProbeLines(result.stdout));
};

const finalizeInstallVerification = async (result: CommandResult, onOutput?: CommandOutputHandler): Promise<CommandResult> => {
  const state = await inspectHermesInstall();
  const verificationLines = [
    `[verify] ~/.hermes directory: ${state.hasDir ? 'found' : 'missing'}`,
    `[verify] config.yaml: ${state.hasConfig ? 'found' : 'missing'}`,
    `[verify] .env: ${state.hasEnv ? 'found' : 'missing'}`,
    `[verify] venv hermes CLI: ${state.hasVenvCli ? 'found' : 'missing'}`,
    `[verify] hermes on PATH: ${state.hasPathCli ? 'found' : 'missing'}`,
    `[verify] hermes CLI runs (version): ${state.hasCliRuns ? 'ok' : 'missing'}`,
    `[verify] config model key: ${state.hasModelLine ? 'found' : 'missing'}`,
  ];

  onOutput?.({ type: 'stdout', data: `${verificationLines.join('\n')}\n` });

  if (hasUsableHermesInstall(state)) {
    return {
      ...result,
      stdout: `${result.stdout}${result.stdout && !result.stdout.endsWith('\n') ? '\n' : ''}${verificationLines.join('\n')}\n`,
      stderr: result.stderr,
    };
  }

  const failure = [
    '[verify] Install finished, but no usable Hermes install was found under ~/.hermes.',
    '[verify] Expected ~/.hermes/venv/bin/hermes that runs `hermes --version`, or config.yaml with model: plus a working hermes on PATH.',
  ].join('\n');

  onOutput?.({ type: 'stderr', data: `${failure}\n` });

  return {
    success: false,
    code: result.code || 52,
    stdout: `${result.stdout}${result.stdout && !result.stdout.endsWith('\n') ? '\n' : ''}${verificationLines.join('\n')}\n`,
    stderr: `${result.stderr}${result.stderr && !result.stderr.endsWith('\n') ? '\n' : ''}${failure}\n`,
  };
};

const normalizeDoctorIssues = (
  doctorOutput: string,
  platform: Awaited<ReturnType<typeof coreAPI.getPlatform>>,
): StartupIssue[] => {
  const out = (doctorOutput || '').toLowerCase();
  const issues: StartupIssue[] = [];

  if (out.includes('loginctl not found')) {
    issues.push({
      id: 'doctor-loginctl-wsl',
      severity: platform.isWindows || platform.isWSL ? 'info' : 'warn',
      title: 'Systemd linger check unavailable',
      detail: platform.isWindows || platform.isWSL
        ? 'WSL often has no loginctl; foreground gateway mode is expected and supported.'
        : 'Could not verify systemd linger. Gateway persistence may be degraded.',
      fixable: false,
    });
  }

  if (out.includes("run 'hermes setup'") || out.includes('missing api keys')) {
    issues.push({
      id: 'doctor-missing-api-keys',
      severity: 'warn',
      title: 'Missing API keys for full tool access',
      detail: 'Some providers are not configured yet. Add keys in the Secrets tab, then sync them.',
      fixable: true,
      fixAction: 'sync-secrets',
    });
  }

  if (out.includes('skills hub directory not initialized')) {
    issues.push({
      id: 'doctor-skills-hub-not-initialized',
      severity: 'warn',
      title: 'Skills Hub not initialized',
      detail: 'Skills index has not been initialized yet. Running a skills list command bootstraps it.',
      fixable: true,
      fixAction: 'init-skills-hub',
    });
  }

  return issues;
};

// ─── Permissions YAML mirror ──────────────────────────────────────
// Hermes has its own permission engine. Sub-agents (and many parent
// actions) consult it directly without ever emitting a Choice prompt to
// stdout, so intercepting prompts in the parent stream is not enough — we
// also have to write the user's choices into ~/.hermes/config.yaml so
// every Hermes process honors them.
//
// We splice a managed `permissions:` block into config.yaml between two
// sentinel comments (same pattern we use for the .env managed block). The
// rest of the file is left untouched.

/** Write the current PermissionsConfig into ~/.hermes/config.yaml.
 *  Idempotent: only the managed block is touched.
 *
 *  Includes the per-tool keys the official `hermes-cli` toolset honors:
 *  browser, code_execution, delegation, cronjob, messaging, image_gen, tts —
 *  in addition to the historical shell / file / internet / script keys. */
export const writeHermesPermissions = async (
  perms: PermissionsConfig,
): Promise<{ success: boolean; error?: string }> => {
  const cfg = await readHermesFile(HERMES_CONFIG);
  const existing = cfg.success && cfg.content ? cfg.content : 'model: openrouter/auto\n';
  const inner = [
    'permissions:',
    `  shell: ${perms.shell}`,
    `  shell_allow_readonly: ${perms.shellAllowReadOnly ? 'true' : 'false'}`,
    `  file_read: ${perms.fileRead}`,
    `  file_write: ${perms.fileWrite}`,
    `  file_read_scope: ${perms.fileReadScope}`,
    `  file_write_scope: ${perms.fileWriteScope}`,
    `  internet: ${perms.internet}`,
    `  script: ${perms.script}`,
    `  browser: ${perms.browser ?? 'ask'}`,
    `  code_execution: ${perms.codeExecution ?? 'ask'}`,
    `  delegation: ${perms.delegation ?? 'allow'}`,
    `  cronjob: ${perms.cronjob ?? 'ask'}`,
    `  messaging: ${perms.messaging ?? 'ask'}`,
    `  image_gen: ${perms.imageGen ?? 'allow'}`,
    `  tts: ${perms.tts ?? 'allow'}`,
    `  default: ${perms.fallback}`,
    `  allowed_paths:${yamlList(perms.allowedFolders)}`,
    `  blocked_paths:${yamlList(perms.blockedFolders)}`,
  ];
  const next = buildManagedBlockYaml(existing, PERMS_BEGIN, PERMS_END, inner);
  const w = await writeHermesFile(HERMES_CONFIG, next, '600');
  agentLogs.push({
    source: 'system',
    level: w.success ? 'info' : 'error',
    summary: w.success
      ? `permissions synced to ~/.hermes/config.yaml (shell=${perms.shell}, internet=${perms.internet})`
      : 'failed to sync permissions to ~/.hermes/config.yaml',
  });
  return w.success
    ? { success: true }
    : { success: false, error: 'Failed to write config.yaml permissions block' };
};

/** Enable file logging in Hermes config so the SubAgents tab can read events. */
export const enableHermesFileLogging = async (): Promise<{ success: boolean }> => {
  const cfg = await readHermesFile(HERMES_CONFIG);
  const existing = cfg.success && cfg.content ? cfg.content : 'model: openrouter/auto\n';
  const inner = ['logging:', '  file: ~/.hermes/logs/agent.log', '  level: info'];
  const next = buildManagedBlockYaml(existing, LOG_BEGIN, LOG_END, inner);
  const w = await writeHermesFile(HERMES_CONFIG, next, '600');
  agentLogs.push({
    source: 'system',
    level: w.success ? 'info' : 'error',
    summary: w.success ? 'enabled Hermes file logging (~/.hermes/logs/agent.log)' : 'failed to enable Hermes file logging',
  });
  // Make sure the directory exists so the agent can actually open the file.
  if (w.success) {
    await runHermesShell('mkdir -p "$HOME/.hermes/logs"', { timeout: 5000 }).catch(() => undefined);
  }
  return { success: w.success };
};

/** Read the active managed permissions block (for Diagnostics display). */
export const readHermesPermissionsBlock = async (): Promise<string | null> => {
  const cfg = await readHermesFile(HERMES_CONFIG);
  if (!cfg.success || !cfg.content) return null;
  const startIdx = cfg.content.indexOf(PERMS_BEGIN);
  if (startIdx === -1) return null;
  const endIdx = cfg.content.indexOf(PERMS_END, startIdx);
  if (endIdx === -1) return null;
  return cfg.content.slice(startIdx, endIdx + PERMS_END.length);
};

// Official Hermes platform toolset bundle. Loading `hermes-cli` natively
// registers `web`, `browser`, `terminal`, `file`, `vision`, `image_gen`,
// `tts`, `memory`, `todo`, `clarify`, `delegation`, `code_execution`,
// `cronjob`, `skills`, `session_search`, `messaging`, etc. — i.e. the full
// 36-tool bundle the docs describe. Previously we wrote `hermes-web`, which
// is not a real toolset name and caused the agent to report "missing skill"
// for every web/browser call.
const BROWSER_DEFAULT_TOOLSETS = ['hermes-cli'];

const writeBrowserBlock = async (
  next: BrowserBlockState,
): Promise<{ success: boolean; error?: string }> => {
  const cfg = await readHermesFile(HERMES_CONFIG);
  const existing = cfg.success && cfg.content ? cfg.content : 'model: openrouter/auto\n';
  let stripped = stripManagedBlock(existing, BROWSER_BEGIN, BROWSER_END).replace(/\n+$/, '');
  // Also strip any prior managed toolsets block — we re-write it below so the
  // hermes-web toolset is always loaded whenever a browser backend is wired.
  stripped = stripManagedBlock(stripped, TOOLSETS_BEGIN, TOOLSETS_END).replace(/\n+$/, '');

  const browserBodyLines: string[] = [];
  // Only emit keys that the documented Hermes browser schema understands.
  // The previous `enabled` / `allow_network` / `tool_allowlist` keys were
  // invented by us and were either ignored or actively blocked the agent's
  // permission system — they are intentionally NOT written anymore.
  if (next.cdpUrl) {
    browserBodyLines.push(`  cdp_url: "${next.cdpUrl}"`);
  }
  if (next.camofoxPersistence) {
    browserBodyLines.push('  camofox:');
    browserBodyLines.push('    managed_persistence: true');
  }

  // CRITICAL: Hermes' cli.py does `if key in browser_config:` — if we emit
  // `browser:` with only a comment child, PyYAML parses it as None and the
  // chat command crashes with `TypeError: argument of type 'NoneType' is not
  // iterable`. Use an empty inline mapping `{}` (a real dict) when there are
  // no overrides so `in` works.
  const lines: string[] = [BROWSER_BEGIN];
  if (browserBodyLines.length === 0) {
    lines.push('browser: {}');
  } else {
    lines.push('browser:', ...browserBodyLines);
  }
  lines.push(BROWSER_END);

  // Toolsets: load the official `hermes-cli` platform bundle so web,
  // browser, terminal, file, vision, image_gen, tts, etc. are all
  // registered without the user needing extra setup.
  const toolsetLines = [
    TOOLSETS_BEGIN,
    'toolsets:',
    ...BROWSER_DEFAULT_TOOLSETS.map((toolset) => `  - ${toolset}`),
    TOOLSETS_END,
  ];
  const out = `${stripped}\n\n${lines.join('\n')}\n\n${toolsetLines.join('\n')}\n`;
  const w = await writeHermesFile(HERMES_CONFIG, out, '600');
  return w.success ? { success: true } : { success: false, error: 'Failed to write config.yaml browser block' };
};

/** Toggle Camofox `managed_persistence` while preserving any cdp_url already set. */
export const setBrowserCamofoxPersistence = async (
  enabled: boolean,
): Promise<{ success: boolean; error?: string }> => {
  const cfg = await readHermesFile(HERMES_CONFIG);
  const existing = cfg.success && cfg.content ? cfg.content : '';
  const current = parseBrowserBlock(existing);
  const result = await writeBrowserBlock({ ...current, camofoxPersistence: enabled });
  if (result.success) {
    await runHermesShell(BROWSER_EXECUTABLE_FIX_SCRIPT, { timeout: 15000 }).catch(() => undefined);
  }
  agentLogs.push({
    source: 'system',
    level: result.success ? 'info' : 'error',
    summary: result.success
      ? `browser.camofox.managed_persistence ${enabled ? 'enabled' : 'cleared'} in config.yaml`
      : 'failed to update browser block in config.yaml',
  });
  return result;
};

/**
 * Write `browser.cdp_url` in config.yaml so Hermes auto-connects to a Chrome
 * we launched with `--remote-debugging-port`. Pass `null` to clear.
 */
export const setBrowserCdpUrl = async (
  url: string | null,
): Promise<{ success: boolean; error?: string }> => {
  const cfg = await readHermesFile(HERMES_CONFIG);
  const existing = cfg.success && cfg.content ? cfg.content : '';
  const current = parseBrowserBlock(existing);
  const result = await writeBrowserBlock({ ...current, cdpUrl: url });
  if (result.success) {
    await runHermesShell(BROWSER_EXECUTABLE_FIX_SCRIPT, { timeout: 15000 }).catch(() => undefined);
  }
  agentLogs.push({
    source: 'system',
    level: result.success ? 'info' : 'error',
    summary: result.success
      ? `browser.cdp_url ${url ? `set to ${url}` : 'cleared'} in config.yaml`
      : 'failed to update browser.cdp_url in config.yaml',
  });
  return result;
};

const shellEscapeForScript = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Run Hermes under a pseudo-TTY so approval prompts can read stdin. */
const wrapCommandInPty = (command: string): string =>
  `script -qefc "${shellEscapeForScript(command)}" /dev/null`;

const processChatTranscript = (
  prompt: string,
  stdout: string,
  resumeId?: string,
  sessionWasInvalid = false,
): { cleaned: string; sessionId: string | null | undefined; diagnostics: string } => {
  const rawLines = stripAnsi(stdout || '')
    .split('\n')
    .map((line) => line.replace(/\r/g, ''));
  const diagnostics = rawLines
    .filter((line) => /^\[hermes-diag\]/.test(line.trim()))
    .map((line) => line.trim().replace(/^\[hermes-diag\]\s*/, ''))
    .join('\n');
  const filtered = rawLines.filter((line) => !/^\[hermes-diag\]/.test(line.trim()));
  while (filtered.length > 0 && isEchoLine(filtered[0], prompt)) {
    filtered.shift();
  }
  const cleaned = finalizeTerminalTranscript(filtered.join('\n'), prompt);
  const sessionId = extractSessionId(stdout || '', resumeId, sessionWasInvalid);
  return { cleaned, sessionId, diagnostics };
};

/** Hermes Agent installation, configuration, and lifecycle */
export const hermesAPI = {
  /** Force-write secrets to ~/.hermes/.env and verify. Used by Diagnostics
   *  page and the Secrets tab "Sync to agent" button. */
  async materializeEnv() {
    return materializeHermesEnv();
  },

  /** Sync the user's Permissions panel into ~/.hermes/config.yaml so every
   *  Hermes process (including sub-agents) honors the same rules. */
  async syncPermissions(perms: PermissionsConfig) {
    return writeHermesPermissions(perms);
  },

  /** Turn on file logging so the SubAgents tab can show delegation activity. */
  async enableFileLogging() {
    return enableHermesFileLogging();
  },

  /** Tear down the long-running Hermes chat process for a Ronbot conversation. */
  async disposeConversationChat(conversationKey: string) {
    return disposePersistentChat(conversationKey);
  },

  /** Read the active managed permissions block (for Diagnostics). */
  async readPermissionsBlock() {
    return readHermesPermissionsBlock();
  },

  /** Read live browser diagnostics: CDP reachability, what config.yaml says,
   *  whether `hermes-web` is loaded, and the effective `internet` permission.
   *  This is what the Diagnostics page shows under "Browser toolset". */
  async getBrowserDiagnostics(): Promise<HermesBrowserDiagnostics> {
    const cfg = await readHermesFile(HERMES_CONFIG);
    const yaml = cfg.success && cfg.content ? cfg.content : '';
    const permsBlock = await readHermesPermissionsBlock();
    return collectBrowserDiagnostics(yaml, permsBlock);
  },

  /** Toggle Camofox `managed_persistence` in the agent's config. */
  async setBrowserCamofoxPersistence(enabled: boolean) {
    return setBrowserCamofoxPersistence(enabled);
  },

  /** Set (or clear) `browser.cdp_url` so Hermes auto-connects to a launched Chrome. */
  async setBrowserCdpUrl(url: string | null) {
    return setBrowserCdpUrl(url);
  },
  /** Probe Hermes CLI version text (`hermes version` then `hermes --version`). */
  async getHermesCliVersionSummary(): Promise<{
    ok: boolean;
    text: string;
    /** True when output suggests Hermes v0.13.x is already present. */
    looksLikeV013: boolean;
  }> {
    const r = await runHermesShell(
      [
        HERMES_PATH_EXPORT,
        'OUT="$(hermes version 2>/dev/null || true)"',
        'if [ -z "$OUT" ]; then OUT="$(hermes --version 2>/dev/null || true)"; fi',
        'echo "$OUT"',
      ].join('\n'),
      { timeout: 20_000 },
    );
    const text = ((r.stdout || '') + (r.stderr || '')).trim();
    const looksLikeV013 = /\b0\.13\.\d+/.test(text) || /\bhermes\s+0\.13\b/i.test(text);
    return { ok: r.success, text: text.slice(0, 800), looksLikeV013 };
  },

  /** Core Hermes install (staged official script, no browser/npm). */
  async installCore(onOutput?: CommandOutputHandler, onStreamId?: (id: string) => void): Promise<CommandResult> {
    return runHermesShell(
      buildHermesCoreInstallScript(),
      { ...INSTALL_CORE_STREAM, onStreamId },
      onOutput,
    );
  },

  /** Browser tools install (official node-deps stage). Non-fatal if this fails after core. */
  async installBrowser(onOutput?: CommandOutputHandler, onStreamId?: (id: string) => void): Promise<CommandResult> {
    const browserResult = await runHermesShell(
      buildHermesBrowserInstallScript(),
      { ...INSTALL_BROWSER_STREAM, onStreamId },
      onOutput,
    );
    await runHermesShell(BROWSER_EXECUTABLE_FIX_SCRIPT, { timeout: 15_000 }, onOutput).catch(() => undefined);
    return browserResult;
  },

  /** Verify ~/.hermes after core (+ optional browser) install steps. */
  async verifyInstall(
    pipeline: { core: CommandResult; browser?: CommandResult },
    onOutput?: CommandOutputHandler,
  ): Promise<CommandResult> {
    const merged: CommandResult = {
      success: pipeline.core.success,
      code: pipeline.core.code,
      stdout: `${pipeline.core.stdout}${pipeline.browser?.stdout ?? ''}`,
      stderr: `${pipeline.core.stderr}${pipeline.browser?.stderr ?? ''}`,
    };
    return finalizeInstallVerification(merged, onOutput);
  },

  /** Install the agent using the official install script (core + browser + verify).
   *  On Windows we always run inside WSL because hermes-agent is not published
   *  to PyPI and requires the install script (which expects a POSIX shell). */
  async install(extras?: string[], onOutput?: CommandOutputHandler, onStreamId?: (id: string) => void): Promise<CommandResult> {
    return runOfficialHermesInstall(extras, onOutput, finalizeInstallVerification, onStreamId);
  },

  /** Install from a local folder the user already has on disk
   *  (e.g. a cloned hermes-agent repo or extracted source bundle).
   *  Creates ~/.hermes/venv if needed, then `pip install -e <folder>[extras]`
   *  and symlinks the CLI into ~/.local/bin. On Windows, translates the
   *  selected folder into its /mnt/<drive>/... equivalent for WSL. */
  async installFromLocalFolder(
    folderPath: string,
    extras?: string[],
    onOutput?: CommandOutputHandler,
    onStreamId?: (id: string) => void,
  ): Promise<CommandResult> {
    const platform = await coreAPI.getPlatform();
    let posixPath = folderPath;
    if (platform.isWindows) {
      const mounted = toWslMountedPath(folderPath);
      if (!mounted) {
        return {
          success: false,
          stdout: '',
          stderr: `Could not translate Windows path "${folderPath}" to a WSL path. Pick a folder on a local drive (C:\\, D:\\, etc.).`,
          code: 2,
        };
      }
      posixPath = mounted;
    }
    return runLocalFolderHermesInstall(posixPath, extras, onOutput, finalizeInstallVerification, onStreamId);
  },

  /** Run hermes doctor to verify installation */
  async doctor(onOutput?: CommandOutputHandler): Promise<CommandResult> {
    const start = Date.now();
    agentLogs.push({ source: 'doctor', level: 'info', summary: 'Running hermes doctor…' });
    await materializeHermesEnv();
    const r = await runHermesCli(
      [
        'echo "[doctor] starting diagnostics..."',
        'hermes doctor',
      ].join('\n'),
      { timeout: 90000 },
      onOutput,
    );
    agentLogs.push({
      source: 'doctor',
      level: r.success ? 'info' : 'error',
      summary: r.success ? `hermes doctor exited cleanly (${r.code ?? 0})` : `hermes doctor failed (exit=${r.code})`,
      detail: truncateForLog([r.stdout, r.stderr].filter(Boolean).join('\n')),
      durationMs: Date.now() - start,
    });
    return r;
  },

  async analyzeDoctorIssues(rawDoctorOutput?: string): Promise<{ success: boolean; issues: StartupIssue[]; doctorOutput: string }> {
    const platform = await coreAPI.getPlatform();
    if (rawDoctorOutput != null) {
      return { success: true, issues: normalizeDoctorIssues(rawDoctorOutput, platform), doctorOutput: rawDoctorOutput };
    }
    const r = await this.doctor();
    const combined = [r.stdout, r.stderr].filter(Boolean).join('\n');
    return { success: r.success, issues: normalizeDoctorIssues(combined, platform), doctorOutput: combined };
  },

  async bootstrapStartupHealth(): Promise<StartupBootstrapReport> {
    const steps: StartupBootstrapStep[] = [];
    const timed = async (id: string, fn: () => Promise<{ ok: boolean; detail: string }>) => {
      const start = Date.now();
      const res = await fn();
      steps.push({ id, ok: res.ok, detail: res.detail, durationMs: Date.now() - start });
      return res.ok;
    };

    await timed('status-warmup', async () => {
      const r = await this.status();
      return { ok: r.success, detail: r.success ? 'hermes status responded' : (r.stderr || r.stdout || 'status failed').split('\n')[0] };
    });

    await timed('skills-bootstrap', async () => {
      const r = await this.listSkills();
      return { ok: r.success, detail: r.success ? `skills listed (${r.skills.length})` : (r.error || 'skills list failed') };
    });

    // Messaging-channel startup is now driven by the agent over the intent
    // protocol — the app no longer attempts gateway/runtime bootstrap itself.

    const doctor = await this.doctor();
    const doctorText = [doctor.stdout, doctor.stderr].filter(Boolean).join('\n');
    const platform = await coreAPI.getPlatform();
    const issues = normalizeDoctorIssues(doctorText, platform);

    const success = steps.every((s) => s.ok) && !issues.some((i) => i.severity === 'error');
    return { success, steps, issues };
  },

  async runStartupAutoFix(options?: { sudoPassword?: string | null }): Promise<{ success: boolean; actions: string[]; issues: StartupIssue[]; error?: string }> {
    const actions: string[] = [];
    const doctor = await this.doctor();
    const doctorText = [doctor.stdout, doctor.stderr].filter(Boolean).join('\n');
    const platform = await coreAPI.getPlatform();
    const issues = normalizeDoctorIssues(doctorText, platform);

    for (const issue of issues) {
      if (!issue.fixable) continue;
      if (issue.fixAction === 'sync-secrets') {
        const r = await this.materializeEnv();
        actions.push(r.success ? 'synced secrets to ~/.hermes/.env' : `failed syncing secrets: ${r.error || 'unknown'}`);
      } else if (issue.fixAction === 'init-skills-hub') {
        const r = await this.listSkills();
        actions.push(r.success ? 'initialized skills hub' : `failed skills hub init: ${r.error || 'unknown'}`);
      } else if (issue.fixAction === 'repair-config') {
        const r = await this.repairConfig();
        actions.push(r.success ? 'repaired config' : `failed config repair: ${r.error || 'unknown'}`);
      }
    }

    if (options?.sudoPassword !== undefined && options.sudoPassword !== null) {
      const pwd = options.sudoPassword;
      const apt = await sudoAPI.aptInstall(['curl'], pwd);
      actions.push(apt.success ? 'validated elevated apt execution' : 'elevated apt execution unavailable');
    }

    const post = await this.bootstrapStartupHealth();
    return {
      success: post.success,
      actions,
      issues: post.issues,
      error: post.success ? undefined : 'Some startup issues remain after auto-fix',
    };
  },

  /** Get agent status */
  async status(): Promise<CommandResult> {
    return runHermesCli('hermes status');
  },

  /** Run hermes update */
  async update(): Promise<CommandResult> {
    const start = Date.now();
    agentLogs.push({ source: 'update', level: 'info', summary: 'Running hermes update…' });
    const r = await runHermesCli('hermes update', { timeout: 300000 });
    agentLogs.push({
      source: 'update',
      level: r.success ? 'info' : 'error',
      summary: r.success ? 'hermes update complete' : `hermes update failed (exit=${r.code})`,
      detail: truncateForLog([r.stdout, r.stderr].filter(Boolean).join('\n')),
      durationMs: Date.now() - start,
    });
    return r;
  },

  /**
   * Completely remove the Hermes install: deletes ~/.hermes (config, venv,
   * skills, logs, .env, state.db) and best-effort `pip uninstall hermes-agent`
   * from the user pip. This is destructive — Settings page guards it behind
   * a confirmation dialog.
   */
  async uninstall(onOutput?: CommandOutputHandler): Promise<CommandResult> {
    const start = Date.now();
    agentLogs.push({ source: 'system', level: 'warn', summary: 'Uninstalling Hermes…' });
    const script = [
      'set +e',
      'export PATH="$HOME/.hermes/venv/bin:$HOME/.hermes/bin:$HOME/.local/bin:$PATH"',
      'echo "[uninstall] stopping Hermes gateway and CLI…"',
      'if command -v hermes >/dev/null 2>&1; then',
      '  hermes gateway stop 2>/dev/null || true',
      'fi',
      'systemctl --user stop hermes-gateway.service 2>/dev/null || true',
      'systemctl --user stop hermes-gateway 2>/dev/null || true',
      'pkill -f "gateway/run.py" 2>/dev/null || true',
      'echo "[uninstall] removing ~/.hermes (config, venv, skills, logs, state)"',
      'rm -rf "$HOME/.hermes"',
      'echo "[uninstall] removing ~/.local/bin/hermes symlink"',
      'rm -f "$HOME/.local/bin/hermes"',
      'echo "[uninstall] best-effort pip uninstall"',
      'if command -v pip3 >/dev/null 2>&1; then',
      '  pip3 uninstall -y hermes-agent 2>&1 | tail -3 || true',
      'fi',
      'if command -v pipx >/dev/null 2>&1; then',
      '  pipx uninstall hermes-agent 2>&1 | tail -3 || true',
      'fi',
      'echo "[uninstall] done"',
      'exit 0',
    ].join('\n');
    const r = await runHermesShell(script, { timeout: 120000 }, onOutput);
    agentLogs.push({
      source: 'system',
      level: r.success ? 'info' : 'error',
      summary: r.success ? 'Hermes uninstalled' : `Hermes uninstall failed (exit=${r.code})`,
      detail: truncateForLog([r.stdout, r.stderr].filter(Boolean).join('\n')),
      durationMs: Date.now() - start,
    });
    return r;
  },

  /** Read the current ~/.hermes/.env file */
  async readEnvFile(): Promise<Record<string, string>> {
    const result = await readHermesFile(HERMES_ENV);
    if (!result.success || !result.content) return {};

    const env: Record<string, string> = {};
    for (const line of result.content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex).trim();
        let value = trimmed.substring(eqIndex + 1).trim();
        // Strip surrounding quotes
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        env[key] = value;
      }
    }
    return env;
  },

  /** Write a key-value pair to ~/.hermes/.env (append or update) */
  async setEnvVar(key: string, value: string): Promise<{ success: boolean }> {
    const result = await readHermesFile(HERMES_ENV);
    const lines = result.success && result.content ? result.content.split('\n') : [];

    // Update or append
    const linePrefix = `${key}=`;
    const newLine = `${key}="${value}"`;
    let found = false;
    const updated = lines.map((line) => {
      if (line.trim().startsWith(linePrefix)) {
        found = true;
        return newLine;
      }
      return line;
    });
    if (!found) updated.push(newLine);

    return writeHermesFile(HERMES_ENV, updated.join('\n'), '600');
  },

  // ─── Config management (~/.hermes/config.yaml) ────────────

  /** Read the current config.yaml */
  async readConfig(): Promise<{ success: boolean; content?: string }> {
    return readHermesFile(HERMES_CONFIG);
  },

  /** Write config.yaml */
  async writeConfig(content: string): Promise<{ success: boolean }> {
    return writeHermesFile(HERMES_CONFIG, content, '600');
  },

  /** Set the model in config */
  async setModel(modelString: string): Promise<CommandResult> {
    const modelB64 = encodeScript(modelString);
    return runHermesCli([
      `MODEL="$(echo ${modelB64} | base64 -d)"`,
      'hermes config set model "$MODEL"',
    ].join('\n'));
  },

  // ─── Agent lifecycle ──────────────────────────────────────

  /**
   * Best-effort shutdown of Hermes gateway and stray `hermes chat` processes
   * so the next start or seeded persona files are not shadowed by an old
   * runtime. Safe to call repeatedly.
   */
  async stopHermesAgentRuntime(): Promise<{ success: boolean; error?: string }> {
    if (!isElectron()) return { success: false, error: 'browser-mode' };
    agentLogs.push({
      source: 'system',
      level: 'info',
      summary: 'Stopping Hermes gateway / stray CLI (best-effort)',
    });
    const script = [
      HERMES_PATH_EXPORT,
      'if command -v hermes >/dev/null 2>&1; then',
      '  hermes gateway stop 2>/dev/null || true',
      'fi',
      'sleep 2',
      'pkill -f "hermes chat" 2>/dev/null || true',
      'sleep 1',
      'echo "[ronbot] stopHermesAgentRuntime done"',
    ].join('\n');
    const r = await runHermesShell(script, {
      timeout: 35000,
      displayCommand: 'hermes gateway stop; pkill hermes chat',
    }).catch(() => ({ success: false, stdout: '', stderr: '', code: 1 } as CommandResult));
    return { success: r.success !== false };
  },

  /** Start the agent (interactive mode in a terminal).
   *  Decrypts secrets and materializes ~/.hermes/.env (chmod 600) right
   *  before launch, so plaintext secrets only exist on disk while running. */
  async start(): Promise<CommandResult> {
    await this.stopHermesAgentRuntime().catch(() => undefined);
    agentLogs.push({ source: 'start', level: 'info', summary: 'Starting agent (interactive)…' });
    await materializeHermesEnv();
    const r = await runHermesCli('hermes', { timeout: 10000 });
    agentLogs.push({
      source: 'start',
      level: r.success ? 'info' : 'error',
      summary: r.success ? 'Agent launched' : `Agent failed to start (exit=${r.code})`,
      detail: truncateForLog([r.stdout, r.stderr].filter(Boolean).join('\n')),
    });
    return r;
  },

  /** Send a single chat prompt and return a terminal-faithful transcript.
   *
   *  Uses `hermes chat -q "..."` (and `--resume` when cached). Streamed
   *  stdout/stderr are shown live in Ronbot chat; `reply` is a fallback
   *  when the UI accumulator is empty (minimal trim: diag lines, echo, footer).
   *
   *  Secrets are materialized to ~/.hermes/.env before invocation. */
  async chat(
    prompt: string,
    onOutput?: CommandOutputHandler,
    resumeId?: string,
    onStreamId?: (id: string) => void,
    timeoutMs?: number,
    permissions?: PermissionsConfig,
    conversationKey?: string,
  ): Promise<CommandResult & { reply?: string; diagnostics?: string; sessionId?: string; missingKey?: { provider: string; envVar: string }; materializeFailed?: boolean; timedOut?: boolean }> {
    const startedAt = Date.now();
    agentLogs.push({
      source: 'chat',
      level: 'info',
      summary: `→ Prompt: ${prompt.length > 120 ? prompt.slice(0, 120) + '…' : prompt}`,
    });
    const mat = await materializeHermesEnv();

    // Mirror the Permissions panel into config.yaml so sub-agents and other
    // Hermes processes that don't go through our stdin interceptor still
    // honor the user's rules. This is the real fix for "agent says no
    // internet even though I set Allow".
    if (permissions) {
      await writeHermesPermissions(permissions).catch(() => undefined);
    }

    // Hard-fail before invoking hermes if we couldn't sync secrets.
    // Calling `hermes chat` against a stale/empty .env would just produce a
    // misleading "No API key found" error that sends the user on a wild goose
    // chase. Better to surface the actual sync failure with a link to the
    // Diagnostics page.
    if (!mat.success) {
      const matErr = mat.error || 'unknown error';
      const missingNote = mat.missing && mat.missing.length > 0
        ? ` Missing keys after write: ${mat.missing.join(', ')}.`
        : '';
      agentLogs.push({
        source: 'chat',
        level: 'error',
        summary: `Sync to ~/.hermes/.env failed — chat aborted`,
        detail: `${matErr}${missingNote}`,
        durationMs: Date.now() - startedAt,
      });
      return {
        success: false,
        stdout: '',
        stderr: `Failed to sync secrets to ~/.hermes/.env: ${matErr}.${missingNote} Open the Diagnostics page to see the exact shell command and output.`,
        code: 1,
        reply: '',
        diagnostics: `materializeEnv failed: ${matErr}${missingNote}`,
        materializeFailed: true,
      };
    }

    const promptB64 = encodeScript(prompt);
    // Official Hermes CLI: one-shot non-interactive prompts use `hermes chat -q`
    // / `--query` (see CLI reference). Session resume is a `chat` subcommand
    // flag: `hermes chat --resume <id> -q "..."`. Do not use `-p` here — `-p`
    // is the global profile selector, not a prompt flag.
    await ensureHermesChatCaps();
    const caps = getHermesChatCaps();
    const noColorFlag = caps.supportsNoColor ? ' --no-color' : '';
    const quietFlag = caps.supportsQuiet ? ' --quiet' : '';
    const effectiveTimeout = Math.max(60_000, timeoutMs ?? 600_000);

    if (conversationKey) {
      try {
        const persistentResult = await runPersistentChatTurn(conversationKey, {
          prompt,
          resumeId,
          noColorFlag,
          quietFlag,
          timeoutMs: effectiveTimeout,
          onOutput,
          onStreamId,
        });
        const { cleaned, sessionId, diagnostics } = processChatTranscript(
          prompt,
          persistentResult.stdout || persistentResult.reply || '',
          resumeId,
          false,
        );
        let finalReply = finalizeTerminalTranscript(cleaned, prompt) || cleaned;
        const timedOut = !persistentResult.success && persistentResult.code === 124;
        if (timedOut) {
          const seconds = Math.round(effectiveTimeout / 1000);
          finalReply = [
            `⏱ The agent didn't finish within the ${seconds}s chat timeout.`,
            '',
            'Raise the limit in Settings → Sessions & history → "Per-prompt timeout".',
          ].join('\n');
        }
        return {
          ...persistentResult,
          reply: finalReply,
          diagnostics,
          sessionId,
          timedOut,
        };
      } catch (err) {
        agentLogs.push({
          source: 'chat',
          level: 'warn',
          summary: 'Persistent Hermes session failed — falling back to one-shot chat',
          detail: err instanceof Error ? err.message : String(err),
        });
        await disposePersistentChat(conversationKey).catch(() => undefined);
      }
    }

    const hermesOneShot = resumeId
      ? `hermes chat --resume ${JSON.stringify(resumeId)} -q "$PROMPT"${quietFlag}${noColorFlag} 2>&1`
      : `hermes chat -q "$PROMPT"${quietFlag}${noColorFlag} 2>&1`;
    const chatInvocation = wrapCommandInPty(hermesOneShot);
    const script = [
      'set -e',
      'export PATH="$HOME/.hermes/venv/bin:$HOME/.local/bin:$PATH"',
      'export TERM=dumb NO_COLOR=1 CI=1 PYTHONUNBUFFERED=1',
      'if [ -f "$HOME/.hermes/.env" ]; then',
      '  set -a',
      '  # shellcheck disable=SC1091',
      '  . "$HOME/.hermes/.env"',
      '  set +a',
      '  echo "[hermes-diag] sourced ~/.hermes/.env ($(wc -l < "$HOME/.hermes/.env") lines)" >&2',
      'else',
      '  echo "[hermes-diag] WARNING: ~/.hermes/.env does not exist" >&2',
      'fi',
      'for v in OPENROUTER_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY GOOGLE_API_KEY NOUS_API_KEY DEEPSEEK_API_KEY; do',
      '  eval "val=\\${$v}"',
      '  if [ -n "$val" ]; then echo "[hermes-diag] $v is set (len=${#val})" >&2; else echo "[hermes-diag] $v is NOT set" >&2; fi',
      'done',
      'if [ -f "$HOME/.hermes/config.yaml" ]; then',
      '  MODEL_LINE="$(grep -E "^\\s*model:" "$HOME/.hermes/config.yaml" | head -n1)"',
      '  echo "[hermes-diag] config model: ${MODEL_LINE:-<none>}" >&2',
      'else',
      '  echo "[hermes-diag] WARNING: ~/.hermes/config.yaml does not exist" >&2',
      'fi',
      'command -v hermes >/dev/null 2>&1 || { echo "[hermes-diag] FATAL: hermes CLI not found on PATH" >&2; exit 127; }',
      `PROMPT="$(echo ${promptB64} | base64 -d)"`,
      'cd "$HOME/.hermes" 2>/dev/null || true',
      'echo "[hermes-diag] invocation: hermes chat -q (official one-shot)" >&2',
      chatInvocation,
    ].join('\n');

    // Detect Hermes' interactive `Choice [o/s/a/D]:` permission prompts in
    // the streamed output and route them through the approval dialog.
    let activeStreamId: string | null = null;
    let promptBuffer = '';
    let answeringPrompt = false;
    let pendingApproval: { action: ReturnType<typeof guessAction>; target: string } | null = null;

    const answerApproval = (action: ReturnType<typeof guessAction>, target: string) => {
      const handler = getApprovalHandler();
      const sid = activeStreamId;
      if (!handler) {
        recordPermissionEvent({ action, target, decision: 'auto-denied', prompted: false });
        if (sid) void coreAPI.writeStreamStdin(sid, 'd\n').catch(() => undefined);
        return;
      }
      if (!sid) {
        pendingApproval = { action, target };
        return;
      }
      answeringPrompt = true;
      pendingApproval = null;
      promptBuffer = '';
      void handler({ action, target }).then((choice) => {
        void coreAPI.writeStreamStdin(sid, choiceToStdin(choice)).catch(() => undefined);
        answeringPrompt = false;
      });
    };

    const wrappedOnStreamId = (id: string) => {
      activeStreamId = id;
      onStreamId?.(id);
      if (pendingApproval) answerApproval(pendingApproval.action, pendingApproval.target);
    };

    const interceptingOnOutput: CommandOutputHandler = (chunk) => {
      onOutput?.(chunk);
      if (chunk.type !== 'stdout' && chunk.type !== 'stderr') return;
      const text = chunk.data || '';
      if (!text) return;
      promptBuffer = (promptBuffer + text).slice(-8000);
      if (answeringPrompt) return;
      if (!matchesApprovalPrompt(promptBuffer)) return;

      const lines = promptBuffer.split('\n').filter((l) => l.trim());
      let promptIdx = lines.findIndex((l) => matchesApprovalPrompt(l));
      if (promptIdx < 0) promptIdx = lines.length - 1;
      const ctxLines = lines.slice(Math.max(0, promptIdx - 20), promptIdx).join('\n').trim();
      const target = ctxLines.slice(-1500) || '(action details not captured)';
      const action = guessAction(ctxLines);

      if (isDebugPromptDetection()) {
        agentLogs.push({
          source: 'chat',
          level: 'debug',
          summary: `[approval] prompt detected · action=${action}`,
          detail: target,
        });
      }

      answerApproval(action, target);
    };
    let result = await runHermesShell(script, { timeout: effectiveTimeout, onStreamId: wrappedOnStreamId }, interceptingOnOutput);

    // Hermes refuses unknown resume ids with:
    //   "Session not found: <id>\nUse a session ID from a previous CLI run …"
    // This typically happens after a fresh install or after the user wiped
    // ~/.hermes/sessions while the panel still had the old id cached. Auto-
    // recover by retrying once WITHOUT --resume so the agent starts a brand
    // new session, then clear the stored id by returning sessionId=null.
    let sessionWasInvalid = false;
    if (resumeId && /session not found:/i.test(`${result.stdout || ''}\n${result.stderr || ''}`)) {
      sessionWasInvalid = true;
      agentLogs.push({
        source: 'chat',
        level: 'warn',
        summary: `Stale resume id ${resumeId} — starting a fresh session`,
      });
      const freshInvocation = wrapCommandInPty(`hermes chat -q "$PROMPT"${quietFlag}${noColorFlag} 2>&1`);
      const freshScript = script.replace(chatInvocation, freshInvocation);
      result = await runHermesShell(freshScript, { timeout: effectiveTimeout, onStreamId: wrappedOnStreamId }, interceptingOnOutput);
    }

    const timedOut = !result.success && (result.code === 124 || /timed out after/i.test(result.stderr || ''));

    const { cleaned, sessionId, diagnostics } = processChatTranscript(
      prompt,
      result.stdout || '',
      resumeId,
      sessionWasInvalid,
    );

    // Detect Hermes's "no inference provider" / "missing API key" error so the
    // UI can render an actionable CTA → Secrets tab.
    let missingKey: { provider: string; envVar: string } | undefined;
    if (classifyChatError(cleaned) !== 'other') {
      const cfg = await readHermesFile(HERMES_CONFIG);
      const modelLine = cfg.success ? cfg.content?.match(/^\s*model:\s*(.+)\s*$/m)?.[1]?.trim() ?? '' : '';
      const provider = modelLine.split('/')[0]?.toLowerCase() ?? '';

      // Local providers don't need a key — never nag.
      const LOCAL_PROVIDERS = new Set(['ollama', 'local', 'lmstudio', 'llamacpp', 'vllm', 'tgi']);
      if (!LOCAL_PROVIDERS.has(provider)) {
        const envByProvider: Record<string, { provider: string; envVar: string }> = {
          openrouter: { provider: 'OpenRouter', envVar: 'OPENROUTER_API_KEY' },
          openai: { provider: 'OpenAI', envVar: 'OPENAI_API_KEY' },
          anthropic: { provider: 'Anthropic', envVar: 'ANTHROPIC_API_KEY' },
          google: { provider: 'Google', envVar: 'GOOGLE_API_KEY' },
          deepseek: { provider: 'DeepSeek', envVar: 'DEEPSEEK_API_KEY' },
          nous: { provider: 'Nous Portal', envVar: 'NOUS_API_KEY' },
        };
        const candidate = envByProvider[provider];
        // Only flag missing key when the diagnostic confirms the env var is
        // genuinely NOT set in the chat shell. The diagnostic is the source
        // of truth — it ran with the same env hermes saw. If diag says it's
        // set, hermes had it too, so the real problem is config (e.g.
        // unrecognized model), not a missing key.
        if (candidate) {
          const diagSaysSet = new RegExp(`${candidate.envVar}\\s+is\\s+set`).test(diagnostics);
          if (!diagSaysSet) missingKey = candidate;
        }
      }
    }

    let finalReply = finalizeTerminalTranscript(cleaned, prompt) || stripAnsi(result.stdout || '').trim();
    const finalDiag = diagnostics || (mat.success ? '' : `materializeEnv failed: ${mat.error || 'unknown'}`);

    // Replace whatever partial output we got with a clear, actionable
    // message when the underlying process was killed by the timeout. The
    // raw "Command timed out after 600000ms" line is technically true but
    // unhelpful — the user wants to know what to do about it.
    if (timedOut) {
      const seconds = Math.round(effectiveTimeout / 1000);
      finalReply = [
        `⏱ The agent didn't finish within the ${seconds}s chat timeout.`,
        '',
        'Long multi-step tasks (sub-agents, file generation, repeated tool calls)',
        'can take many minutes. You can raise this limit in Settings → Sessions',
        '& history → "Per-prompt timeout".',
        '',
        'The partial output (if any) was discarded so it isn\'t mistaken for a',
        'completed answer.',
      ].join('\n');
    }

    if (missingKey) {
      agentLogs.push({
        source: 'chat',
        level: 'error',
        summary: `Missing API key: ${missingKey.envVar} (${missingKey.provider})`,
        detail: finalDiag,
        durationMs: Date.now() - startedAt,
      });
    } else if (timedOut) {
      agentLogs.push({
        source: 'chat',
        level: 'error',
        summary: `Chat timed out after ${Math.round(effectiveTimeout / 1000)}s — raise "Per-prompt timeout" in Settings`,
        detail: truncateForLog([finalDiag, result.stderr].filter(Boolean).join('\n')),
        durationMs: Date.now() - startedAt,
      });
    } else if (!result.success) {
      agentLogs.push({
        source: 'chat',
        level: 'error',
        summary: `Chat failed (exit=${result.code})`,
        detail: truncateForLog([finalReply, finalDiag, result.stderr].filter(Boolean).join('\n')),
        durationMs: Date.now() - startedAt,
      });
    } else {
      agentLogs.push({
        source: 'chat',
        level: 'info',
        summary: `← Reply: ${finalReply.length > 120 ? finalReply.slice(0, 120) + '…' : finalReply || '(empty)'}`,
        detail: truncateForLog([finalReply, finalDiag ? `\n--- diagnostics ---\n${finalDiag}` : ''].filter(Boolean).join('')),
        durationMs: Date.now() - startedAt,
      });
    }

    return {
      ...result,
      reply: finalReply,
      diagnostics: finalDiag,
      sessionId,
      missingKey,
      timedOut,
    };
  },

  /** Write the SOUL.md persona file so the agent knows its given name. */
  async setAgentName(name: string): Promise<{ success: boolean }> {
    const trimmed = (name || '').trim();
    if (!trimmed) return { success: false };
    const soul = buildDefaultSoulMarkdown(trimmed);
    return writeHermesFile('$HOME/.hermes/SOUL.md', soul, '600');
  },

  /** Read the agent's display name from SOUL.md (Ronbot template or legacy H1). */
  async getAgentName(): Promise<string | null> {
    const r = await readHermesFile('$HOME/.hermes/SOUL.md');
    if (!r.success || !r.content) return null;
    return parseAgentDisplayNameFromSoul(r.content);
  },

  /** Write initial config for first-time setup.
   *  If `name` is provided, also writes a SOUL.md persona file so the agent
   *  knows what to call itself across every conversation. */
  async writeInitialConfig(options: {
    model?: string;
    name?: string;
  }): Promise<{ success: boolean }> {
    const configYaml = `# Ronbot — Hermes Agent Configuration
# Managed by Ronbot Control Panel

model: ${options.model || 'openrouter/auto'}
`;
    const configResult = await this.writeConfig(configYaml);
    // Bootstrap a fresh agent with the official `hermes-cli` toolset already
    // loaded so web/browser/terminal/file/etc. work immediately.
    const initialYaml = `${configYaml}\n# ─── Managed by Ronbot: toolsets (do not edit) ───\ntoolsets:\n  - hermes-cli\n# ─── End Ronbot toolsets ───\n`;
    await this.writeConfig(initialYaml).catch(() => undefined);
    if (configResult.success) {
      // Use the up-to-date defaults so all per-tool keys are emitted.
      const { DEFAULT_PERMISSIONS } = await import('../permissions');
      await writeHermesPermissions(DEFAULT_PERMISSIONS).catch(() => undefined);
      await writeBrowserBlock({ camofoxPersistence: false, cdpUrl: null }).catch(() => undefined);
      await this.setSkillEnabled('browser', true).catch(() => undefined);
      // Make sure shipped browser binaries are executable so the agent can
      // actually call them (Errno 13 fix).
      await runHermesShell(BROWSER_EXECUTABLE_FIX_SCRIPT, { timeout: 15000 }).catch(() => undefined);
    }

    if (options.name && options.name.trim()) {
      await this.setAgentName(options.name);
    }

    return configResult;
  },

  /** Structured install probe (setup + diagnostics). */
  async inspectHermesInstall(): Promise<HermesInstallProbe> {
    return inspectHermesInstall();
  },

  /** Check if hermes config directory exists */
  async isConfigured(): Promise<boolean> {
    return hasUsableHermesInstall(await inspectHermesInstall());
  },

  /**
   * List skills installed for the agent.
   *
   * Hermes stores skills as folders. We scan a few well-known locations and
   * de-duplicate by skill name:
   *   - ~/.hermes/skills/<category>/<skill>/   (user-installed skills)
   *   - ~/.hermes/skills/<skill>/              (flat layout)
   *   - <site-packages>/hermes_agent/skills/   (skills bundled with the pip
   *     install — these are the "75 skills" shown on first launch).
   *
   * Each skill directory typically has a SKILL.md or skill.md describing it;
   * we surface the first non-empty line as a short description when present.
   */
  async listSkills(): Promise<{
    success: boolean;
    skills: Array<{ name: string; category: string; source: 'user' | 'bundled'; description?: string; requiredSecrets?: string[] }>;
    error?: string;
  }> {
    return fetchInstalledSkillsList();
  },

  /** Read the `skills:` block from config.yaml and return enabled/disabled lists. */
  async getSkillsConfig(): Promise<{ enabled: string[]; disabled: string[] }> {
    const r = await this.readConfig();
    if (!r.success || !r.content) return { enabled: [], disabled: [] };
    const lines = r.content.split('\n');
    const result = { enabled: [] as string[], disabled: [] as string[] };
    let mode: 'enabled' | 'disabled' | null = null;
    let inSkills = false;
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      if (/^skills:\s*$/.test(line)) { inSkills = true; continue; }
      if (inSkills && /^[A-Za-z_][A-Za-z0-9_-]*:/.test(line)) {
        // A new top-level key terminates the skills block.
        if (!/^\s/.test(line)) { inSkills = false; mode = null; continue; }
      }
      if (!inSkills) continue;
      const enabledMatch = line.match(/^\s+enabled:\s*(.*)$/);
      const disabledMatch = line.match(/^\s+disabled:\s*(.*)$/);
      if (enabledMatch) {
        mode = 'enabled';
        const inline = enabledMatch[1].trim();
        if (inline.startsWith('[') && inline.endsWith(']')) {
          result.enabled = inline.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
          mode = null;
        }
        continue;
      }
      if (disabledMatch) {
        mode = 'disabled';
        const inline = disabledMatch[1].trim();
        if (inline.startsWith('[') && inline.endsWith(']')) {
          result.disabled = inline.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
          mode = null;
        }
        continue;
      }
      const itemMatch = line.match(/^\s+-\s+(.+?)\s*$/);
      if (itemMatch && mode) {
        const v = itemMatch[1].replace(/^["']|["']$/g, '').trim();
        if (v) result[mode].push(v);
      }
    }
    return result;
  },

  /**
   * Toggle a skill's enabled state in config.yaml. Persists the entire
   * `skills:` block as a fresh YAML section, leaving the rest of the file
   * untouched. Takes effect on the next agent restart.
   */
  async setSkillEnabled(name: string, enabled: boolean): Promise<{ success: boolean; error?: string }> {
    const current = await this.getSkillsConfig();
    const enabledSet = new Set(current.enabled);
    const disabledSet = new Set(current.disabled);
    if (enabled) {
      disabledSet.delete(name);
      // Most agent configs default-allow, so we don't need to add to enabled.
      // But preserve if it was already explicitly enabled.
    } else {
      enabledSet.delete(name);
      disabledSet.add(name);
    }
    const r = await this.readConfig();
    const original = r.success && r.content ? r.content : 'model: openrouter/auto\n';
    // Strip any existing skills: block (top-level only).
    const lines = original.split('\n');
    const out: string[] = [];
    let skipping = false;
    for (const line of lines) {
      if (/^skills:\s*$/.test(line)) { skipping = true; continue; }
      if (skipping) {
        // End block on next top-level (non-indented, non-blank) line.
        if (line.length > 0 && !/^\s/.test(line)) { skipping = false; out.push(line); continue; }
        continue;
      }
      out.push(line);
    }
    let body = out.join('\n').replace(/\n+$/, '');
    const enabledList = Array.from(enabledSet);
    const disabledList = Array.from(disabledSet);
    if (enabledList.length || disabledList.length) {
      body += '\n\nskills:\n';
      if (enabledList.length) {
        body += '  enabled:\n' + enabledList.map((n) => `    - "${n}"`).join('\n') + '\n';
      }
      if (disabledList.length) {
        body += '  disabled:\n' + disabledList.map((n) => `    - "${n}"`).join('\n') + '\n';
      }
    }
    body += '\n';
    const w = await this.writeConfig(body);
    return { success: w.success, error: w.success ? undefined : 'Failed to write config.yaml' };
  },

  /**
   * Inspect the Hermes agent log to surface subagent (delegate_task) activity.
   *
   * Hermes does not expose a "list subagents" CLI — subagents are ephemeral
   * threads spawned inside an active chat turn by the `delegate_task` tool.
   * The only durable trace they leave is in `~/.hermes/logs/agent.log`, where
   * the parent agent emits `subagent.start` / `subagent.complete` events plus
   * the original `delegate_task` tool call (which carries the goal text).
   *
   * We tail the last ~24 h of agent.log, pair starts with completes, and
   * return two buckets:
   *   - `active`:   started but not yet completed
   *   - `recent`:   completed within the window (newest first, capped to 25)
   *
   * Returns `{ success: false }` only if the log file genuinely can't be read;
   * an empty install with no log yet returns `success: true` with empty arrays.
   */
  async tailAgentLog(options?: { lines?: number }) {
    return runTailAgentLog(options);
  },

  async listSubAgents(): Promise<{
    success: boolean;
    error?: string;
    active: Array<{ id: string; goal: string; startedAt: string; lastActivity?: string; lastEvent?: string }>;
    recent: Array<{ id: string; goal: string; startedAt: string; completedAt: string; durationMs: number; summary?: string }>;
    failed: Array<{ id: string; goal: string; startedAt: string; failedAt: string; reason?: string }>;
    logPath: string;
    /** True when the agent log file does not exist (Hermes file logging is off). */
    loggingDisabled?: boolean;
  }> {
    const logPath = '$HOME/.hermes/logs/agent.log';
    const result = await runHermesShell([
      `LOG="${logPath}"`,
      'if [ ! -f "$LOG" ]; then exit 3; fi',
      'tail -n 4000 "$LOG"',
    ].join('\n'), { timeout: 10000 });

    if (!result.success) {
      // exit 3 = log file missing entirely (file logging not enabled, or
      // agent never ran). Surface that to the UI so we can show an
      // actionable banner instead of a blank tab.
      if (result.code === 3) {
        return {
          success: true,
          active: [],
          recent: [],
          failed: [],
          logPath: '~/.hermes/logs/agent.log',
          loggingDisabled: true,
        };
      }
      return {
        success: false,
        error: result.stderr || 'Failed to read agent log',
        active: [],
        recent: [],
        failed: [],
        logPath: '~/.hermes/logs/agent.log',
      };
    }

    const parsed = parseSubAgentLog((result.stdout || '').split('\n'));

    return {
      success: true,
      logPath: '~/.hermes/logs/agent.log',
      active: parsed.active,
      recent: parsed.recent,
      failed: parsed.failed,
    };
  },

  /**
   * One-shot config repair for installs broken by older versions of this app.
   *
   * - Rewrites the managed `toolsets:` block to the official `hermes-cli`.
   * - Strips the bogus `browser.enabled` / `browser.allow_network` /
   *   `browser.tool_allowlist` keys we used to write.
   * - Re-chmods `node_modules/.bin/*` so `agent-browser` / `playwright` are
   *   executable (Errno 13 fix).
   * - Re-runs `hermes doctor` and reports the result.
   */
  async repairConfig(): Promise<{ success: boolean; doctorOutput: string; error?: string }> {
    try {
      // 1. Re-write toolsets + browser block (this picks up the new schema).
      const cfg = await readHermesFile(HERMES_CONFIG);
      const existing = cfg.success && cfg.content ? cfg.content : '';
      const current = parseBrowserBlock(existing);

      // Also surgically strip any legacy `enabled:` / `allow_network:` /
      // `tool_allowlist:` lines that might be sitting outside our managed
      // block (left over from an older config).
      const cleaned = existing
        .replace(/^\s*enabled:\s*true\s*$/gim, '')
        .replace(/^\s*allow_network:\s*true\s*$/gim, '')
        .replace(/^\s*tool_allowlist:[\s\S]*?(?=\n\S|\n#|$)/gim, '');
      if (cleaned !== existing) {
        await writeHermesFile(HERMES_CONFIG, cleaned, '600').catch(() => undefined);
      }

      const browserResult = await writeBrowserBlock(current);
      if (!browserResult.success) {
        return { success: false, doctorOutput: '', error: browserResult.error };
      }

      // 2. Fix executable permissions on shipped binaries.
      await runHermesShell(BROWSER_EXECUTABLE_FIX_SCRIPT, { timeout: 15000 }).catch(() => undefined);

      // 3. Run doctor to verify.
      const doc = await this.doctor();
      return {
        success: doc.success,
        doctorOutput: doc.stdout || doc.stderr || '(no output)',
      };
    } catch (e) {
      return { success: false, doctorOutput: '', error: e instanceof Error ? e.message : String(e) };
    }
  },

  /** Reload toolsets without restarting the agent (best-effort). */
  async reloadToolsets(): Promise<CommandResult> {
    return runHermesCli('hermes toolsets reload 2>/dev/null || hermes reload 2>/dev/null || echo "Toolsets will reload on next agent start"');
  },

  /**
   * Run `hermes config check` (documented schema validation). Returns the
   * raw output so the caller can show pass/fail in the install summary.
   */
  async configCheck(): Promise<CommandResult> {
    return runHermesCli('hermes config check 2>&1 || hermes doctor 2>&1');
  },

  /**
   * Send a single "ping" prompt and confirm we get any non-empty reply back.
   * Used as the final post-install sanity check (catches "doctor green but
   * provider auth wrong"). Uses modern `-p` flag automatically.
   */
  async chatPing(): Promise<{ success: boolean; reply: string; error?: string }> {
    try {
      const r = await this.chat('ping', undefined, undefined, undefined, 60000);
      const reply = (r.reply || '').trim();
      return {
        success: !!reply && r.success !== false && !r.missingKey,
        reply: reply.slice(0, 500),
        error: r.missingKey ? `Missing API key: ${r.missingKey.envVar}` : (r.success ? undefined : r.stderr),
      };
    } catch (e) {
      return { success: false, reply: '', error: e instanceof Error ? e.message : String(e) };
    }
  },

  /**
   * Install a Hermes skill from a local folder. Copies `srcPath` to
   * `~/.hermes/skills/<basename>/`, validates a manifest exists, fixes
   * executable permissions, and enables the skill in config.yaml.
   */
  async installSkillFromPath(srcPath: string): Promise<{
    success: boolean;
    skillName?: string;
    hasManifest?: boolean;
    requiredSecrets?: string[];
    error?: string;
  }> {
    if (!srcPath || !srcPath.trim()) {
      return { success: false, error: 'No source path provided' };
    }
    const platform = await coreAPI.getPlatform();
    const wslSrc = platform.isWindows ? toWslMountedPath(srcPath) ?? srcPath : srcPath;
    const escaped = wslSrc.replace(/"/g, '\\"');
    const script = [
      'set -e',
      `SRC="${escaped}"`,
      '[ -d "$SRC" ] || { echo "ERR_NOT_DIR" >&2; exit 2; }',
      'NAME="$(basename "$SRC")"',
      'DEST="$HOME/.hermes/skills/$NAME"',
      'mkdir -p "$HOME/.hermes/skills"',
      'rm -rf "$DEST"',
      'cp -R "$SRC" "$DEST"',
      'find "$DEST" -type f \\( -name "*.sh" -o -name "*.py" \\) -exec chmod +x {} + 2>/dev/null || true',
      // Validation
      'HAS_MANIFEST=0',
      'for f in manifest.yaml skill.yaml SKILL.md skill.md __init__.py; do',
      '  [ -f "$DEST/$f" ] && HAS_MANIFEST=1 && break',
      'done',
      'echo "NAME=$NAME"',
      'echo "HAS_MANIFEST=$HAS_MANIFEST"',
      // Best-effort secret extraction from manifest
      'SECRETS=""',
      'for f in "$DEST/manifest.yaml" "$DEST/skill.yaml"; do',
      '  if [ -f "$f" ]; then',
      '    SECRETS="$(grep -E "^\\s*-\\s*[A-Z][A-Z0-9_]+\\s*$" "$f" 2>/dev/null | sed -E "s/^\\s*-\\s*//" | tr "\\n" "," || true)"',
      '    break',
      '  fi',
      'done',
      'echo "SECRETS=$SECRETS"',
    ].join('\n');
    const r = await runHermesShell(script, { timeout: 60000 });
    if (!r.success) {
      return { success: false, error: r.stderr || r.stdout || 'Failed to install skill' };
    }
    const nameMatch = r.stdout.match(/NAME=(.+)/);
    const manifestMatch = r.stdout.match(/HAS_MANIFEST=(\d)/);
    const secretsMatch = r.stdout.match(/SECRETS=(.*)/);
    const skillName = nameMatch?.[1].trim();
    const hasManifest = manifestMatch?.[1] === '1';
    const requiredSecrets = secretsMatch?.[1]
      ? secretsMatch[1].split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    if (skillName) {
      await this.setSkillEnabled(skillName, true).catch(() => undefined);
    }
    return { success: true, skillName, hasManifest, requiredSecrets };
  },

  /** Install a Hermes skill by cloning a Git URL into ~/.hermes/skills/. */
  async installSkillFromGit(url: string): Promise<{
    success: boolean;
    skillName?: string;
    hasManifest?: boolean;
    requiredSecrets?: string[];
    error?: string;
  }> {
    if (!url || !url.trim()) {
      return { success: false, error: 'No Git URL provided' };
    }
    const escaped = url.replace(/"/g, '\\"');
    const script = [
      'set -e',
      `URL="${escaped}"`,
      'NAME="$(basename "$URL" .git)"',
      'DEST="$HOME/.hermes/skills/$NAME"',
      'mkdir -p "$HOME/.hermes/skills"',
      'rm -rf "$DEST"',
      'git clone --depth=1 "$URL" "$DEST" 2>&1',
      'find "$DEST" -type f \\( -name "*.sh" -o -name "*.py" \\) -exec chmod +x {} + 2>/dev/null || true',
      'HAS_MANIFEST=0',
      'for f in manifest.yaml skill.yaml SKILL.md skill.md __init__.py; do',
      '  [ -f "$DEST/$f" ] && HAS_MANIFEST=1 && break',
      'done',
      'echo "NAME=$NAME"',
      'echo "HAS_MANIFEST=$HAS_MANIFEST"',
    ].join('\n');
    const r = await runHermesShell(script, { timeout: 120000 });
    if (!r.success) {
      return { success: false, error: r.stderr || r.stdout || 'Failed to clone skill' };
    }
    const nameMatch = r.stdout.match(/NAME=(.+)/);
    const manifestMatch = r.stdout.match(/HAS_MANIFEST=(\d)/);
    const skillName = nameMatch?.[1].trim();
    const hasManifest = manifestMatch?.[1] === '1';
    if (skillName) {
      await this.setSkillEnabled(skillName, true).catch(() => undefined);
    }
    return { success: true, skillName, hasManifest, requiredSecrets: [] };
  },


  /** Install a Hermes tool from a local folder into ~/.hermes/tools/. */
  async installToolFromPath(srcPath: string): Promise<{
    success: boolean;
    toolName?: string;
    error?: string;
  }> {
    if (!srcPath || !srcPath.trim()) {
      return { success: false, error: 'No source path provided' };
    }
    const platform = await coreAPI.getPlatform();
    const wslSrc = platform.isWindows ? toWslMountedPath(srcPath) ?? srcPath : srcPath;
    const escaped = wslSrc.replace(/"/g, '\\"');
    const script = [
      'set -e',
      `SRC="${escaped}"`,
      '[ -d "$SRC" ] || { echo "ERR_NOT_DIR" >&2; exit 2; }',
      'NAME="$(basename "$SRC")"',
      'DEST="$HOME/.hermes/tools/$NAME"',
      'mkdir -p "$HOME/.hermes/tools"',
      'rm -rf "$DEST"',
      'cp -R "$SRC" "$DEST"',
      'find "$DEST" -type f \\( -name "*.sh" -o -name "*.py" -o -name "*.js" \\) -exec chmod +x {} + 2>/dev/null || true',
      'echo "NAME=$NAME"',
    ].join('\n');
    const r = await runHermesShell(script, { timeout: 60000 });
    if (!r.success) {
      return { success: false, error: r.stderr || r.stdout || 'Failed to install tool' };
    }
    const nameMatch = r.stdout.match(/NAME=(.+)/);
    return { success: true, toolName: nameMatch?.[1].trim() };
  },

  /** Open the user's ~/.hermes/skills folder in the OS file manager. */
  async revealSkillsFolder(): Promise<{ success: boolean; error?: string }> {
    const platform = await coreAPI.getPlatform();
    let cmd: string;
    if (platform.isWindows) {
      // Hermes lives in WSL on Windows. Convert the Linux path to a Windows
      // UNC path first so Explorer opens the actual skills directory.
      const p = await runHermesShell('wslpath -w "$HOME/.hermes/skills" 2>/dev/null || true', { timeout: 5000 });
      const winPath = (p.stdout || "").split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      cmd = winPath ? `explorer.exe "${winPath.replace(/"/g, '\\"')}"` : 'explorer.exe "%USERPROFILE%\\.hermes\\skills"';
    } else if (platform.isMac) {
      cmd = 'open "$HOME/.hermes/skills"';
    } else {
      cmd = 'xdg-open "$HOME/.hermes/skills" 2>/dev/null || true';
    }
    const r = await coreAPI.runCommand(cmd, { timeout: 5000 });
    if (!r.success) {
      return { success: false, error: r.stderr?.trim() || r.stdout?.trim() || 'Could not open skills folder' };
    }
    return { success: true };
  },

  /**
   * Real CDP round-trip: open a tab, navigate it to example.com, verify the
   * frame URL came back, then close the tab. Proves the agent can actually
   * drive Chrome — not just that the port is listening.
   */
  async probeBrowserNavigate(cdpUrl: string, timeoutMs = 8000): Promise<{
    ok: boolean;
    error?: string;
    finalUrl?: string;
  }> {
    const base = cdpUrl.replace(/\/+$/, '');
    let targetId: string | undefined;
    let wsUrl: string | undefined;
    try {
      // 1. Open a new tab.
      const newResp = await fetch(`${base}/json/new?about:blank`, { method: 'PUT' }).catch(() =>
        fetch(`${base}/json/new?about:blank`, { method: 'GET' }),
      );
      if (!newResp || !newResp.ok) {
        return { ok: false, error: `CDP /json/new returned ${newResp?.status ?? 'no response'}` };
      }
      const newJson = await newResp.json() as { id?: string; webSocketDebuggerUrl?: string };
      targetId = newJson.id;
      wsUrl = newJson.webSocketDebuggerUrl;
      if (!wsUrl) return { ok: false, error: 'CDP /json/new missing webSocketDebuggerUrl' };

      // 2-3. Open WS, send Page.navigate then Page.getFrameTree.
      const finalUrl: string = await new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl!);
        let msgId = 0;
        const pending = new Map<number, (v: unknown) => void>();
        const timer = setTimeout(() => {
          try { ws.close(); } catch { /* ignore */ }
          reject(new Error(`CDP probe timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        const send = (method: string, params?: Record<string, unknown>) => {
          const id = ++msgId;
          return new Promise<unknown>((res) => {
            pending.set(id, res);
            ws.send(JSON.stringify({ id, method, params: params ?? {} }));
          });
        };
        ws.onopen = async () => {
          try {
            await send('Page.enable');
            await send('Page.navigate', { url: 'https://example.com' });
            // Give the page a moment to commit before reading the tree.
            await new Promise((r) => setTimeout(r, 1200));
            const tree = await send('Page.getFrameTree') as {
              result?: { frameTree?: { frame?: { url?: string } } };
            };
            const url = tree?.result?.frameTree?.frame?.url ?? '';
            clearTimeout(timer);
            try { ws.close(); } catch { /* ignore */ }
            resolve(url);
          } catch (e) {
            clearTimeout(timer);
            try { ws.close(); } catch { /* ignore */ }
            reject(e);
          }
        };
        ws.onerror = () => {
          clearTimeout(timer);
          reject(new Error('CDP WebSocket error'));
        };
        ws.onmessage = (ev) => {
          try {
            const data = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
            if (typeof data.id === 'number' && pending.has(data.id)) {
              const resolver = pending.get(data.id)!;
              pending.delete(data.id);
              resolver(data);
            }
          } catch { /* ignore non-JSON frames */ }
        };
      });

      const navOk = /example\.com/i.test(finalUrl);
      return navOk
        ? { ok: true, finalUrl }
        : { ok: false, error: `Navigation did not land on example.com (got "${finalUrl}")`, finalUrl };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      // 4. Close the tab we opened (best-effort).
      if (targetId) {
        try { await fetch(`${base}/json/close/${targetId}`, { method: 'GET' }); } catch { /* ignore */ }
      }
    }
  },

  /**
   * Aggregated browser self-test. Runs everything Diagnostics + the install
   * flow want to know about Ron's browser stack in one call.
   */
  async runBrowserSelfTest(): Promise<{
    cdpUrl: string | null;
    cdpReachable: boolean | null;
    cdpVersion?: string;
    navigateOk: boolean | null;
    navigateError?: string;
    navigateFinalUrl?: string;
    webSearchBackend: 'tavily' | 'exa' | 'firecrawl' | 'parallel' | null;
    hermesCliToolsetLoaded: boolean;
    doctorReportsBrowser: boolean | null;
  }> {
    const diag = await this.getBrowserDiagnostics();

    // Which web-search backend (if any) does the user have a key for?
    let webSearchBackend: 'tavily' | 'exa' | 'firecrawl' | 'parallel' | null = null;
    try {
      const keys = await secretsStore.list();
      const set = new Set((keys.keys || []).map((k) => k.toUpperCase()));
      if (set.has('TAVILY_API_KEY')) webSearchBackend = 'tavily';
      else if (set.has('EXA_API_KEY')) webSearchBackend = 'exa';
      else if (set.has('FIRECRAWL_API_KEY')) webSearchBackend = 'firecrawl';
      else if (set.has('PARALLEL_API_KEY')) webSearchBackend = 'parallel';
    } catch { /* ignore */ }

    // Real CDP round-trip (only if CDP is wired and reachable).
    let navigateOk: boolean | null = null;
    let navigateError: string | undefined;
    let navigateFinalUrl: string | undefined;
    if (diag.cdpUrl && diag.cdpReachable) {
      const probe = await this.probeBrowserNavigate(diag.cdpUrl);
      navigateOk = probe.ok;
      navigateError = probe.error;
      navigateFinalUrl = probe.finalUrl;
    }

    // Optional doctor grep (cheap one-shot).
    let doctorReportsBrowser: boolean | null = null;
    try {
      const d = await runHermesCli('hermes doctor 2>&1 || true', { timeout: 30000 });
      const out = `${d.stdout || ''}\n${d.stderr || ''}`;
      // Look for a positive `✓ browser` row; tolerate ANSI/box chrome.
      doctorReportsBrowser = /[✓✔]\s*browser\b/.test(out);
    } catch {
      doctorReportsBrowser = null;
    }

    return {
      cdpUrl: diag.cdpUrl,
      cdpReachable: diag.cdpReachable,
      cdpVersion: diag.cdpVersion,
      navigateOk,
      navigateError,
      navigateFinalUrl,
      webSearchBackend,
      hermesCliToolsetLoaded: diag.hermesWebToolsetLoaded,
      doctorReportsBrowser,
    };
  },

  /**
   * Ask the Hermes CLI for everything it can do — channels, tools,
   * connectors, MCP servers, media providers — in a single JSON blob.
   *
   * This is best-effort: older Hermes versions may not support
   * `hermes capabilities --json`, in which case we fall back to the
   * narrower `hermes channels list --json` / `hermes tools list --json`
   * commands. If those also fail (or we're in browser dev mode), the
   * caller falls back to the static seed catalog.
   *
   * Shape returned (when at least one call succeeds):
   *   {
   *     ok: true,
   *     channels?:   Array<{ id, name, requiredEnv?, docsUrl?, ... }>,
   *     tools?:      Array<{ id, name, category?, ... }>,
   *     connectors?: Array<{ id, name, ... }>,
   *     mcp?:        Array<{ name, command, ... }>,
   *   }
   */
  async discoverCapabilities(): Promise<{
    ok: boolean;
    raw?: Record<string, unknown>;
    error?: string;
  }> {
    if (!isElectron()) return { ok: false, error: 'browser-mode' };
    // Prefer a single rich command if Hermes supports it.
    const unified = await runHermesCli('hermes capabilities --json 2>/dev/null', { timeout: 15000 }).catch(
      () => ({ success: false, stdout: '', stderr: '', code: 1 } as CommandResult),
    );
    if (unified.success && unified.stdout.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(unified.stdout) as Record<string, unknown>;
        return { ok: true, raw: parsed };
      } catch { /* fall through */ }
    }
    // Fallback: parallel narrower CLI calls. Each is allowed to fail.
    const [channelsR, toolsR] = await Promise.all([
      runHermesCli('hermes channels list --json 2>/dev/null', { timeout: 15000 }).catch(
        () => ({ success: false, stdout: '', stderr: '', code: 1 } as CommandResult),
      ),
      runHermesCli('hermes tools list --json 2>/dev/null', { timeout: 15000 }).catch(
        () => ({ success: false, stdout: '', stderr: '', code: 1 } as CommandResult),
      ),
    ]);
    const raw: Record<string, unknown> = {};
    let any = false;
    const tryParse = (key: string, r: CommandResult) => {
      if (!r.success) return;
      const t = r.stdout.trim();
      if (!t) return;
      try {
        raw[key] = JSON.parse(t);
        any = true;
      } catch { /* ignore */ }
    };
    tryParse('channels', channelsR);
    tryParse('tools', toolsR);
    if (any) return { ok: true, raw };
    return { ok: false, error: 'hermes capabilities CLI unavailable' };
  },

  /**
   * List configured MCP (Model Context Protocol) servers.
   *
   * Tries `hermes mcp list --json` first; falls back to parsing the
   * `mcp_servers:` block from `~/.hermes/config.yaml`. Returns a normalized
   * shape regardless of source so the UI doesn't have to care.
   */
  async listMCPServers(): Promise<{
    success: boolean;
    servers: Array<{ name: string; command?: string; args?: string[]; enabled?: boolean; transport?: string }>;
    error?: string;
  }> {
    if (!isElectron()) return { success: true, servers: [] };
    const cli = await runHermesCli('hermes mcp list --json 2>/dev/null', { timeout: 15000 }).catch(
      () => ({ success: false, stdout: '', stderr: '', code: 1 } as CommandResult),
    );
    if (cli.success && cli.stdout.trim().startsWith('[')) {
      try {
        const arr = JSON.parse(cli.stdout) as Array<Record<string, unknown>>;
        const servers = arr
          .map((e) => ({
            name: typeof e.name === 'string' ? e.name : '',
            command: typeof e.command === 'string' ? e.command : undefined,
            args: Array.isArray(e.args) ? (e.args.filter((x) => typeof x === 'string') as string[]) : undefined,
            enabled: typeof e.enabled === 'boolean' ? e.enabled : undefined,
            transport: typeof e.transport === 'string' ? e.transport : undefined,
          }))
          .filter((s) => s.name);
        return { success: true, servers };
      } catch { /* fall through */ }
    }
    // Fallback: scan config.yaml for `mcp_servers:` / `mcpServers:`.
    const cfg = await this.readConfig();
    if (!cfg.success || !cfg.content) {
      return { success: false, servers: [], error: cli.stderr || 'hermes mcp CLI unavailable and no config' };
    }
    const servers: Array<{ name: string; command?: string; args?: string[]; enabled?: boolean }> = [];
    const lines = cfg.content.split('\n');
    let inBlock = false;
    let baseIndent = -1;
    let current: { name: string; command?: string; args?: string[]; enabled?: boolean } | null = null;
    for (const line of lines) {
      if (/^(mcp_servers|mcpServers):\s*$/.test(line)) { inBlock = true; baseIndent = -1; continue; }
      if (!inBlock) continue;
      if (/^\S/.test(line) && line.trim()) { inBlock = false; if (current) servers.push(current); current = null; continue; }
      const indentMatch = line.match(/^(\s+)(\S.*)?$/);
      if (!indentMatch) continue;
      const indent = indentMatch[1].length;
      if (baseIndent < 0 && indentMatch[2]) baseIndent = indent;
      const trimmed = line.trim();
      if (!trimmed) continue;
      const newServer = trimmed.match(/^([A-Za-z0-9_.-]+):\s*$/);
      if (newServer && indent === baseIndent) {
        if (current) servers.push(current);
        current = { name: newServer[1] };
        continue;
      }
      if (!current) continue;
      const cmd = trimmed.match(/^command:\s*['"]?(.+?)['"]?$/);
      if (cmd) { current.command = cmd[1]; continue; }
      const en = trimmed.match(/^enabled:\s*(true|false)$/i);
      if (en) { current.enabled = en[1].toLowerCase() === 'true'; continue; }
    }
    if (current) servers.push(current);
    return { success: true, servers };
  },

  /**
   * List scheduled (cron-like) agent jobs.
   *
   * Per the official Hermes CLI reference, the only real command is
   * `hermes cron list` — there is no `--json` flag and the `schedule` /
   * `scheduled` aliases do not exist. We parse the human-readable table.
   *
   * Expected lines look roughly like:
   *   ID         SCHEDULE        NEXT RUN              PROMPT
   *   abc123     star/15 etc     2026-05-07 12:30:00   Check the build
   * We are tolerant of column reordering and extra whitespace.
   */
  async listScheduledJobs(): Promise<{
    success: boolean;
    jobs: Array<{ id: string; description: string; schedule?: string; nextRun?: string; recurring?: boolean; enabled?: boolean }>;
    error?: string;
    cliAvailable: boolean;
  }> {
    if (!isElectron()) return { success: true, jobs: [], cliAvailable: false };
    const r = await runHermesCli('hermes cron list 2>&1', { timeout: 15000 }).catch(
      () => ({ success: false, stdout: '', stderr: '', code: 1 } as CommandResult),
    );
    if (!r.success) {
      return { success: true, jobs: [], cliAvailable: false };
    }
    const jobs = parseCronListOutput(r.stdout || '');
    return { success: true, jobs, cliAvailable: true };
  },

  /** Delete a scheduled job by id. Uses `hermes cron remove <id>`. */
  async deleteScheduledJob(id: string): Promise<{ success: boolean; error?: string }> {
    if (!isElectron()) return { success: false, error: 'browser-mode' };
    const safe = id.replace(/[^A-Za-z0-9_.-]/g, '');
    if (!safe) return { success: false, error: 'invalid job id' };
    const r = await runHermesCli(`hermes cron remove ${safe} 2>&1`, { timeout: 15000 });
    return { success: r.success, error: r.success ? undefined : (r.stderr || r.stdout || 'delete failed').slice(0, 400) };
  },

  /**
   * List Hermes profiles via the real CLI: `hermes profile list` (singular,
   * no `--json`). Output is a human table with the active profile marked
   * (typically `* default`). Falls back to a single "default" entry.
   */
  async listProfiles(): Promise<{
    success: boolean;
    profiles: Array<{ name: string; active?: boolean; path?: string }>;
    cliAvailable: boolean;
    error?: string;
  }> {
    if (!isElectron()) return { success: true, profiles: [{ name: 'default', active: true }], cliAvailable: false };
    const r = await runHermesCli('hermes profile list 2>&1', { timeout: 15000 }).catch(
      () => ({ success: false, stdout: '', stderr: '', code: 1 } as CommandResult),
    );
    if (!r.success) {
      return { success: true, profiles: [{ name: 'default', active: true }], cliAvailable: false };
    }
    const profiles = parseProfileListOutput(r.stdout || '');
    if (!profiles.length) return { success: true, profiles: [{ name: 'default', active: true }], cliAvailable: true };
    return { success: true, profiles, cliAvailable: true };
  },

  /**
   * List installed Hermes plugins via `hermes plugins list` (no `--json`).
   * Parses the human listing for name + enabled flag.
   */
  async listPlugins(): Promise<{
    success: boolean;
    plugins: Array<{ name: string; enabled?: boolean; source?: string; description?: string }>;
    cliAvailable: boolean;
    error?: string;
  }> {
    if (!isElectron()) return { success: true, plugins: [], cliAvailable: false };
    const r = await runHermesCli('hermes plugins list 2>&1', { timeout: 15000 }).catch(
      () => ({ success: false, stdout: '', stderr: '', code: 1 } as CommandResult),
    );
    if (!r.success) {
      return { success: true, plugins: [], cliAvailable: false };
    }
    const plugins = parsePluginsListOutput(r.stdout || '');
    return { success: true, plugins, cliAvailable: true };
  },

  /**
   * Read agent activity insights — token/cost/session totals.
   * Tries `hermes insights --json`. Returns a normalized summary; when the
   * CLI doesn't expose it, returns cliAvailable=false so the page can show
   * an empty state instead of an error.
   */
  async getInsights(): Promise<{
    success: boolean;
    cliAvailable: boolean;
    insights?: {
      sessionsLast7d?: number;
      messagesLast7d?: number;
      tokensIn?: number;
      tokensOut?: number;
      costUsd?: number;
      topChannels?: Array<{ name: string; count: number }>;
      topSkills?: Array<{ name: string; count: number }>;
      raw?: Record<string, unknown>;
    };
    error?: string;
  }> {
    if (!isElectron()) return { success: true, cliAvailable: false };
    // Real CLI: `hermes insights [--days N] [--source X]`. No `--json` flag.
    const r = await runHermesCli('hermes insights --days 30 2>&1', { timeout: 25000 }).catch(
      () => ({ success: false, stdout: '', stderr: '', code: 1 } as CommandResult),
    );
    if (!r.success) return { success: true, cliAvailable: false };
    const insights = parseInsightsOutput(r.stdout || '');
    return { success: true, cliAvailable: true, insights };
  },

  /**
   * Read the current `display.busy_input_mode` from config.yaml.
   * Hermes supports: 'interrupt' | 'queue' | 'steer'. Defaults to 'queue'.
   */
  async getBusyInputMode(): Promise<'interrupt' | 'queue' | 'steer'> {
    const cfg = await this.readConfig();
    if (!cfg.success || !cfg.content) return 'queue';
    const m = cfg.content.match(/^display:\s*\n(?:[ \t]+.*\n)*?[ \t]+busy_input_mode:\s*([a-z]+)/im);
    const v = m?.[1]?.toLowerCase();
    if (v === 'interrupt' || v === 'queue' || v === 'steer') return v;
    return 'queue';
  },

  /** Persist `display.busy_input_mode` in config.yaml. */
  async setBusyInputMode(mode: 'interrupt' | 'queue' | 'steer'): Promise<{ success: boolean; error?: string }> {
    const cfg = await this.readConfig();
    let body = cfg.success && cfg.content ? cfg.content : '';
    // If a display: block already exists, replace any busy_input_mode under it;
    // otherwise append a fresh block.
    if (/^display:\s*$/m.test(body)) {
      const blockRe = /^(display:\s*\n(?:[ \t]+.*\n)*)/m;
      body = body.replace(blockRe, (block) => {
        if (/busy_input_mode:/m.test(block)) {
          return block.replace(/busy_input_mode:\s*\S+/m, `busy_input_mode: ${mode}`);
        }
        return block.trimEnd() + `\n  busy_input_mode: ${mode}\n`;
      });
    } else {
      body = body.trimEnd() + `\n\ndisplay:\n  busy_input_mode: ${mode}\n`;
    }
    const w = await this.writeConfig(body);
    return { success: w.success, error: w.success ? undefined : (w.error || 'write failed') };
  },

  /**
   * Launch Hermes' own web dashboard.
   *
   * Hermes ships a built-in dashboard that owns deep config, key/session
   * management, and gateway internals. We don't duplicate those — we delegate.
   * The CLI typically prints a URL like `http://127.0.0.1:PORT` and (on most
   * platforms) auto-opens the browser. We capture stdout briefly to extract
   * the URL so the UI can also offer a manual link.
   */
  async launchHermesDashboard(): Promise<{
    success: boolean;
    cliAvailable: boolean;
    url?: string;
    error?: string;
  }> {
    if (!isElectron()) return { success: false, cliAvailable: false, error: 'Desktop only' };
    // Probe `--help` first — quick check that the subcommand exists.
    const help = await runHermesCli('hermes dashboard --help 2>&1', { timeout: 8000 }).catch(
      () => ({ success: false, stdout: '', stderr: '', code: 1 } as CommandResult),
    );
    const helpText = `${help.stdout || ''}\n${help.stderr || ''}`.toLowerCase();
    if (!help.success && !/dashboard/.test(helpText)) {
      return { success: false, cliAvailable: false, error: 'hermes dashboard subcommand not available' };
    }
    // Spawn the dashboard. Use a short timeout so we don't block — the
    // dashboard itself runs as a long-lived server, but it usually prints
    // the URL within a second or two.
    const r = await runHermesCli('hermes dashboard 2>&1 & sleep 2; echo "RONBOT_DASHBOARD_PROBE_DONE"', {
      timeout: 6000,
    }).catch(() => ({ success: false, stdout: '', stderr: '', code: 1 } as CommandResult));
    const text = `${r.stdout || ''}\n${r.stderr || ''}`;
    const urlMatch = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?[^\s'"`]*/i);
    return {
      success: true,
      cliAvailable: true,
      url: urlMatch?.[0],
    };
  },

  /**
   * Stop + restart the agent. Best-effort: kills any running hermes
   * processes, then re-issues `hermes status` to warm the agent back up.
   * Used by the personality flow to apply base-file edits.
   */
  async restartAgent(): Promise<{ success: boolean; error?: string }> {
    if (!isElectron()) return { success: false, error: 'Desktop only' };
    await this.stopHermesAgentRuntime().catch(() => undefined);
    // Official restart for the long-lived service.
    await runHermesCli('hermes gateway restart 2>&1', { timeout: 30000 }).catch(() => undefined);
    // Drop any stuck streaming chat process so the next turn picks up a
    // freshly-loaded SOUL.md / config.
    await runHermesShell(
      [
        'pkill -f "hermes chat" 2>/dev/null || true',
        'sleep 1',
      ].join('\n'),
      { timeout: 8000 },
    ).catch(() => undefined);
    const r = await this.status().catch(() => ({ success: false } as CommandResult));
    return { success: r.success !== false, error: r.success === false ? r.stderr || 'restart failed' : undefined };
  },

  async listPersonalityPresets() {
    if (!isElectron()) return { success: false, presets: [], error: 'browser-mode' };
    return listPersonalityPresets();
  },

  async savePersonalityPreset(name: string) {
    if (!isElectron()) return { success: false, error: 'browser-mode' };
    return savePersonalityPreset(name);
  },

  async applyPersonalityPreset(name: string): Promise<{ success: boolean; error?: string }> {
    if (!isElectron()) return { success: false, error: 'browser-mode' };
    const applied = await installPersonalityPresetFiles(name);
    if (!applied.success) return applied;
    return this.restartAgent();
  },

  async deletePersonalityPreset(name: string) {
    if (!isElectron()) return { success: false, error: 'browser-mode' };
    return deletePersonalityPreset(name);
  },

  /**
   * Write/refresh the Ronbot-owned rules block inside ~/.hermes/AGENTS.md.
   *
   * Hermes auto-injects AGENTS.md (alongside SOUL.md and .cursorrules) into
   * every conversation. We use that to teach the agent ONE thing only — the
   * Ronbot visual companion (terminal-style chat transcript). We deliberately
   * do NOT re-explain Hermes features (cron, skills, MCP) — Hermes already knows those.
   *
   * Idempotent: replaces the block in place between
   * `<!-- ronbot:rules:start -->` and `<!-- ronbot:rules:end -->`,
   * preserving everything outside it.
   */
  async writeRonbotAgentRules(): Promise<{ success: boolean; error?: string }> {
    if (!isElectron()) return { success: false, error: 'browser-mode' };
    const path = '$HOME/.hermes/AGENTS.md';
    const existing = await readHermesFile(path).catch(
      () => ({ success: false, content: '' }),
    );
    const body = existing.success && existing.content ? existing.content : '';
    const block = RONBOT_RULES_BLOCK;
    const startTag = '<!-- ronbot:rules:start -->';
    const endTag = '<!-- ronbot:rules:end -->';
    let next: string;
    if (body.includes(startTag) && body.includes(endTag)) {
      next = body.replace(
        new RegExp(`${startTag}[\\s\\S]*?${endTag}`),
        `${startTag}\n${block}\n${endTag}`,
      );
      if (next === body) return { success: true };
    } else {
      const sep = body.trim() ? '\n\n' : '';
      next = `${body.trimEnd()}${sep}${startTag}\n${block}\n${endTag}\n`;
    }
    return writeHermesFile(path, next, '600');
  },

  /**
   * Terminal-style Electron UI primer under ~/.hermes/ (next to SOUL / AGENTS).
   * Idempotent when the version header matches.
   */
  async writeElectronAppGuide(): Promise<{ success: boolean; error?: string }> {
    if (!isElectron()) return { success: false, error: 'browser-mode' };
    const path = '$HOME/.hermes/ELECTRON_APP_GUIDE.md';
    const existing = await readHermesFile(path).catch(
      () => ({ success: false, content: '' }),
    );
    const body = existing.success && existing.content ? existing.content : '';
    if (body.includes(RONBOT_ELECTRON_APP_GUIDE_VERSION)) return { success: true };
    return writeHermesFile(path, RONBOT_ELECTRON_APP_GUIDE, '600');
  },

  /**
   * After a successful Hermes install: back up any existing persona files,
   * write Ronbot defaults (SOUL, PERSONALITY, MEMORY, USER), then refresh
   * AGENTS / app guides.
   */
  async seedRonbotPersonalityAfterInstall(agentName: string): Promise<{
    success: boolean;
    backupDir?: string;
    filesMoved?: number;
    error?: string;
  }> {
    if (!isElectron()) return { success: false, error: 'browser-mode' };
    // Preserve the official installer's active files as a switchable preset
    // before Ronbot overwrites them. This also helps users recover custom files
    // if they opt into Ronbot after connecting an existing Hermes install.
    const existingPresets = await listPersonalityPresets().catch(() => ({ success: false, presets: [] }));
    if (!existingPresets.presets.some((p) => p.name === 'Official_Hermes')) {
      await savePersonalityPreset('Official_Hermes').catch(() => undefined);
    }

    const wrote = await seedCustomPersonalityFiles(agentName, { overwriteExisting: true });
    if (!wrote.success) {
      return { success: false, error: wrote.error || 'Writing default persona files failed' };
    }
    await this.writeElectronAppGuide().catch(() => undefined);
    await this.writeRonbotAgentRules().catch(() => undefined);
    const ronbotPreset = await savePersonalityPreset('Ronbot_Default');
    const defaultPreset = await saveDefaultPersonalityPreset();
    const presetError = ronbotPreset.success ? defaultPreset.error : ronbotPreset.error;
    if (!ronbotPreset.success || !defaultPreset.success) {
      return {
        success: false,
        backupDir: wrote.backupDir,
        filesMoved: wrote.filesMoved,
        error: presetError ?? 'Saved Personality snapshot failed',
      };
    }
    return {
      success: true,
      backupDir: wrote.backupDir,
      filesMoved: wrote.filesMoved,
    };
  },
};
