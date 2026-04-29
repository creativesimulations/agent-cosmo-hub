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

const HERMES_DIR = '$HOME/.hermes';
const HERMES_ENV = '$HOME/.hermes/.env';
const HERMES_CONFIG = '$HOME/.hermes/config.yaml';
const INSTALL_SCRIPT = 'https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh';
const INSTALLER_ENTRYPOINT = 'setsid bash /tmp/hermes-install.sh --skip-setup </dev/null 2>&1';
export const buildInstallerRunScript = (): string => INSTALLER_ENTRYPOINT;

// Anything beyond ~4 KB on the argv risks ENAMETOOLONG once Windows PATH +
// cmd.exe quoting is added. Larger scripts are written to a temp file and
// executed via `bash <file>` instead of being inlined as base64.
const INLINE_SCRIPT_LIMIT = 4096;

type CommandOutputHandler = (chunk: { type: string; data?: string; code?: number }) => void;

export type StartupIssueSeverity = 'info' | 'warn' | 'error';
export interface StartupIssue {
  id: string;
  severity: StartupIssueSeverity;
  title: string;
  detail: string;
  fixable: boolean;
  fixAction?: 'sync-secrets' | 'init-skills-hub' | 'repair-config' | 'refresh-gateway';
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

const encodeScript = (value: string) => btoa(unescape(encodeURIComponent(value)));

const toWslMountedPath = (windowsPath: string): string | null => {
  const normalized = windowsPath.replace(/\\/g, '/');
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!match) return null;
  return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
};

// Stage a shell script to a temp file. Returns the path bash should execute,
// plus a cleanup snippet to remove it. In browser/sim mode returns empty path
// so callers fall back to inline execution.
const stageScript = async (
  script: string,
  tag: string,
): Promise<{ path: string; cleanup: string } | null> => {
  if (!isElectron()) return null;
  const platform = await coreAPI.getPlatform();
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const fileName = `ronbot-${tag}-${stamp}.sh`;

  if (platform.isWindows) {
    // Write under %USERPROFILE%\.ronbot\tmp, then translate to /mnt/<drive>/...
    const dir = `${platform.homeDir}\\.ronbot\\tmp`;
    const writePath = `${dir}\\${fileName}`;
    await coreAPI.mkdir(dir);
    const wrote = await coreAPI.writeFile(writePath, script);
    if (!wrote.success) return null;
    const drive = writePath[0].toLowerCase();
    const rest = writePath.slice(2).replace(/\\/g, '/');
    const execPath = `/mnt/${drive}${rest}`;
    return { path: execPath, cleanup: `rm -f "${execPath}" 2>/dev/null || true` };
  }

  const writePath = `/tmp/${fileName}`;
  const wrote = await coreAPI.writeFile(writePath, script);
  if (!wrote.success) return null;
  return { path: writePath, cleanup: `rm -f "${writePath}" 2>/dev/null || true` };
};

const buildHermesShellCommand = async (script: string): Promise<string> => {
  const platform = await coreAPI.getPlatform();

  // Small scripts: inline via base64 (fast, no disk I/O).
  if (script.length <= INLINE_SCRIPT_LIMIT) {
    const b64 = encodeScript(script);
    const decodeCmd = `echo ${b64} | base64 -d | bash`;
    return platform.isWindows ? `wsl bash -lc "${decodeCmd}"` : `bash -lc "${decodeCmd}"`;
  }

  // Large scripts: stage to disk to avoid ENAMETOOLONG on the spawn argv.
  const staged = await stageScript(script, 'hermes');
  if (!staged) {
    // Staging failed (browser mode or fs error) — fall back to inline and hope.
    const b64 = encodeScript(script);
    const decodeCmd = `echo ${b64} | base64 -d | bash`;
    return platform.isWindows ? `wsl bash -lc "${decodeCmd}"` : `bash -lc "${decodeCmd}"`;
  }

  // Run the staged script and clean it up. Keep the entire pipeline inside
  // the bash -lc payload (NOT visible to the outer shell), because on Windows
  // cmd.exe does NOT honor single quotes — any `||`, `|`, `>`, `2>` chars
  // outside double quotes would be eaten by cmd.exe and break the command.
  // We use double quotes and escape the inner double-quoted paths.
  const exec = `bash ${staged.path}; __rc=$?; ${staged.cleanup}; exit $__rc`;
  if (platform.isWindows) {
    // Inside cmd.exe's double-quoted argument to wsl, we cannot easily nest
    // double quotes. Re-encode the exec line as base64 so the outer shell
    // sees only safe characters; bash decodes and runs it.
    const execB64 = encodeScript(exec);
    return `wsl bash -lc "echo ${execB64} | base64 -d | bash"`;
  }
  return `bash -lc '${exec}'`;
};

/**
 * Cached probe of `hermes chat --help` so we know whether the binary
 * supports the documented modern flags (`-p`, `--no-color`) or only the
 * legacy `-q`. Probed once per session on first chat.
 */
const HERMES_CHAT_CAPS: { probed: boolean; supportsModern: boolean; supportsNoColor: boolean } = {
  probed: false,
  supportsModern: true,
  supportsNoColor: true,
};

let hermesCapsProbePromise: Promise<void> | null = null;

async function ensureHermesChatCaps(): Promise<void> {
  if (HERMES_CHAT_CAPS.probed) return;
  if (hermesCapsProbePromise) return hermesCapsProbePromise;
  hermesCapsProbePromise = (async () => {
    try {
      const platform = await coreAPI.getPlatform();
      const inner = 'export PATH="$HOME/.hermes/venv/bin:$HOME/.local/bin:$PATH" && hermes chat --help 2>&1 || true';
      const b64 = btoa(unescape(encodeURIComponent(inner)));
      const cmd = platform.isWindows
        ? `wsl bash -lc "echo ${b64} | base64 -d | bash"`
        : `bash -lc "echo ${b64} | base64 -d | bash"`;
      const r = await coreAPI.runCommand(cmd, { timeout: 10000 });
      const out = (r.stdout || '') + (r.stderr || '');
      const hasP = /\B-p\b|--prompt\b/.test(out);
      const hasQ = /\B-q\b/.test(out);
      HERMES_CHAT_CAPS.supportsModern = hasP || !hasQ;
      HERMES_CHAT_CAPS.supportsNoColor = /--no-color/.test(out);
    } catch {
      /* keep optimistic defaults */
    } finally {
      HERMES_CHAT_CAPS.probed = true;
    }
  })();
  return hermesCapsProbePromise;
}


const runHermesShell = async (
  script: string,
  options?: Record<string, unknown> & { onStreamId?: (id: string) => void; displayCommand?: string },
  onOutput?: CommandOutputHandler,
): Promise<CommandResult> => {
  const cmd = await buildHermesShellCommand(script);
  const displayCommand = options?.displayCommand || script;
  const mergedOptions = { ...(options || {}), displayCommand };
  // If the caller wants a streamId (so it can kill the process later) we
  // must use the streaming path even when there's no onOutput handler.
  const needsStream = !!onOutput || !!options?.onStreamId;
  return needsStream
    ? coreAPI.runCommandStream(cmd, mergedOptions, onOutput || (() => { /* sink */ }))
    : coreAPI.runCommand(cmd, mergedOptions);
};

/** Prepended to Hermes CLI invocations so `npm`, Homebrew Node, etc. resolve (WhatsApp bridge). */
const HERMES_PATH_EXPORT =
  'export PATH="$HOME/.hermes/venv/bin:$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:/snap/bin:$PATH"';

const HERMES_NODE_VERSION = 'v20.19.2';
const getHermesNodeEnvExport = (): string =>
  [
    `NODE_RUNTIME_VERSION="${HERMES_NODE_VERSION}"`,
    'NODE_RUNTIME_DIR="$HOME/.hermes/runtime/node"',
    'ARCH="$(uname -m)"',
    'case "$ARCH" in',
    '  x86_64|amd64) NODE_ARCH="x64" ;;',
    '  aarch64|arm64) NODE_ARCH="arm64" ;;',
    '  *) NODE_ARCH="" ;;',
    'esac',
    '[ -n "$NODE_ARCH" ] || { echo "[ronbot] Unsupported CPU architecture for managed Node runtime: $ARCH" >&2; exit 1; }',
    'NODE_RUNTIME_HOME="$NODE_RUNTIME_DIR/node-${NODE_RUNTIME_VERSION}-linux-${NODE_ARCH}"',
    'export PATH="$NODE_RUNTIME_HOME/bin:$PATH"',
  ].join('\n');

const runHermesCli = async (
  command: string,
  options?: Record<string, unknown>,
  onOutput?: CommandOutputHandler,
): Promise<CommandResult> => {
  return runHermesShell(
    [
      'set -e',
      HERMES_PATH_EXPORT,
      'command -v hermes >/dev/null 2>&1 || { echo "[hermes] FATAL: hermes CLI not found on PATH" >&2; exit 127; }',
      'echo "[hermes] using $(command -v hermes)"',
      command,
    ].join('\n'),
    options,
    onOutput,
  );
};

let listSkillsCache: { at: number; value: { success: boolean; skills: Array<{ name: string; category: string; source: 'user' | 'bundled'; description?: string; requiredSecrets?: string[] }>; error?: string } } | null = null;
const LIST_SKILLS_CACHE_TTL_MS = 10_000;

/** Validate channel credentials with supported HTTP / filesystem checks. */
const buildChannelCredentialTestScript = (channelId: string): string => {
  const allowed = new Set(['telegram', 'slack', 'whatsapp', 'discord', 'signal']);
  if (!allowed.has(channelId)) {
    return 'echo "Unknown channel" >&2; exit 2';
  }
  const ch = channelId;
  const slackBlock = [
    '    BT=$(curl -sS --max-time 35 -H "Authorization: Bearer ${SLACK_BOT_TOKEN}" "https://slack.com/api/auth.test")',
    `    printf %s "\$BT" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") is True' || { echo "Slack bot token check failed:" >&2; echo "\$BT" >&2; exit 1; }`,
    '    case "${SLACK_APP_TOKEN:-}" in xapp-*) ;; *) echo "SLACK_APP_TOKEN must start with xapp-" >&2; exit 1;; esac',
    '    [ -n "${SLACK_ALLOWED_USERS:-}" ] || { echo "SLACK_ALLOWED_USERS is required" >&2; exit 1; }',
    '    echo "Slack bot token OK (api.auth.test). App token format OK. Credentials were checked directly."',
  ].join('\n');
  const telegramBlock = [
    '    TG=$(curl -sS --max-time 35 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe")',
    `    printf %s "\$TG" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") is True' || { echo "Telegram token check failed:" >&2; echo "\$TG" >&2; exit 1; }`,
    '    [ -n "${TELEGRAM_ALLOWED_USERS:-}" ] || { echo "TELEGRAM_ALLOWED_USERS is required" >&2; exit 1; }',
    '    echo "Telegram token OK (getMe). Credentials were checked directly."',
  ].join('\n');
  const discordBlock = [
    '    DC=$(curl -sS --max-time 35 -H "Authorization: Bot ${DISCORD_BOT_TOKEN}" "https://discord.com/api/v10/users/@me")',
    `    printf %s "\$DC" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert "id" in d' || { echo "Discord bot token check failed:" >&2; echo "\$DC" >&2; exit 1; }`,
    '    [ -n "${DISCORD_ALLOWED_USERS:-}" ] || { echo "DISCORD_ALLOWED_USERS is required" >&2; exit 1; }',
    '    echo "Discord bot token OK. Credentials were checked directly."',
  ].join('\n');
  const whatsappBlock = [
    '    if [ -z "${WHATSAPP_ALLOWED_USERS:-}" ] && [ "${WHATSAPP_ALLOW_ALL_USERS:-}" != "true" ]; then',
    '      echo "Set WHATSAPP_ALLOWED_USERS (recommended) or WHATSAPP_ALLOW_ALL_USERS=true." >&2',
    '      exit 1',
    '    fi',
    '    HAS_CREDS=0',
    '    [ -f "$HOME/.hermes/platforms/whatsapp/session/creds.json" ] && HAS_CREDS=1',
    '    if [ "$HAS_CREDS" -eq 0 ]; then',
    '      echo "WhatsApp is not linked yet in ~/.hermes/platforms/whatsapp/session — finish QR pairing first." >&2',
    '      exit 1',
    '    fi',
    '    echo "WhatsApp canonical creds.json found. Pairing was verified."',
  ].join('\n');
  const signalBlock = [
    '    [ -n "${SIGNAL_HTTP_URL:-}" ] || { echo "SIGNAL_HTTP_URL is required" >&2; exit 1; }',
    '    [ -n "${SIGNAL_ACCOUNT:-}" ] || { echo "SIGNAL_ACCOUNT is required" >&2; exit 1; }',
    '    [ -n "${SIGNAL_ALLOWED_USERS:-}" ] || { echo "SIGNAL_ALLOWED_USERS is required" >&2; exit 1; }',
    '    if ! command -v curl >/dev/null 2>&1; then echo "curl is required to test Signal but was not found on PATH." >&2; exit 1; fi',
    '    BASE="${SIGNAL_HTTP_URL%/}"',
    '    case "$BASE" in */api/v1/check) SIG_URL="$BASE" ;; *) SIG_URL="${BASE}/api/v1/check" ;; esac',
    '    CODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 15 "$SIG_URL" 2>/dev/null || echo 000)',
    '    [ "$CODE" != "000" ] || { echo "Cannot reach signal-cli at $SIG_URL (daemon not running or wrong URL)." >&2; exit 1; }',
    '    echo "signal-cli responded at api/v1/check (HTTP $CODE). Daemon was probed directly."',
  ].join('\n');

  return [
    'set +e',
    HERMES_PATH_EXPORT,
    `CH="${ch}"`,
    'ENVF="$HOME/.hermes/.env"',
    'if [ ! -f "$ENVF" ]; then echo "Missing ~/.hermes/.env — save your channel secrets again." >&2; exit 2; fi',
    'set -a',
    '. "$ENVF"',
    'set +a',
    'case "$CH" in',
    `    slack)`,
    '    if ! command -v curl >/dev/null 2>&1; then echo "curl is required for Slack checks but was not found on PATH." >&2; exit 1; fi',
    '    if ! command -v python3 >/dev/null 2>&1; then echo "python3 is required for Slack checks but was not found on PATH." >&2; exit 1; fi',
    slackBlock,
    '    exit 0',
    '    ;;',
    `    telegram)`,
    '    if ! command -v curl >/dev/null 2>&1; then echo "curl is required for Telegram checks but was not found on PATH." >&2; exit 1; fi',
    '    if ! command -v python3 >/dev/null 2>&1; then echo "python3 is required for Telegram checks but was not found on PATH." >&2; exit 1; fi',
    telegramBlock,
    '    exit 0',
    '    ;;',
    `    discord)`,
    '    if ! command -v curl >/dev/null 2>&1; then echo "curl is required for Discord checks but was not found on PATH." >&2; exit 1; fi',
    '    if ! command -v python3 >/dev/null 2>&1; then echo "python3 is required for Discord checks but was not found on PATH." >&2; exit 1; fi',
    discordBlock,
    '    exit 0',
    '    ;;',
    `    whatsapp)`,
    whatsappBlock,
    '    exit 0',
    '    ;;',
    `    signal)`,
    signalBlock,
    '    exit 0',
    '    ;;',
    '    *)',
    '      echo "No credential fallback for channel: $CH" >&2',
    '      exit 2',
    '    ;;',
    'esac',
  ].join('\n');
};

const readHermesFile = async (targetPath: string): Promise<{ success: boolean; content?: string; error?: string }> => {
  const result = await runHermesShell([
    `TARGET="${targetPath}"`,
    'if [ -f "$TARGET" ]; then',
    '  cat "$TARGET"',
    'else',
    '  exit 3',
    'fi',
  ].join('\n'));

  if (result.success) return { success: true, content: result.stdout };
  if (result.code === 3) return { success: false, error: 'File not found' };

  return { success: false, error: result.stderr || result.stdout || 'Failed to read Hermes file' };
};

const writeHermesFile = async (
  targetPath: string,
  content: string,
  mode?: string,
): Promise<{ success: boolean; error?: string }> => {
  const platform = await coreAPI.getPlatform();

  // On Windows, writing through `wsl bash -lc "echo BIGB64 | base64 -d > ..."`
  // is fragile: cmd.exe doesn't honor single quotes, and any `|`, `>`, `||`
  // tokens that escape the WSL quoting get interpreted by cmd.exe — producing
  // confusing errors like `'true' is not recognized as an internal or external
  // command`. To sidestep this entirely, stage the file content to a Windows
  // temp path (via the Node fs IPC, no shell), then run a TINY wsl command
  // that just copies it into place and chmods.
  if (platform.isWindows) {
    const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const winTmpDir = `${platform.homeDir}\\.ronbot\\tmp`;
    const winTmpFile = `${winTmpDir}\\write-${stamp}.dat`;
    await coreAPI.mkdir(winTmpDir);
    const wrote = await coreAPI.writeFile(winTmpFile, content);
    if (!wrote.success) {
      return { success: false, error: wrote.error || 'Failed to stage file content' };
    }
    const drive = winTmpFile[0].toLowerCase();
    const wslSource = `/mnt/${drive}${winTmpFile.slice(2).replace(/\\/g, '/')}`;
    // Build the bash script and base64-encode it BEFORE handing it to cmd.exe.
    // cmd.exe doesn't honor backslash-escaping of inner double quotes, so any
    // nested `"` (like `"$(dirname "$TARGET")"`) gets chopped, leaving cp/chmod
    // with missing operands. Encoding the whole script means cmd.exe only ever
    // sees safe alphanumerics — bash decodes and runs the script intact.
    const script = [
      'set -e',
      `TARGET="${targetPath}"`,
      'mkdir -p "$(dirname "$TARGET")"',
      `cp "${wslSource}" "$TARGET"`,
      `rm -f "${wslSource}" 2>/dev/null || true`,
      ...(mode ? [`chmod ${mode} "$TARGET" || true`] : []),
      'echo "[writeHermesFile] wrote $TARGET"',
    ].join('\n');
    const b64 = encodeScript(script);
    const result = await coreAPI.runCommand(
      `wsl bash -c "echo ${b64} | base64 -d | bash"`,
      { timeout: 30000 },
    );
    return {
      success: result.success,
      error: result.success ? undefined : (result.stderr || result.stdout || 'Failed to write Hermes file'),
    };
  }

  const b64 = encodeScript(content);
  const result = await runHermesShell(
    [
      `TARGET="${targetPath}"`,
      'mkdir -p "$(dirname "$TARGET")"',
      `echo ${b64} | base64 -d > "$TARGET"`,
      ...(mode ? [`chmod ${mode} "$TARGET" || true`] : []),
    ].join('\n'),
    { timeout: 30000 },
  );

  return {
    success: result.success,
    error: result.success ? undefined : (result.stderr || result.stdout || 'Failed to write Hermes file'),
  };
};

const hermesFileExists = async (targetPath: string): Promise<boolean> => {
  const result = await runHermesShell([
    `TARGET="${targetPath}"`,
    '[ -f "$TARGET" ]',
  ].join('\n'));

  return result.success;
};

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
      'TARGET="$HOME/.hermes"',
      'mkdir -p "$TARGET"',
      ...legacyDirs.flatMap((legacyDir, index) => [
        `LEGACY_${index}="${legacyDir}"`,
        `if [ -d "$LEGACY_${index}" ]; then`,
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

type HermesInstallState = {
  hasDir: boolean;
  hasEnv: boolean;
  hasConfig: boolean;
  hasVenvCli: boolean;
  hasPathCli: boolean;
};

const parseProbeOutput = (stdout: string): Record<string, string> => {
  return stdout.split('\n').reduce<Record<string, string>>((acc, line) => {
    const trimmed = line.trim();
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) return acc;
    acc[trimmed.slice(0, eqIndex)] = trimmed.slice(eqIndex + 1);
    return acc;
  }, {});
};

/** One-shot in-place repair for configs left broken by older builds of this
 *  app:
 *   1. `allowed_paths:[]` / `blocked_paths:[]` (no space → invalid YAML).
 *   2. `browser:` followed only by a comment line — PyYAML loads it as None,
 *      crashing Hermes' `if key in browser_config:`. Replace with `browser: {}`.
 *  Safe to run repeatedly. */
const repairBrokenYamlList = async (): Promise<void> => {
  await runHermesShell(
    [
      `CFG="${HERMES_CONFIG}"`,
      '[ -f "$CFG" ] || exit 0',
      // Match keys followed immediately by `[` (no space) and insert one.
      `if grep -Eq '^[[:space:]]*(allowed_paths|blocked_paths):\\[' "$CFG"; then`,
      '  echo "[repair] fixing missing space in allowed_paths/blocked_paths"',
      `  sed -i -E 's/^([[:space:]]*(allowed_paths|blocked_paths)):\\[/\\1: [/' "$CFG"`,
      'fi',
      // Heal the null-browser-block case: a bare `browser:` line whose only
      // child is a comment ("  # (no overrides ...)") parses as None.
      `if grep -Eq '^browser:[[:space:]]*$' "$CFG" && grep -Eq '^[[:space:]]+# \\(no overrides' "$CFG"; then`,
      '  echo "[repair] replacing null browser: block with empty mapping {}"',
      // Drop the placeholder comment line, then turn the bare `browser:` into `browser: {}`.
      `  sed -i -E '/^[[:space:]]+# \\(no overrides[^)]*\\)[[:space:]]*$/d' "$CFG"`,
      `  sed -i -E 's/^browser:[[:space:]]*$/browser: {}/' "$CFG"`,
      'fi',
    ].join('\n'),
    { timeout: 10000 },
  ).catch(() => undefined);
};

const inspectHermesInstall = async (): Promise<HermesInstallState> => {
  await repairLegacyWindowsInstall();
  await repairBrokenYamlList();
  const result = await runHermesShell([
    'export PATH="$HOME/.hermes/venv/bin:$HOME/.local/bin:$PATH"',
    `if [ -d "${HERMES_DIR}" ]; then echo "HAS_DIR=1"; else echo "HAS_DIR=0"; fi`,
    `if [ -f "${HERMES_ENV}" ]; then echo "HAS_ENV=1"; else echo "HAS_ENV=0"; fi`,
    `if [ -f "${HERMES_CONFIG}" ]; then echo "HAS_CONFIG=1"; else echo "HAS_CONFIG=0"; fi`,
    'if [ -x "$HOME/.hermes/venv/bin/hermes" ]; then echo "HAS_VENV_CLI=1"; else echo "HAS_VENV_CLI=0"; fi',
    'if command -v hermes >/dev/null 2>&1; then echo "HAS_PATH_CLI=1"; else echo "HAS_PATH_CLI=0"; fi',
  ].join('\n'));

  const parsed = parseProbeOutput(result.stdout);

  return {
    hasDir: parsed.HAS_DIR === '1',
    hasEnv: parsed.HAS_ENV === '1',
    hasConfig: parsed.HAS_CONFIG === '1',
    hasVenvCli: parsed.HAS_VENV_CLI === '1',
    hasPathCli: parsed.HAS_PATH_CLI === '1',
  };
};

const hasUsableHermesInstall = (state: HermesInstallState) => {
  return state.hasDir && (state.hasVenvCli || state.hasPathCli);
};

const finalizeInstallVerification = async (result: CommandResult, onOutput?: CommandOutputHandler): Promise<CommandResult> => {
  const state = await inspectHermesInstall();
  const verificationLines = [
    `[verify] ~/.hermes directory: ${state.hasDir ? 'found' : 'missing'}`,
    `[verify] config.yaml: ${state.hasConfig ? 'found' : 'missing'}`,
    `[verify] .env: ${state.hasEnv ? 'found' : 'missing'}`,
    `[verify] venv hermes CLI: ${state.hasVenvCli ? 'found' : 'missing'}`,
    `[verify] hermes on PATH: ${state.hasPathCli ? 'found' : 'missing'}`,
  ];

  onOutput?.({ type: 'stdout', data: `${verificationLines.join('\n')}\n` });

  if (hasUsableHermesInstall(state)) {
    return {
      ...result,
      stdout: `${result.stdout}${result.stdout && !result.stdout.endsWith('\n') ? '\n' : ''}${verificationLines.join('\n')}\n`,
    };
  }

  const failure = [
    '[verify] Install finished, but no usable Hermes CLI was found.',
    '[verify] Expected either ~/.hermes/venv/bin/hermes or a hermes binary on PATH.',
  ].join('\n');

  onOutput?.({ type: 'stderr', data: `${failure}\n` });

  return {
    success: false,
    code: result.code || 52,
    stdout: `${result.stdout}${result.stdout && !result.stdout.endsWith('\n') ? '\n' : ''}${verificationLines.join('\n')}\n`,
    stderr: `${result.stderr}${result.stderr && !result.stderr.endsWith('\n') ? '\n' : ''}${failure}\n`,
  };
};

const quoteEnvValue = (value: string) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const materializeHermesEnv = async (): Promise<{ success: boolean; count?: number; missing?: string[]; error?: string }> => {
  const { keys, backend } = await secretsStore.list();
  const secretEntries = (await Promise.all(
    keys.map(async (key) => [key, await secretsStore.get(key)] as const),
  )).filter(([, value]) => value !== '');

  agentLogs.push({
    source: 'system',
    level: secretEntries.length === 0 ? 'warn' : 'info',
    summary: `materializeHermesEnv: ${secretEntries.length}/${keys.length} non-empty key(s) from ${backend}`,
    detail: secretEntries.length === 0
      ? `Credential store has ${keys.length} key entries but all values are empty. Re-add your API keys in the Secrets tab — the OS credential backend (${backend}) may not be persisting them.`
      : `Keys to write: ${secretEntries.map(([k, v]) => `${k}(${v.length}c)`).join(', ')}`,
  });

  // Heuristic: a line from the Hermes example template — placeholder values
  // like KEY=your_key_here, KEY=<your-...>, KEY="changeme", or just KEY=.
  // We strip these so the example template doesn't drown the managed block.
  const isPlaceholderLine = (line: string): boolean => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return false;
    const eq = t.indexOf('=');
    if (eq < 1) return false;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!v) return true;
    return /^(your[-_]|<your|placeholder|changeme|xxx|sk-\.{3}|example|insert[-_]|todo$)/i.test(v);
  };

  const managedKeys = new Set(secretEntries.map(([key]) => key));
  // Valid POSIX env var: letter/underscore + letters/digits/underscores.
  // Anything else (e.g. OPENROUTER-API-KEY) crashes bash when sourcing .env.
  const VALID_ENV = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const droppedInvalid: string[] = [];
  const existing = await readHermesFile(HERMES_ENV);
  const preserved = existing.success && existing.content
    ? existing.content
        .split('\n')
        .filter((line) => {
          const trimmed = line.trim();
          if (!trimmed) return true;
          // Strip the original Hermes template's helper comments — they only
          // confuse users and add 100s of noise lines.
          if (trimmed.startsWith('#')) {
            if (/Copy this file to \.env/i.test(trimmed)) return false;
            if (/fill in your API keys/i.test(trimmed)) return false;
            if (/Hermes Agent Environment Configuration/i.test(trimmed)) return false;
            return true;
          }
          const eqIndex = trimmed.indexOf('=');
          if (eqIndex < 1) return true;
          const k = trimmed.slice(0, eqIndex).trim();
          // PURGE invalid env var names. Without this, a line like
          // `OPENROUTER-API-KEY=sk-...` survives every sync and bash fails
          // with "command not found" when the agent sources the file.
          if (!VALID_ENV.test(k)) {
            droppedInvalid.push(k);
            return false;
          }
          if (managedKeys.has(k)) return false;
          // Drop placeholder rows (KEY=your_key_here etc.) so they can't
          // shadow the managed block when bash sources the file.
          if (isPlaceholderLine(line)) return false;
          return true;
        })
        .join('\n')
        .replace(/\n+$/, '')
    : '';

  if (droppedInvalid.length > 0) {
    agentLogs.push({
      source: 'system',
      level: 'warn',
      summary: `materializeHermesEnv: purged ${droppedInvalid.length} invalid env var line(s)`,
      detail: `These names contain characters bash can't parse (hyphens, spaces, etc.) and would crash the agent: ${droppedInvalid.join(', ')}. They've been removed from ~/.hermes/.env.`,
    });
  }

  const managed = secretEntries.map(([key, value]) => `${key}=${quoteEnvValue(value)}`).join('\n');
  const sections = [
    preserved,
    managed ? '# ─── Managed by Ronbot (do not edit by hand) ───' : '',
    managed,
  ].filter(Boolean);

  if (sections.length === 0) {
    agentLogs.push({
      source: 'system',
      level: 'warn',
      summary: 'materializeHermesEnv: nothing to write (no secrets, no preserved lines)',
    });
    return { success: true, count: 0 };
  }

  const result = await writeHermesFile(HERMES_ENV, `${sections.join('\n')}\n`, '600');
  if (!result.success) {
    return { success: false, count: secretEntries.length, error: result.error };
  }

  // Defensive verification — read .env back and confirm every managed key
  // landed with a non-empty value. If any are missing, the write silently
  // failed (e.g. cmd.exe quoting bug, WSL not running) and the caller should
  // surface a hard error rather than letting the agent run blind.
  const verify = await readHermesFile(HERMES_ENV);
  if (!verify.success || !verify.content) {
    return { success: false, count: secretEntries.length, error: 'Verification failed: could not read back ~/.hermes/.env' };
  }
  const written: Record<string, string> = {};
  for (const line of verify.content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    written[t.slice(0, eq).trim()] = v;
  }
  const missing = secretEntries
    .filter(([k]) => !(written[k] && written[k].length > 0))
    .map(([k]) => k);
  if (missing.length > 0) {
    return {
      success: false,
      count: secretEntries.length,
      missing,
      error: `Verification failed: ${missing.length} key(s) missing from ~/.hermes/.env after write: ${missing.join(', ')}`,
    };
  }
  agentLogs.push({
    source: 'system',
    level: 'info',
    summary: `materializeHermesEnv: ✓ wrote ${secretEntries.length} key(s) to ~/.hermes/.env`,
  });
  return { success: true, count: secretEntries.length };
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

const PERMS_BEGIN = '# ─── Managed by Ronbot: permissions (do not edit) ───';
const PERMS_END = '# ─── End Ronbot permissions ───';
const LOG_BEGIN = '# ─── Managed by Ronbot: logging (do not edit) ───';
const LOG_END = '# ─── End Ronbot logging ───';
const BROWSER_BEGIN = '# ─── Managed by Ronbot: browser (do not edit) ───';
const BROWSER_END = '# ─── End Ronbot browser ───';
const TOOLSETS_BEGIN = '# ─── Managed by Ronbot: toolsets (do not edit) ───';
const TOOLSETS_END = '# ─── End Ronbot toolsets ───';

const stripManagedBlock = (yaml: string, begin: string, end: string): string => {
  const startIdx = yaml.indexOf(begin);
  if (startIdx === -1) return yaml;
  const endIdx = yaml.indexOf(end, startIdx);
  if (endIdx === -1) return yaml;
  const after = yaml.slice(endIdx + end.length);
  // Trim the leading newline of `after` so we don't accumulate blank lines
  // each time we re-write.
  return (yaml.slice(0, startIdx).replace(/\n+$/, '') + after.replace(/^\n+/, '\n')).replace(/\n{3,}/g, '\n\n');
};

const yamlList = (items: string[]): string => {
  if (!items.length) return ' []';
  return '\n' + items.map((p) => `    - "${p.replace(/"/g, '\\"')}"`).join('\n');
};

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
  const stripped = stripManagedBlock(existing, PERMS_BEGIN, PERMS_END).replace(/\n+$/, '');

  const block = [
    PERMS_BEGIN,
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
    PERMS_END,
  ].join('\n');

  const next = `${stripped}\n\n${block}\n`;
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
  const stripped = stripManagedBlock(existing, LOG_BEGIN, LOG_END).replace(/\n+$/, '');
  const block = [
    LOG_BEGIN,
    'logging:',
    '  file: ~/.hermes/logs/agent.log',
    '  level: info',
    LOG_END,
  ].join('\n');
  const next = `${stripped}\n\n${block}\n`;
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

/**
 * Managed `browser:` block state in ~/.hermes/config.yaml.
 *
 * We keep the in-memory desired state (camofox persistence + CDP url) so each
 * surgical update preserves the other field. The BROWSER_BEGIN…BROWSER_END
 * block is rewritten as a unit; nothing outside it is touched.
 */
interface BrowserBlockState {
  camofoxPersistence: boolean;
  cdpUrl: string | null;
}

// Official Hermes platform toolset bundle. Loading `hermes-cli` natively
// registers `web`, `browser`, `terminal`, `file`, `vision`, `image_gen`,
// `tts`, `memory`, `todo`, `clarify`, `delegation`, `code_execution`,
// `cronjob`, `skills`, `session_search`, `messaging`, etc. — i.e. the full
// 36-tool bundle the docs describe. Previously we wrote `hermes-web`, which
// is not a real toolset name and caused the agent to report "missing skill"
// for every web/browser call.
const BROWSER_DEFAULT_TOOLSETS = ['hermes-cli'];

const quoteYamlScalar = (value: string): string => `"${value.replace(/"/g, '\\"')}"`;

const BROWSER_EXECUTABLE_FIX_SCRIPT = [
  'if [ -d "$HOME/.hermes/hermes-agent/node_modules/.bin" ]; then',
  '  find "$HOME/.hermes/hermes-agent/node_modules/.bin" -maxdepth 1 -type f \\( -name "agent-browser" -o -name "playwright" -o -name "playwright-core" \\) -exec chmod +x {} + 2>/dev/null || true',
  'fi',
].join('\n');

const parseBrowserBlock = (yaml: string): BrowserBlockState => {
  const startIdx = yaml.indexOf(BROWSER_BEGIN);
  const state: BrowserBlockState = { camofoxPersistence: false, cdpUrl: null };
  if (startIdx === -1) return state;
  const endIdx = yaml.indexOf(BROWSER_END, startIdx);
  if (endIdx === -1) return state;
  const block = yaml.slice(startIdx, endIdx);
  if (/managed_persistence:\s*true/.test(block)) state.camofoxPersistence = true;
  const cdpMatch = block.match(/cdp_url:\s*"?([^"\n]+)"?/);
  if (cdpMatch) state.cdpUrl = cdpMatch[1].trim();
  return state;
};

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

  /** Read the active managed permissions block (for Diagnostics). */
  async readPermissionsBlock() {
    return readHermesPermissionsBlock();
  },

  /** Read live browser diagnostics: CDP reachability, what config.yaml says,
   *  whether `hermes-web` is loaded, and the effective `internet` permission.
   *  This is what the Diagnostics page shows under "Browser toolset". */
  async getBrowserDiagnostics(): Promise<{
    cdpUrl: string | null;
    cdpReachable: boolean | null;
    cdpVersion?: string;
    browserEnabledInConfig: boolean;
    hermesWebToolsetLoaded: boolean;
    internetPermission: string | null;
    rawBrowserBlock: string | null;
    rawToolsetsBlock: string | null;
  }> {
    const cfg = await readHermesFile(HERMES_CONFIG);
    const yaml = cfg.success && cfg.content ? cfg.content : '';

    // Browser block
    const bIdx = yaml.indexOf(BROWSER_BEGIN);
    const bEnd = yaml.indexOf(BROWSER_END, bIdx);
    const rawBrowserBlock = bIdx !== -1 && bEnd !== -1
      ? yaml.slice(bIdx, bEnd + BROWSER_END.length)
      : null;
    const browserState = parseBrowserBlock(yaml);
    // In current Hermes config schema, presence of our managed browser block
    // is the reliable signal. The old `browser.enabled: true` key is obsolete.
    const browserEnabledInConfig = !!rawBrowserBlock;

    // Toolsets block (managed or unmanaged — we accept either)
    const tIdx = yaml.indexOf(TOOLSETS_BEGIN);
    const tEnd = yaml.indexOf(TOOLSETS_END, tIdx);
    const rawToolsetsBlock = tIdx !== -1 && tEnd !== -1
      ? yaml.slice(tIdx, tEnd + TOOLSETS_END.length)
      : null;
    // Look for the official toolset bundle. Accept the legacy `hermes-web`
    // name too so freshly-repaired and not-yet-repaired installs both report.
    const hermesWebToolsetLoaded =
      /(^|\n)\s*-\s*hermes-cli\b/.test(yaml) || /(^|\n)\s*-\s*hermes-web\b/.test(yaml);

    // Internet permission (from managed perms block)
    const permsBlock = await readHermesPermissionsBlock();
    const internetMatch = permsBlock?.match(/^\s*internet:\s*(\w+)/m);
    const internetPermission = internetMatch ? internetMatch[1] : null;

    // Probe CDP
    let cdpReachable: boolean | null = null;
    let cdpVersion: string | undefined;
    if (browserState.cdpUrl) {
      try {
        // Hermes points cdp_url at e.g. http://127.0.0.1:9222 — append /json/version.
        const probeUrl = browserState.cdpUrl.replace(/\/+$/, '') + '/json/version';
        const resp = await fetch(probeUrl, { method: 'GET' });
        cdpReachable = resp.ok;
        if (resp.ok) {
          const json = await resp.json().catch(() => ({} as { Browser?: string }));
          cdpVersion = (json as { Browser?: string }).Browser;
        }
      } catch {
        cdpReachable = false;
      }
    }

    return {
      cdpUrl: browserState.cdpUrl,
      cdpReachable,
      cdpVersion,
      browserEnabledInConfig,
      hermesWebToolsetLoaded,
      internetPermission,
      rawBrowserBlock,
      rawToolsetsBlock,
    };
  },

  /** Toggle Camofox `managed_persistence` in the agent's config. */
  async setBrowserCamofoxPersistence(enabled: boolean) {
    return setBrowserCamofoxPersistence(enabled);
  },

  /** Set (or clear) `browser.cdp_url` so Hermes auto-connects to a launched Chrome. */
  async setBrowserCdpUrl(url: string | null) {
    return setBrowserCdpUrl(url);
  },
  /** Install the agent using the official install script.
   *  On Windows we always run inside WSL because hermes-agent is not published
   *  to PyPI and requires the install script (which expects a POSIX shell). */
  async install(extras?: string[], onOutput?: CommandOutputHandler): Promise<CommandResult> {
    const wantsExtras = !!(extras && extras.length > 0);
    const extrasFlag = wantsExtras ? `[${extras!.join(',')}]` : '';

    // The official install script reads optional prompts (ffmpeg, etc.)
    // directly from /dev/tty, bypassing piped stdin. To run it fully
    // unattended we:
    //   1. Download the script to a temp file (so we don't pipe to bash).
    //   2. Run it with stdin redirected from /dev/null AND wrap with
    //      `setsid` so it has no controlling terminal — every /dev/tty
    //      read fails immediately and the script falls back to defaults
    //      / non-interactive paths.
    //   3. Force sudo to be non-interactive (SUDO_ASKPASS=/bin/false +
    //      `sudo -n`) so optional system packages are skipped cleanly
    //      instead of hanging on a password prompt.
    //   4. Pass `--skip-setup` so the post-install wizard doesn't run.
    //
    // Note: ffmpeg / ripgrep / build-essential are OPTIONAL system
    // packages. If they can't be installed without a password the script
    // continues and just logs a manual-install hint.
    const unattendedEnv =
      'export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a SUDO_ASKPASS=/bin/false';
    // Ensure pip + venv are present inside the POSIX env (WSL Ubuntu ships
    // python3 without pip by default, which breaks the Hermes installer).
    // Strategy: try every known method, log what we tried, and FAIL HARD
    // with a clear message if pip is still missing at the end. We can't let
    // the install script run without pip — it just produces a confusing
    // "No module named pip" error.
    // Strategy on modern Debian/Ubuntu (PEP 668 "externally-managed"):
    // 1. Make sure python3 + venv module are available (apt if needed).
    // 2. Create an isolated venv at ~/.hermes/venv and upgrade its pip.
    // 3. Put that venv's bin/ on PATH for the rest of the script so the
    //    Hermes installer (which calls `python3 -m pip install ...`) writes
    //    into the venv instead of fighting the system Python.
    // 4. Symlink ~/.hermes/venv/bin/hermes -> ~/.local/bin/hermes so the CLI
    //    is reachable from a normal interactive shell.
    const ensurePip = [
      'echo "[pip-bootstrap] checking python3..."',
      'command -v python3 >/dev/null || { echo "[pip-bootstrap] FATAL: python3 not found" >&2; exit 40; }',
      'echo "[pip-bootstrap] python3: $(python3 --version 2>&1)"',
      '',
      'PY_VENV_PKG="$(python3 -c \'import sys; print(f"python{sys.version_info.major}.{sys.version_info.minor}-venv")\')"',
      'echo "[pip-bootstrap] expected venv package: $PY_VENV_PKG"',
      '# Ensure both venv and ensurepip are available (Debian/Ubuntu split them out)',
      'if ! python3 -c "import venv, ensurepip" 2>/dev/null; then',
      '  echo "[pip-bootstrap] python venv bootstrap missing — trying apt-get (sudo -n)"',
      '  sudo -n apt-get update 2>&1 | tail -3 || true',
      '  sudo -n apt-get install -y "$PY_VENV_PKG" 2>&1 | tail -5 || echo "[pip-bootstrap] apt-get failed (no passwordless sudo?)"',
      'fi',
      'if ! python3 -c "import venv, ensurepip" 2>/dev/null; then',
      '  echo "[pip-bootstrap] FATAL: Python venv bootstrap support is missing." >&2',
      '  echo "[pip-bootstrap] Open a WSL/Ubuntu terminal and run:" >&2',
      '  echo "[pip-bootstrap]   sudo apt update && sudo apt install -y $PY_VENV_PKG" >&2',
      '  echo "[pip-bootstrap] then retry the install from this app." >&2',
      '  exit 41',
      'fi',
      '',
      'VENV="$HOME/.hermes/venv"',
      'mkdir -p "$HOME/.hermes"',
      '',
      '# A previously-failed venv (created without ensurepip) leaves bin/python',
      '# but no bin/pip. Detect and nuke it before recreating.',
      'if [ -d "$VENV" ] && [ ! -x "$VENV/bin/pip" ]; then',
      '  echo "[pip-bootstrap] existing venv at $VENV is missing pip — recreating"',
      '  rm -rf "$VENV"',
      'fi',
      '',
      'if [ ! -x "$VENV/bin/python" ] || [ ! -x "$VENV/bin/pip" ]; then',
      '  echo "[pip-bootstrap] creating venv at $VENV"',
      '  python3 -m venv "$VENV" || { echo "[pip-bootstrap] FATAL: failed to create venv" >&2; exit 43; }',
      'else',
      '  echo "[pip-bootstrap] reusing existing venv at $VENV"',
      'fi',
      '',
      '# Sanity check: pip MUST exist now.',
      'if [ ! -x "$VENV/bin/pip" ]; then',
      '  echo "[pip-bootstrap] FATAL: $VENV/bin/pip missing after venv creation." >&2',
      '  echo "[pip-bootstrap] python3-venv may not be properly installed. Try reopening WSL and retrying." >&2',
      '  exit 44',
      'fi',
      '',
      'echo "[pip-bootstrap] upgrading pip inside venv"',
      '"$VENV/bin/python" -m pip install --upgrade pip wheel setuptools 2>&1 | tail -5',
      '',
      '# Put venv FIRST on PATH so any later `python3` / `pip` resolves to it.',
      'export PATH="$VENV/bin:$HOME/.local/bin:$PATH"',
      'export VIRTUAL_ENV="$VENV"',
      'echo "[pip-bootstrap] using python: $(command -v python3)"',
      'echo "[pip-bootstrap] using pip: $(command -v pip)"',
      'echo "[pip-bootstrap] pip version: $(pip --version)"',
    ].join('\n');
    // The official installer aborts with "Directory exists but is not a git
    // repository" if a previous attempt left a partial ~/.hermes/hermes-agent
    // checkout (e.g. interrupted clone, or a stray folder). Clean it up so the
    // installer can clone fresh — but ONLY when it's clearly not a real repo,
    // so we never blow away a user's working clone.
    const cleanupStaleCheckout = [
      'HERMES_SRC="$HOME/.hermes/hermes-agent"',
      'if [ -d "$HERMES_SRC" ] && [ ! -d "$HERMES_SRC/.git" ]; then',
      '  echo "[install] removing stale non-repo directory at $HERMES_SRC (left from a previous failed install)"',
      '  rm -rf "$HERMES_SRC"',
      'fi',
    ].join('\n');
    const dl = [
      'echo "[install] downloading installer script..."',
      `curl -fsSL ${INSTALL_SCRIPT} -o /tmp/hermes-install.sh`,
      'chmod +x /tmp/hermes-install.sh',
    ].join('\n');
    const runScript = [
      'echo "[install] running installer (inside venv)..."',
      // Inherit our PATH/VIRTUAL_ENV so the installer's `pip install` lands
      // in the venv and PEP 668 protection no longer applies.
      buildInstallerRunScript(),
      '',
      '# Expose the hermes CLI on the user PATH via ~/.local/bin symlink.',
      'mkdir -p "$HOME/.local/bin"',
      'if [ -x "$VENV/bin/hermes" ]; then',
      '  ln -sf "$VENV/bin/hermes" "$HOME/.local/bin/hermes"',
      '  echo "[install] linked $VENV/bin/hermes -> $HOME/.local/bin/hermes"',
      'else',
      '  echo "[install] note: $VENV/bin/hermes not found after install (extras may still install ok)"',
      'fi',
    ].join('\n');
    // Use `set -e` so any failed step aborts immediately with a clear exit code.
    const fullCmd = ['set -e', unattendedEnv, ensurePip, cleanupStaleCheckout, dl, runScript].join('\n');

    // Extras must install into the same venv, from the LOCAL CHECKOUT that
    // the official install script clones to ~/.hermes/hermes-agent.
    const extrasCmd = (extrasFlagInner: string) => [
      'set -e',
      'HERMES_SRC="$HOME/.hermes/hermes-agent"',
      'if [ ! -d "$HERMES_SRC" ]; then',
      '  echo "[extras] FATAL: $HERMES_SRC not found — base install did not clone the repo" >&2',
      '  exit 50',
      'fi',
      'PIP="$HOME/.hermes/venv/bin/pip"',
      'if [ ! -x "$PIP" ]; then',
      '  echo "[extras] FATAL: venv pip not found at $PIP" >&2',
      '  exit 51',
      'fi',
      `echo "[extras] installing extras ${extrasFlagInner} from $HERMES_SRC"`,
      `"$PIP" install --upgrade -e "$HERMES_SRC${extrasFlagInner}"`,
    ].join('\n');

    // runHermesShell auto-stages large scripts to a temp file, preventing
    // ENAMETOOLONG on the spawn argv (the install payload is multi-KB and
    // combined with the Windows PATH it overflows OS limits when inlined).
    const baseResult = await runHermesShell(fullCmd, { timeout: 600000 }, onOutput);
    if (!baseResult.success) return baseResult;
    if (!extrasFlag) {
      await runHermesShell(BROWSER_EXECUTABLE_FIX_SCRIPT, { timeout: 15000 }, onOutput).catch(() => undefined);
      return finalizeInstallVerification(baseResult, onOutput);
    }

    const extrasResult = await runHermesShell(extrasCmd(extrasFlag), { timeout: 300000 }, onOutput);
    if (!extrasResult.success) return extrasResult;
    await runHermesShell(BROWSER_EXECUTABLE_FIX_SCRIPT, { timeout: 15000 }, onOutput).catch(() => undefined);
    return finalizeInstallVerification(extrasResult, onOutput);
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
  ): Promise<CommandResult> {
    const platform = await coreAPI.getPlatform();
    const wantsExtras = !!(extras && extras.length > 0);
    const extrasFlag = wantsExtras ? `[${extras!.join(',')}]` : '';

    // Resolve the folder path inside the POSIX env (WSL on Windows).
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

    const script = [
      'set -e',
      'export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a SUDO_ASKPASS=/bin/false',
      `SRC="${posixPath}"`,
      'echo "[local-install] using source folder: $SRC"',
      'if [ ! -d "$SRC" ]; then',
      '  echo "[local-install] FATAL: folder does not exist: $SRC" >&2',
      '  exit 60',
      'fi',
      // Heuristic sanity check: must look like a Python package (pyproject.toml or setup.py)
      'if [ ! -f "$SRC/pyproject.toml" ] && [ ! -f "$SRC/setup.py" ]; then',
      '  echo "[local-install] FATAL: $SRC does not contain pyproject.toml or setup.py — not a Python package" >&2',
      '  exit 61',
      'fi',
      '',
      'mkdir -p "$HOME/.hermes"',
      'VENV="$HOME/.hermes/venv"',
      'if [ -d "$VENV" ] && [ ! -x "$VENV/bin/pip" ]; then',
      '  echo "[local-install] existing venv missing pip — recreating"',
      '  rm -rf "$VENV"',
      'fi',
      'if [ ! -x "$VENV/bin/pip" ]; then',
      '  echo "[local-install] creating venv at $VENV"',
      '  python3 -m venv "$VENV" || { echo "[local-install] FATAL: failed to create venv" >&2; exit 62; }',
      'fi',
      '"$VENV/bin/python" -m pip install --upgrade pip wheel setuptools 2>&1 | tail -5',
      '',
      // Mirror the cloned-source layout so update/doctor flows that look in
      // ~/.hermes/hermes-agent still work. We DON'T copy the user's folder —
      // we install it editable so they keep working from their checkout.
      'ln -sfn "$SRC" "$HOME/.hermes/hermes-agent"',
      '',
      `echo "[local-install] pip install -e \\"$SRC${extrasFlag}\\""`,
      `"$VENV/bin/pip" install --upgrade -e "$SRC${extrasFlag}"`,
      '',
      'mkdir -p "$HOME/.local/bin"',
      'if [ -x "$VENV/bin/hermes" ]; then',
      '  ln -sf "$VENV/bin/hermes" "$HOME/.local/bin/hermes"',
      '  echo "[local-install] linked $VENV/bin/hermes -> $HOME/.local/bin/hermes"',
      'else',
      '  echo "[local-install] WARNING: $VENV/bin/hermes not found after install" >&2',
      'fi',
      'echo "[local-install] done."',
    ].join('\n');

    const result = await runHermesShell(script, { timeout: 600000 }, onOutput);
    if (!result.success) return result;
    await runHermesShell(BROWSER_EXECUTABLE_FIX_SCRIPT, { timeout: 15000 }, onOutput).catch(() => undefined);
    return finalizeInstallVerification(result, onOutput);
  },

  /** Alternative: install via git clone + editable pip into the dedicated venv.
   *  hermes-agent is NOT on PyPI, so we clone from GitHub and install editable. */
  async installViaPip(): Promise<CommandResult> {
    const platform = await coreAPI.getPlatform();
    const script =
      'set -e; mkdir -p "$HOME/.hermes"; ' +
      'if [ -d "$HOME/.hermes/venv" ] && [ ! -x "$HOME/.hermes/venv/bin/pip" ]; then rm -rf "$HOME/.hermes/venv"; fi; ' +
      '[ -x "$HOME/.hermes/venv/bin/pip" ] || python3 -m venv "$HOME/.hermes/venv"; ' +
      '"$HOME/.hermes/venv/bin/pip" install --upgrade pip wheel setuptools; ' +
      'HERMES_SRC="$HOME/.hermes/hermes-agent"; ' +
      'if [ ! -d "$HERMES_SRC/.git" ]; then ' +
      '  rm -rf "$HERMES_SRC"; ' +
      '  git clone --depth 1 https://github.com/NousResearch/hermes-agent.git "$HERMES_SRC"; ' +
      'else ' +
      '  git -C "$HERMES_SRC" pull --ff-only || true; ' +
      'fi; ' +
      '"$HOME/.hermes/venv/bin/pip" install --upgrade -e "$HERMES_SRC"; ' +
      'mkdir -p "$HOME/.local/bin"; ' +
      'ln -sf "$HOME/.hermes/venv/bin/hermes" "$HOME/.local/bin/hermes"';
    const b64 = btoa(unescape(encodeURIComponent(script)));
    const decode = `echo ${b64} | base64 -d | bash`;
    const cmd = platform.isWindows ? `wsl bash -lc "${decode}"` : `bash -lc "${decode}"`;
    return coreAPI.runCommand(cmd, { timeout: 300000 });
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

    const env = await this.readEnvFile().catch(() => ({} as Record<string, string>));
    const hasMessagingConfigured = Boolean(
      ((env.WHATSAPP_ENABLED || '').trim().toLowerCase() === 'true' && (env.WHATSAPP_ALLOWED_USERS || '').trim().length > 0) ||
      (env.TELEGRAM_BOT_TOKEN || '').trim() ||
      (env.SLACK_BOT_TOKEN || '').trim() ||
      (env.DISCORD_BOT_TOKEN || '').trim(),
    );

    if (hasMessagingConfigured) {
      await timed('gateway-refresh-install', async () => {
        const r = await this.refreshGatewayInstall();
        return { ok: r.success, detail: r.success ? 'gateway install refreshed' : (r.stderr || r.stdout || 'refresh failed').split('\n')[0] };
      });
      await timed('gateway-start', async () => {
        const r = await this.startGateway();
        return { ok: r.success, detail: r.success ? 'gateway started/verified' : (r.stderr || r.stdout || 'start failed').split('\n')[0] };
      });
    }

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
      } else if (issue.fixAction === 'refresh-gateway') {
        const r = await this.refreshGatewayInstall();
        actions.push(r.success ? 'refreshed gateway install' : `failed gateway refresh: ${(r.stderr || r.stdout || '').split('\n')[0] || 'unknown'}`);
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

  /** Remove a key from ~/.hermes/.env */
  async removeEnvVar(key: string): Promise<{ success: boolean }> {
    const result = await readHermesFile(HERMES_ENV);
    if (!result.success || !result.content) return { success: true };

    const lines = result.content.split('\n').filter((line) => !line.trim().startsWith(`${key}=`));
    return writeHermesFile(HERMES_ENV, lines.join('\n'), '600');
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

  /** Start the agent (interactive mode in a terminal).
   *  Decrypts secrets and materializes ~/.hermes/.env (chmod 600) right
   *  before launch, so plaintext secrets only exist on disk while running. */
  async start(): Promise<CommandResult> {
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

  /** Start the messaging gateway */
  async startGateway(): Promise<CommandResult> {
    agentLogs.push({ source: 'gateway', level: 'info', summary: 'Starting messaging gateway…' });
    const platform = await coreAPI.getPlatform();
    if (platform.isWindows) {
      // Desktop app on Windows must route Hermes execution into WSL.
      // Probe that route up-front so we fail fast with an actionable error
      // instead of surfacing a generic WhatsApp finalization timeout later.
      const wslProbe = await coreAPI.runCommand('wsl bash -lc "echo RONBOT_WSL_OK"', {
        timeout: 10000,
        displayCommand: 'wsl routing precheck',
      });
      const probeOut = `${wslProbe.stdout || ''}\n${wslProbe.stderr || ''}`;
      if (!wslProbe.success || !/RONBOT_WSL_OK/.test(probeOut)) {
        const msg =
          'Windows desktop could not execute Hermes through WSL. Open WSL once, verify `wsl --status` succeeds, then retry WhatsApp setup.';
        const failed: CommandResult = {
          success: false,
          stdout: wslProbe.stdout || '',
          stderr: `${msg}${wslProbe.stderr ? `\n${wslProbe.stderr}` : ''}`,
          code: typeof wslProbe.code === 'number' ? wslProbe.code : 1,
        };
        agentLogs.push({
          source: 'gateway',
          level: 'error',
          summary: 'Gateway start blocked (WSL routing failed)',
          detail: truncateForLog([failed.stdout, failed.stderr].filter(Boolean).join('\n')),
        });
        return failed;
      }
    }
    await materializeHermesEnv();
    // Some Hermes installs don't have the user-service unit registered yet.
    // Install/register the gateway service, then retry start before giving up.
    // NOTE: runHermesCli wraps everything in `set -e`, so we explicitly switch
    // to `set +e` here to collect rc codes and run fallback steps.
    const r = await runHermesCli(
      [
        'set +e',
        HERMES_PATH_EXPORT,
        // User systemd units often lack Homebrew/snap/npm on PATH — push ours in
        // so the gateway subprocess can install the WhatsApp bridge.
        'systemctl --user set-environment PATH="$PATH" 2>/dev/null || true',
        'hermes gateway start 2>&1',
        'RC=$?',
        'COMBINED_LOG=""',
        'if [ -f /tmp/hermes-gateway.log ]; then COMBINED_LOG="$(tail -n 120 /tmp/hermes-gateway.log 2>/dev/null || true)"; fi',
        'if [ "$RC" -ne 0 ]; then',
        '  STATUS_OUT="$(hermes gateway status 2>&1 || true)"',
        '  printf "%s\\n%s\\n" "$COMBINED_LOG" "$STATUS_OUT" | grep -Eqi "already running|pid [0-9]+" && RC=42',
        'fi',
        // First recovery path for stale/running gateway: restart in-place.
        'if [ "$RC" -eq 42 ]; then',
        '  echo "[gateway] detected running gateway; attempting restart"',
        '  hermes gateway restart 2>&1',
        '  RC=$?',
        'fi',
        'if [ "$RC" -ne 0 ]; then',
        '  hermes gateway install 2>&1 || true',
        '  hermes gateway start 2>&1',
        '  RC=$?',
        'fi',
        // Last resort for environments where service units are unavailable:
        // force-replace with foreground command in background mode.
        'if [ "$RC" -ne 0 ]; then',
        '  nohup hermes gateway run --replace >/tmp/hermes-gateway.log 2>&1 &',
        '  sleep 3',
        '  pgrep -f "hermes gateway" >/dev/null 2>&1',
        '  if [ $? -eq 0 ]; then',
        '    echo "[gateway] started in background replace mode"',
        '    RC=0',
        '  else',
        '    RC=1',
        '  fi',
        'fi',
        'if [ "$RC" -ne 0 ]; then',
        '  hermes gateway status 2>&1 || true',
        'fi',
        'exit "$RC"',
      ].join('\n'),
      { timeout: 90000 },
    );
    const combined = `${r.stdout || ''}\n${r.stderr || ''}`.toLowerCase();
    const missingGatewayUnit =
      combined.includes('hermes-gateway.service') &&
      (combined.includes('not found') || combined.includes('could not be found'));
    const startedInBackgroundFallback = combined.includes('[gateway] started in background replace mode');
    const interactiveGatewaySetupDetected =
      combined.includes('gateway setup') ||
      combined.includes('select [1-18]') ||
      combined.includes('please enter a number');
    const normalized = missingGatewayUnit
      ? startedInBackgroundFallback
        ? { ...r, success: true }
        : {
            ...r,
            success: false,
            stderr:
              (r.stderr?.trim() ? `${r.stderr.trim()}\n` : '') +
              'Gateway service unit is missing. Run `hermes gateway install` in a terminal, then retry channel setup.',
          }
      : interactiveGatewaySetupDetected
        ? {
            ...r,
            success: false,
            stderr:
              (r.stderr?.trim() ? `${r.stderr.trim()}\n` : '') +
              'Gateway attempted to open an interactive setup flow. Ronbot only supports non-interactive startup here; retry setup and check App Diagnostics if this repeats.',
          }
        : r;
    agentLogs.push({
      source: 'gateway',
      level: normalized.success ? 'info' : 'error',
      summary: normalized.success ? 'Gateway started' : `Gateway failed (exit=${normalized.code})`,
      detail: truncateForLog([normalized.stdout, normalized.stderr].filter(Boolean).join('\n')),
    });
    return normalized;
  },

  /**
   * Inspect the running gateway and report whether the WhatsApp adapter
   * is actually live (process running + bridge log shows a successful
   * Baileys connection). Used after pairing/startGateway so the wizard
   * can confirm messages will actually reach the agent on WhatsApp,
   * instead of declaring success on a no-op exit code.
   *
   * Returns:
   *   - running: gateway process detected (systemd unit OR background pgrep)
   *   - whatsappActive: bridge log indicates an open Baileys connection
   *   - statusOutput: trimmed text from `hermes gateway status` for logs
   *   - bridgeLogTail: last meaningful lines from the bridge log
   */
  async getWhatsAppGatewayHealth(): Promise<{
    success: boolean;
    running: boolean;
    whatsappActive: boolean;
    source: 'gateway_state' | 'bridge_health' | 'cli_status' | 'log_tail' | 'none';
    statusOutput: string;
    bridgeLogTail: string;
    bridgeHealthJson: string;
    gatewayStateJson: string;
    error?: string;
  }> {
    // Authoritative signals, in priority order:
    //   1. ~/.hermes/gateway_state.json -> platforms.whatsapp.state == "connected"
    //   2. http://127.0.0.1:3000/health -> { status: "connected" }
    //   3. `hermes gateway status` text mentioning WhatsApp connected/active
    //   4. bridge.log tail showing a Baileys "connection open" line (diag only)
    // The gateway process itself is reported via systemd unit OR pgrep fallback.
    const r = await runHermesCli(
      [
        'set +e',
        HERMES_PATH_EXPORT,
        // --- gateway process detection ---
        'PROC_OK=0',
        'if command -v systemctl >/dev/null 2>&1; then',
        '  if systemctl --user is-active hermes-gateway >/dev/null 2>&1; then PROC_OK=1; fi',
        '  if [ "$PROC_OK" -eq 0 ] && systemctl is-active hermes-gateway >/dev/null 2>&1; then PROC_OK=1; fi',
        'fi',
        'if [ "$PROC_OK" -eq 0 ]; then pgrep -f "hermes gateway" >/dev/null 2>&1 && PROC_OK=1; fi',
        'if [ "$PROC_OK" -eq 0 ]; then pgrep -f "gateway.run" >/dev/null 2>&1 && PROC_OK=1; fi',
        'if [ "$PROC_OK" -eq 0 ]; then pgrep -f "hermes.*gateway" >/dev/null 2>&1 && PROC_OK=1; fi',
        // --- 1. gateway_state.json ---
        'GATEWAY_STATE=""',
        'WA_OK=0',
        'WA_SOURCE="none"',
        'for f in "$HOME/.hermes/gateway_state.json" "$HOME/.hermes/state/gateway_state.json"; do',
        '  if [ -f "$f" ]; then',
        '    GATEWAY_STATE="$(cat "$f" 2>/dev/null || true)"',
        '    break',
        '  fi',
        'done',
        'if [ -n "$GATEWAY_STATE" ]; then',
        '  if command -v python3 >/dev/null 2>&1; then',
        '    WA_STATE="$(printf "%s" "$GATEWAY_STATE" | python3 -c "import json,sys;\\nd=json.load(sys.stdin);\\np=(d.get(\\"platforms\\") or {}).get(\\"whatsapp\\") or {};\\nprint(p.get(\\"state\\") or \\"\\")" 2>/dev/null || true)"',
        '    case "$WA_STATE" in',
        '      connected|ready|online) WA_OK=1; WA_SOURCE="gateway_state" ;;',
        '    esac',
        '  fi',
        '  # Fallback grep when python3 unavailable',
        '  if [ "$WA_OK" -eq 0 ] && printf "%s" "$GATEWAY_STATE" | grep -E -i "\\\"whatsapp\\\"[[:space:]]*:[[:space:]]*\\{[^}]*\\\"state\\\"[[:space:]]*:[[:space:]]*\\\"(connected|ready|online)\\\"" >/dev/null 2>&1; then',
        '    WA_OK=1; WA_SOURCE="gateway_state"',
        '  fi',
        'fi',
        // --- 2. bridge /health ---
        'BRIDGE_HEALTH=""',
        'if [ "$WA_OK" -eq 0 ] && command -v curl >/dev/null 2>&1; then',
        '  for url in "http://127.0.0.1:3000/health" "http://127.0.0.1:3000/healthz" "http://127.0.0.1:3001/health"; do',
        '    BH="$(curl -fsS --max-time 3 "$url" 2>/dev/null || true)"',
        '    if [ -n "$BH" ]; then',
        '      BRIDGE_HEALTH="$BH"',
        '      if printf "%s" "$BH" | grep -E -i "\\\"status\\\"[[:space:]]*:[[:space:]]*\\\"(connected|ready|open|online)\\\"" >/dev/null 2>&1; then',
        '        WA_OK=1; WA_SOURCE="bridge_health"',
        '        break',
        '      fi',
        '    fi',
        '  done',
        'fi',
        // --- 3. CLI status ---
        'STATUS_OUT="$(hermes gateway status 2>&1 || true)"',
        'if [ "$WA_OK" -eq 0 ] && printf "%s" "$STATUS_OUT" | grep -E -i "whatsapp.*(connected|active|ready|online|ok)" >/dev/null 2>&1; then',
        '  WA_OK=1; WA_SOURCE="cli_status"',
        'fi',
        'if [ "$PROC_OK" -eq 0 ] && printf "%s" "$STATUS_OUT" | grep -Eqi "(user gateway service is running|gateway service is running|active \\(running\\)|hermes-gateway)"; then',
        '  PROC_OK=1',
        'fi',
        // --- 4. bridge log tail (diagnostic only) ---
        'BRIDGE_TAIL=""',
        'WA_FILES="$HOME/.hermes/platforms/whatsapp/bridge.log $HOME/.hermes/logs/whatsapp-bridge.log $HOME/.hermes/hermes-agent/scripts/whatsapp-bridge/bridge.log /tmp/hermes-gateway.log"',
        'for f in $WA_FILES; do',
        '  [ -f "$f" ] || continue',
        '  chunk="$(tail -n 120 "$f" 2>/dev/null || true)"',
        '  BRIDGE_TAIL="$BRIDGE_TAIL\n--- $f ---\n$chunk"',
        'done',
        'if [ "$WA_OK" -eq 0 ] && [ -n "$BRIDGE_TAIL" ]; then',
        '  if printf "%s" "$BRIDGE_TAIL" | grep -E -i "whatsapp.*(connected|ready|online)|connection.*open|\\[whatsapp\\].*(connected|ready)|gateway\\.run:.*✓.*whatsapp" >/dev/null 2>&1; then',
        '    WA_OK=1; WA_SOURCE="log_tail"',
        '  fi',
        'fi',
        'echo "PROC_OK=$PROC_OK"',
        'echo "WA_OK=$WA_OK"',
        'echo "WA_SOURCE=$WA_SOURCE"',
        'echo "STATUS_OUT_BEGIN"',
        'printf "%s\\n" "$STATUS_OUT"',
        'echo "STATUS_OUT_END"',
        'echo "BRIDGE_HEALTH_BEGIN"',
        'printf "%s\\n" "$BRIDGE_HEALTH"',
        'echo "BRIDGE_HEALTH_END"',
        'echo "GATEWAY_STATE_BEGIN"',
        'printf "%s\\n" "$GATEWAY_STATE"',
        'echo "GATEWAY_STATE_END"',
        'echo "BRIDGE_TAIL_BEGIN"',
        'printf "%s\\n" "$BRIDGE_TAIL"',
        'echo "BRIDGE_TAIL_END"',
        'exit 0',
      ].join('\n'),
      { timeout: 20000 },
    );
    const out = `${r.stdout || ''}`;
    const between = (begin: string, end: string): string => {
      const i = out.indexOf(begin);
      const j = out.indexOf(end);
      if (i < 0 || j < 0 || j <= i) return '';
      return out.slice(i + begin.length, j).trim();
    };
    const statusOutput = between('STATUS_OUT_BEGIN', 'STATUS_OUT_END');
    const bridgeLogTail = between('BRIDGE_TAIL_BEGIN', 'BRIDGE_TAIL_END');
    const bridgeHealthJson = between('BRIDGE_HEALTH_BEGIN', 'BRIDGE_HEALTH_END');
    const gatewayStateJson = between('GATEWAY_STATE_BEGIN', 'GATEWAY_STATE_END');
    const procOk = /PROC_OK=1/.test(out);
    const waOk = /WA_OK=1/.test(out);
    const sourceMatch = out.match(/WA_SOURCE=(\w+)/);
    const source = (sourceMatch?.[1] as 'gateway_state' | 'bridge_health' | 'cli_status' | 'log_tail' | 'none') || 'none';
    return {
      success: r.success,
      running: procOk,
      whatsappActive: waOk,
      source,
      statusOutput,
      bridgeLogTail,
      bridgeHealthJson,
      gatewayStateJson,
      error: r.success ? undefined : (r.stderr || '').split('\n')[0] || undefined,
    };
  },

  /**
   * Runtime WhatsApp bridge status (`hermes gateway status` + gateway_state +
   * bridge logs). Same implementation as {@link getWhatsAppGatewayHealth}.
   */
  async getWhatsAppBridgeStatus() {
    return this.getWhatsAppGatewayHealth();
  },

  /** Last lines of official bridge logs (~/.hermes/platforms/whatsapp/bridge.log, etc.). */
  async readWhatsAppBridgeLogTail(maxLines = 120): Promise<{ success: boolean; content: string; error?: string }> {
    const n = Math.min(400, Math.max(20, Math.floor(maxLines)));
    const r = await runHermesShell(
      [
        'set +e',
        'OUT=""',
        'WA_FILES="$HOME/.hermes/platforms/whatsapp/bridge.log $HOME/.hermes/logs/whatsapp-bridge.log $HOME/.hermes/hermes-agent/scripts/whatsapp-bridge/bridge.log /tmp/hermes-gateway.log"',
        'for f in $WA_FILES; do',
        '  [ -f "$f" ] || continue',
        '  chunk="$(tail -n ' + String(n) + ' "$f" 2>/dev/null || true)"',
        '  OUT="$OUT\n--- $f ---\n$chunk"',
        'done',
        'printf "%s" "$OUT"',
        'exit 0',
      ].join('\n'),
      { timeout: 15000 },
    );
    const content = [r.stdout, r.stderr].filter(Boolean).join('\n').trim();
    return { success: r.success, content: content || '(no bridge log files found yet)', error: r.success ? undefined : r.stderr };
  },

  /** Stop the messaging gateway */
  async stopGateway(): Promise<CommandResult> {
    agentLogs.push({ source: 'gateway', level: 'info', summary: 'Stopping messaging gateway…' });
    const r = await runHermesCli(
      'hermes gateway stop 2>&1 || hermes gateway status 2>&1',
      { timeout: 30000 },
    );
    agentLogs.push({
      source: 'gateway',
      level: r.success ? 'info' : 'error',
      summary: r.success ? 'Gateway stopped' : `Gateway stop failed (exit=${r.code})`,
      detail: truncateForLog([r.stdout, r.stderr].filter(Boolean).join('\n')),
    });
    return r;
  },

  /** Verify channel credentials with supported direct HTTP / filesystem checks. */
  async testChannel(channelId: string): Promise<CommandResult> {
    if (!/^(telegram|slack|whatsapp|discord|signal)$/.test(channelId)) {
      return runHermesShell('echo "Invalid channel" >&2; exit 2', { timeout: 5000 });
    }
    return runHermesShell(buildChannelCredentialTestScript(channelId), { timeout: 60000 });
  },

  /** True when `npm` is on PATH (WhatsApp bridge install needs it for the gateway). */
  async checkNpmForMessaging(): Promise<CommandResult> {
    return runHermesShell(
      [
        'set +e',
        HERMES_PATH_EXPORT,
        'command -v npm >/dev/null 2>&1 || { echo "npm_not_found" >&2; echo "Install Node.js (includes npm), e.g. apt install npm, brew install node, or https://nodejs.org — then restart the gateway." >&2; exit 1; }',
        'echo "npm_ok=$(npm --version)"',
        'exit 0',
      ].join('\n'),
      { timeout: 15000 },
    );
  },

  /**
   * Ensure a managed Linux Node runtime exists under ~/.hermes/runtime/node.
   * This avoids distro npm conflicts and Windows/UNC path issues on WSL.
   */
  async ensureHermesNodeRuntime(
    onOutput?: CommandOutputHandler,
    options?: Record<string, unknown> & { onStreamId?: (id: string) => void },
  ): Promise<CommandResult> {
    return runHermesShell(
      [
        'set +e',
        HERMES_PATH_EXPORT,
        getHermesNodeEnvExport(),
        'mkdir -p "$NODE_RUNTIME_DIR"',
        'if [ -x "$NODE_RUNTIME_HOME/bin/node" ] && [ -x "$NODE_RUNTIME_HOME/bin/npm" ]; then',
        '  NP="$("$NODE_RUNTIME_HOME/bin/node" -p "process.platform" 2>/dev/null || true)"',
        '  if [ "$NP" = "linux" ]; then',
        '    echo "[ronbot] Managed Node runtime ready: $("$NODE_RUNTIME_HOME/bin/node" --version) ($NODE_RUNTIME_HOME)"',
        '    exit 0',
        '  fi',
        'fi',
        'echo "[ronbot] Installing managed Node runtime ($NODE_RUNTIME_VERSION)..."',
        'TARBALL="node-${NODE_RUNTIME_VERSION}-linux-${NODE_ARCH}.tar.xz"',
        'URL="https://nodejs.org/dist/${NODE_RUNTIME_VERSION}/${TARBALL}"',
        'TMP="/tmp/ronbot-node-${NODE_RUNTIME_VERSION}-${NODE_ARCH}.tar.xz"',
        'if command -v curl >/dev/null 2>&1; then',
        '  curl -fsSL --retry 3 --connect-timeout 15 "$URL" -o "$TMP" || { echo "[ronbot] Failed to download managed Node runtime from $URL" >&2; exit 1; }',
        'elif command -v wget >/dev/null 2>&1; then',
        '  wget -qO "$TMP" "$URL" || { echo "[ronbot] Failed to download managed Node runtime from $URL" >&2; exit 1; }',
        'else',
        '  echo "[ronbot] Need curl or wget to download managed Node runtime." >&2',
        '  exit 1',
        'fi',
        'rm -rf "$NODE_RUNTIME_HOME"',
        'tar -xJf "$TMP" -C "$NODE_RUNTIME_DIR" || { echo "[ronbot] Failed to extract Node runtime archive." >&2; exit 1; }',
        'rm -f "$TMP"',
        '[ -x "$NODE_RUNTIME_HOME/bin/node" ] || { echo "[ronbot] Managed Node install incomplete: node binary missing." >&2; exit 1; }',
        '[ -x "$NODE_RUNTIME_HOME/bin/npm" ] || { echo "[ronbot] Managed Node install incomplete: npm binary missing." >&2; exit 1; }',
        'echo "[ronbot] Managed Node runtime installed: $("$NODE_RUNTIME_HOME/bin/node" --version)"',
        'echo "[ronbot] Managed npm runtime installed: $("$NODE_RUNTIME_HOME/bin/npm" --version)"',
        'exit 0',
      ].join('\n'),
      { timeout: 900000, ...(options ?? {}) },
      onOutput,
    );
  },

  /**
   * npm + `script(1)` for in-app WhatsApp QR pairing (PTY). Hermes bridge also
   * needs npm when the gateway runs.
   */
  async checkWhatsAppPairingPrereqs(): Promise<CommandResult> {
    return runHermesShell(
      [
        'set +e',
        HERMES_PATH_EXPORT,
        getHermesNodeEnvExport(),
        'MISS=""',
        '[ -x "$NODE_RUNTIME_HOME/bin/node" ] || MISS="$MISS managed-node"',
        '[ -x "$NODE_RUNTIME_HOME/bin/npm" ] || MISS="$MISS managed-npm"',
        'command -v script >/dev/null 2>&1 || MISS="$MISS script"',
        'if [ -n "$MISS" ]; then',
        '  echo "Missing:$MISS" >&2',
        '  echo "Ronbot needs managed Node runtime + script for WhatsApp pairing." >&2',
        '  exit 1',
        'fi',
        'echo "node_ok=$("$NODE_RUNTIME_HOME/bin/node" --version) npm_ok=$("$NODE_RUNTIME_HOME/bin/npm" --version) node_home=$NODE_RUNTIME_HOME"',
        'exit 0',
      ].join('\n'),
      { timeout: 15000 },
    );
  },

  /**
   * Repair WhatsApp bridge deps inside ~/.hermes/hermes-agent/scripts/whatsapp-bridge.
   * This prevents the common ERR_MODULE_NOT_FOUND for @whiskeysockets/baileys
   * right before QR rendering.
   *
   * Hardened against silent npm hangs (a known npm 10.9.x + WSL issue):
   *  - Uses the managed npm binary explicitly (full path, not PATH lookup).
   *  - Emits a heartbeat every 15s while npm install is running so the UI
   *    never appears frozen even if npm itself produces no output.
   *  - First attempt uses sane network/retry caps; on failure, wipes
   *    node_modules + package-lock.json and retries with `--force` which is
   *    documented to bypass the cache revalidation hang.
   *  - Long timeout (15 min) accommodates first-time installs on slow links.
   */
  async ensureWhatsAppBridgeDeps(
    onOutput?: CommandOutputHandler,
    options?: Record<string, unknown> & { onStreamId?: (id: string) => void },
  ): Promise<CommandResult> {
    return runHermesShell(
      [
        'set +e',
        HERMES_PATH_EXPORT,
        getHermesNodeEnvExport(),
        'BRIDGE_DIR="$HOME/.hermes/hermes-agent/scripts/whatsapp-bridge"',
        '[ -d "$BRIDGE_DIR" ] || { echo "WhatsApp bridge folder not found: $BRIDGE_DIR" >&2; exit 1; }',
        'cd "$BRIDGE_DIR" || exit 1',
        '[ -f package.json ] || { echo "WhatsApp bridge package.json is missing" >&2; exit 1; }',
        '[ -x "$NODE_RUNTIME_HOME/bin/npm" ] || { echo "Managed npm runtime missing at $NODE_RUNTIME_HOME/bin/npm" >&2; exit 1; }',
        '[ -x "$NODE_RUNTIME_HOME/bin/node" ] || { echo "Managed node runtime missing at $NODE_RUNTIME_HOME/bin/node" >&2; exit 1; }',
        'NPM_BIN="$NODE_RUNTIME_HOME/bin/npm"',
        'NODE_BIN="$NODE_RUNTIME_HOME/bin/node"',
        'echo "[ronbot] using managed Node runtime: $("$NODE_BIN" --version) ($NODE_RUNTIME_HOME)"',
        'echo "[ronbot] using managed npm: $("$NPM_BIN" --version)"',
        '',
        '# Common npm flags to avoid silent hangs on WSL/Windows: hard caps on',
        '# fetch retries and timeouts, no audit/fund chatter, and progress=false',
        '# so npm flushes log lines instead of buffering for a TTY.',
        'NPM_COMMON_FLAGS="--no-audit --no-fund --progress=false --fetch-retries=3 --fetch-retry-mintimeout=5000 --fetch-retry-maxtimeout=30000 --fetch-timeout=120000"',
        '',
        'run_npm_install() {',
        '  local label="$1"; shift',
        '  local extra_flags="$1"; shift',
        '  echo "[ronbot] $label"',
        '  # Heartbeat: print a line every 15s so the renderer knows we are',
        '  # still alive even when npm is silently resolving the dep tree.',
        '  ( while true; do sleep 15; echo "[ronbot] still installing dependencies… (this can take several minutes on first run)"; done ) &',
        '  local HB_PID=$!',
        '  "$NPM_BIN" install $NPM_COMMON_FLAGS $extra_flags 2>&1',
        '  local rc=$?',
        '  kill "$HB_PID" 2>/dev/null',
        '  wait "$HB_PID" 2>/dev/null',
        '  return $rc',
        '}',
        '',
        'NEEDS_INSTALL=0',
        'if [ ! -d "node_modules/@whiskeysockets/baileys" ]; then',
        '  NEEDS_INSTALL=1',
        'else',
        '  "$NPM_BIN" ls @whiskeysockets/baileys --depth=0 >/dev/null 2>&1 || NEEDS_INSTALL=1',
        'fi',
        '',
        'if [ "$NEEDS_INSTALL" = "1" ]; then',
        '  run_npm_install "repairing WhatsApp bridge dependencies (npm install)…" ""',
        '  rc=$?',
        '  if [ $rc -ne 0 ]; then',
        '    echo "[ronbot] First npm install attempt failed (exit $rc). Cleaning node_modules and retrying with --force…" >&2',
        '    rm -rf node_modules package-lock.json 2>/dev/null',
        '    "$NPM_BIN" cache verify >/dev/null 2>&1 || true',
        '    run_npm_install "retrying WhatsApp bridge dependency install with --force…" "--force"',
        '    rc=$?',
        '    if [ $rc -ne 0 ]; then',
        '      echo "[ronbot] npm install failed twice. This is usually a network or npm registry issue." >&2',
        '      echo "[ronbot] Check internet access and try again. On WSL, try: wsl --shutdown then reopen Ronbot." >&2',
        '      exit $rc',
        '    fi',
        '  fi',
        '  # Final sanity check: baileys must be present after install.',
        '  if [ ! -d "node_modules/@whiskeysockets/baileys" ]; then',
        '    echo "[ronbot] npm install completed but @whiskeysockets/baileys is still missing." >&2',
        '    exit 1',
        '  fi',
        'fi',
        'echo "[ronbot] WhatsApp bridge deps look healthy."',
        'exit 0',
      ].join('\n'),
      { timeout: 900000, ...(options ?? {}) },
      onOutput,
    );
  },

  /**
   * Tools needed before Ronbot can run credential tests (HTTP/json fallback).
   * WhatsApp session-only check does not need curl/python3 here.
   */
  async checkChannelSetupTools(channelId: string): Promise<CommandResult> {
    if (!/^(telegram|slack|whatsapp|discord|signal)$/.test(channelId)) {
      return { success: false, stdout: '', stderr: 'Invalid channel', code: 2 };
    }
    return runHermesShell(
      [
        'set +e',
        HERMES_PATH_EXPORT,
        `CH="${channelId}"`,
        'MISS=""',
        'case "$CH" in',
        '  telegram|slack|discord)',
        '    command -v curl >/dev/null 2>&1 || MISS="$MISS curl"',
        '    command -v python3 >/dev/null 2>&1 || MISS="$MISS python3"',
        '    ;;',
        '  signal)',
        '    command -v curl >/dev/null 2>&1 || MISS="$MISS curl"',
        '    ;;',
        '  whatsapp)',
        '    :',
        '    ;;',
        'esac',
        'if [ -n "$MISS" ]; then',
        '  echo "Ronbot needs these tools for the channel test:$MISS" >&2',
        '  echo "Install curl and Python 3 on this system (same environment as Hermes). On Windows, install them inside WSL if Ronbot uses WSL." >&2',
        '  exit 1',
        'fi',
        'echo ok',
        'exit 0',
      ].join('\n'),
      { timeout: 10000 },
    );
  },

  /**
   * Re-register the gateway user service so PATH (npm, Homebrew, etc.) is
   * snapshotted — Hermes documents this after installing Node or changing PATH on macOS/Linux.
   */
  async refreshGatewayInstall(): Promise<CommandResult> {
    const platform = await coreAPI.getPlatform();
    if (platform.isWindows || platform.isWSL) {
      // In WSL/manual-gateway mode, `hermes gateway install` reports systemd
      // warnings and is not the right remediation path. Treat refresh as a
      // no-op success to avoid noisy false failures in diagnostics/bootstrap.
      return {
        success: true,
        stdout: '[gateway] skipped service install refresh in WSL/manual mode',
        stderr: '',
        code: 0,
      };
    }
    await materializeHermesEnv().catch(() => undefined);
    const r = await runHermesCli(
      [
        'set +e',
        HERMES_PATH_EXPORT,
        'systemctl --user set-environment PATH="$PATH" 2>/dev/null || true',
        'hermes gateway install 2>&1',
        'RC=$?',
        'exit "$RC"',
      ].join('\n'),
      { timeout: 120000 },
    );
    // Hermes regenerates the systemd unit / launchd plist on every install,
    // overwriting any prior PATH edits. Immediately re-prepend the managed
    // Node shim and patch the installed WhatsApp adapter so the bridge
    // subprocess always launches on Node v20 instead of the system Node 18
    // captured in the unit's PATH snapshot.
    await this.patchGatewayServicePathForWhatsApp().catch(() => undefined);
    await this.patchHermesWhatsAppAdapterForNode().catch(() => undefined);
    return r;
  },

  /** True when WhatsApp session data exists with a real Baileys creds.json. */
  async isWhatsAppPaired(): Promise<{ success: boolean; paired: boolean; error?: string }> {
    const r = await runHermesShell(
      [
        'set +e',
        // Canonical Hermes signal for WhatsApp pairing.
        'PAIRED=0',
        'if [ -f "$HOME/.hermes/platforms/whatsapp/session/creds.json" ]; then PAIRED=1; fi',
        'echo "PAIRED=$PAIRED"',
        'exit 0',
      ].join('\n'),
      { timeout: 10000 },
    );
    if (!r.success) {
      return { success: false, paired: false, error: r.stderr || r.stdout || 'Failed to check WhatsApp pairing' };
    }
    const out = `${r.stdout || ''}\n${r.stderr || ''}`;
    return { success: true, paired: /PAIRED=1/.test(out) };
  },

  async getWhatsAppSessionFileCount(): Promise<{ success: boolean; count: number; error?: string }> {
    const r = await runHermesShell(
      [
        'set +e',
        'BRIDGE_DIR="$HOME/.hermes/hermes-agent/scripts/whatsapp-bridge"',
        'TOTAL=0',
        'for d in "$HOME/.hermes/platforms/whatsapp/session" "$HOME/.hermes/whatsapp" "$HOME/.hermes/.whatsapp" "$BRIDGE_DIR"/auth_info* "$BRIDGE_DIR"/baileys_auth* "$BRIDGE_DIR"/session*; do',
        '  [ -e "$d" ] || continue',
        '  if [ -d "$d" ]; then C="$(find "$d" -type f 2>/dev/null | head -n 1 | wc -l | tr -d \' \')"; else C=1; fi',
        '  TOTAL=$((TOTAL + C))',
        'done',
        'echo "SESSION_COUNT=$TOTAL"',
        'exit 0',
      ].join('\n'),
      { timeout: 10000 },
    );
    if (!r.success) {
      return { success: false, count: 0, error: r.stderr || r.stdout || 'Failed to check WhatsApp session files' };
    }
    const out = `${r.stdout || ''}\n${r.stderr || ''}`;
    const count = Number((out.match(/SESSION_COUNT=(\d+)/)?.[1] ?? '0'));
    return { success: true, count };
  },

  /**
   * Force-clear ALL WhatsApp local session/auth files so pairing starts cleanly.
   * Covers Hermes' primary session dir AND Baileys bridge auth folders, which
   * survive uninstalling the desktop app on Windows because `~/.hermes/` lives
   * in WSL home. Without this, Baileys finds an old auth folder and tries to
   * resume instead of generating a fresh QR code.
   */
  async clearWhatsAppSession(): Promise<{ success: boolean; removed: number; before: number; stderr?: string }> {
    const r = await runHermesShell(
      [
        'set +e',
        'BRIDGE_DIR="$HOME/.hermes/hermes-agent/scripts/whatsapp-bridge"',
        'BEFORE=0',
        'count_path() {',
        '  [ -e "$1" ] || { echo 0; return; }',
        '  if [ -d "$1" ]; then',
        '    find "$1" -type f 2>/dev/null | wc -l | tr -d \' \'',
        '  else',
        '    echo 1',
        '  fi',
        '}',
        'for d in "$HOME/.hermes/platforms/whatsapp/session" "$HOME/.hermes/platforms/whatsapp"/auth_info* "$HOME/.hermes/platforms/whatsapp"/baileys_auth* "$HOME/.hermes/whatsapp" "$HOME/.hermes/.whatsapp" "$BRIDGE_DIR"/auth_info* "$BRIDGE_DIR"/baileys_auth* "$BRIDGE_DIR"/session*; do',
        '  C="$(count_path "$d")"',
        '  BEFORE=$((BEFORE + C))',
        'done',
        'rm -rf "$HOME/.hermes/platforms/whatsapp/session" "$HOME/.hermes/platforms/whatsapp"/auth_info* "$HOME/.hermes/platforms/whatsapp"/baileys_auth* "$HOME/.hermes/whatsapp" "$HOME/.hermes/.whatsapp" "$BRIDGE_DIR"/auth_info* "$BRIDGE_DIR"/baileys_auth* "$BRIDGE_DIR"/session* 2>/dev/null || true',
        'AFTER=0',
        'for d in "$HOME/.hermes/platforms/whatsapp/session" "$HOME/.hermes/platforms/whatsapp"/auth_info* "$HOME/.hermes/platforms/whatsapp"/baileys_auth* "$HOME/.hermes/whatsapp" "$HOME/.hermes/.whatsapp" "$BRIDGE_DIR"/auth_info* "$BRIDGE_DIR"/baileys_auth* "$BRIDGE_DIR"/session*; do',
        '  C="$(count_path "$d")"',
        '  AFTER=$((AFTER + C))',
        'done',
        'REMOVED=$((BEFORE - AFTER))',
        'echo "SESSION_BEFORE=$BEFORE"',
        'echo "SESSION_REMOVED=$REMOVED"',
        'if [ "$AFTER" -gt 0 ]; then',
        '  echo "[ronbot] Some WhatsApp session/auth files could not be removed" >&2',
        '  exit 1',
        'fi',
        'exit 0',
      ].join('\n'),
      { timeout: 20000 },
    );
    const out = `${r.stdout || ''}\n${r.stderr || ''}`;
    const before = Number((out.match(/SESSION_BEFORE=(\d+)/)?.[1] ?? '0'));
    const removed = Number((out.match(/SESSION_REMOVED=(\d+)/)?.[1] ?? '0'));
    return {
      success: r.success,
      before,
      removed,
      stderr: r.stderr || undefined,
    };
  },

  /**
   * Strip a list of env keys from `~/.hermes/.env` (and from secure storage so
   * `materializeEnv` doesn't put them back). Used by the per-channel "Reset"
   * action so a stale install can be wiped without manual shell commands.
   */
  async removeChannelEnvKeys(keys: string[]): Promise<{ success: boolean; removed: string[]; error?: string }> {
    const safe = (keys || []).filter((k) => /^[A-Z_][A-Z0-9_]*$/.test(k));
    if (safe.length === 0) return { success: true, removed: [] };
    const result = await readHermesFile(HERMES_ENV);
    if (!result.success) {
      return { success: false, removed: [], error: 'Could not read ~/.hermes/.env' };
    }
    const lines = result.content ? result.content.split('\n') : [];
    const keep: string[] = [];
    const removed: string[] = [];
    for (const line of lines) {
      const t = line.trim();
      const matchKey = safe.find((k) => t.startsWith(`${k}=`));
      if (matchKey) {
        if (!removed.includes(matchKey)) removed.push(matchKey);
        continue;
      }
      keep.push(line);
    }
    const write = await writeHermesFile(HERMES_ENV, keep.join('\n'), '600');
    return { success: write.success, removed, error: write.success ? undefined : 'Failed to write ~/.hermes/.env' };
  },

  /**
   * Full WhatsApp channel reset (shared by Channels and the wizard): stop gateway,
   * clear session/auth dirs, strip WhatsApp env keys, delete matching secrets, re-materialize .env.
   */
  async resetWhatsAppChannel(): Promise<{ success: boolean; error?: string }> {
    const keys = [
      'WHATSAPP_ENABLED',
      'WHATSAPP_MODE',
      'WHATSAPP_ALLOWED_USERS',
      'WHATSAPP_ALLOW_ALL_USERS',
      'WHATSAPP_DEBUG',
    ] as const;
    agentLogs.push({ source: 'system', level: 'info', summary: 'Resetting WhatsApp channel…' });
    await this.stopGateway().catch(() => undefined);
    const cleared = await this.clearWhatsAppSession();
    if (!cleared.success) {
      return { success: false, error: cleared.stderr || 'Could not clear WhatsApp session files' };
    }
    const stripped = await this.removeChannelEnvKeys([...keys]);
    if (!stripped.success) {
      return { success: false, error: stripped.error || 'Could not remove env keys' };
    }
    for (const k of keys) {
      await secretsStore.delete(k).catch(() => false);
    }
    await materializeHermesEnv().catch(() => undefined);
    agentLogs.push({ source: 'system', level: 'info', summary: 'WhatsApp reset complete' });
    return { success: true };
  },

  /**
   * Best-effort cleanup for orphaned interactive pairing runs.
   * Covers the legacy `hermes whatsapp` PTY wrapper AND any stale pair-only
   * Node bridge invocations from previous wizard attempts.
   *
   * When `includeGatewayBridge` is true, ALSO kills the long-running
   * gateway-managed `bridge.js` process. This is required when the bridge is
   * stuck in a crash loop (e.g. wrong Node version) and we need to stop the
   * service cleanly before restarting with a corrected runtime.
   */
  async terminateWhatsAppPairingProcesses(
    options?: { includeGatewayBridge?: boolean },
  ): Promise<{ success: boolean; killed: number; output: string }> {
    const includeGw = options?.includeGatewayBridge ? '1' : '0';
    const r = await runHermesShell(
      [
        'set +e',
        `INCLUDE_GW=${includeGw}`,
        'K=0',
        'for pat in "script -q -e -c hermes whatsapp" "script -q -e -f -c hermes whatsapp" "script -q -f /dev/null bash -lc hermes whatsapp" "script -q /dev/null bash -lc hermes whatsapp" "hermes whatsapp" "whatsapp-bridge/bridge.js --pair-only"; do',
        '  if pkill -f "$pat" >/dev/null 2>&1; then K=$((K + 1)); fi',
        'done',
        'if [ "$INCLUDE_GW" = "1" ]; then',
        '  if pkill -f "whatsapp-bridge/bridge.js" >/dev/null 2>&1; then K=$((K + 1)); fi',
        '  # Give children a moment to exit, then SIGKILL any survivors so the',
        '  # service supervisor stops respawning them on the wrong Node binary.',
        '  sleep 1',
        '  pkill -9 -f "whatsapp-bridge/bridge.js" >/dev/null 2>&1 || true',
        'fi',
        'echo "KILLED=$K"',
        'exit 0',
      ].join('\n'),
      { timeout: 12000 },
    );
    const out = `${r.stdout || ''}\n${r.stderr || ''}`;
    const killed = Number((out.match(/KILLED=(\d+)/)?.[1] ?? '0'));
    return { success: r.success, killed, output: out.trim() };
  },

  /**
   * Force the Hermes gateway to spawn the WhatsApp Baileys bridge with the
   * managed Node v20 runtime instead of whatever `node` happens to be first
   * on the service unit's PATH.
   *
   * Why this exists:
   *   Baileys imports `globalThis.crypto.subtle` at module top level. Node
   *   v18.x does NOT expose `globalThis.crypto` to ES modules, so the bridge
   *   crashes with `TypeError: Cannot destructure property 'subtle' of
   *   'globalThis.crypto' as it is undefined.` and the service supervisor
   *   restarts it forever. The fix is to make sure the bridge process always
   *   runs on Node ≥ 20.
   *
   * What this does:
   *   1. Verifies the managed Node runtime exists (installs on demand).
   *   2. Confirms the managed Node is actually v20+ and exposes
   *      `globalThis.crypto.subtle`. Aborts loudly if not.
   *   3. Writes a tiny `~/.hermes/bin/node` shim that execs the managed
   *      `node` so anything that resolves `node` via PATH gets v20.
   *   4. Writes `NODE`, `NODE_BIN`, `HERMES_NODE_BIN`, `WHATSAPP_NODE_BIN`,
   *      and a `PATH=$HOME/.hermes/bin:$PATH` entry into ~/.hermes/.env so
   *      the gateway service env (loaded from .env) picks up v20 regardless
   *      of where it's started from.
   *
   * Returns `{ success, version }` where `version` is the managed Node
   * version actually installed (e.g. "v20.19.2"). On failure, `error`
   * carries an actionable message for the wizard.
   */
  async ensureWhatsAppManagedNode(): Promise<{
    success: boolean;
    version?: string;
    shimPath?: string;
    error?: string;
  }> {
    if (!isElectron()) {
      return { success: true, version: HERMES_NODE_VERSION, shimPath: '~/.hermes/bin/node' };
    }
    const r = await runHermesShell(
      [
        'set +e',
        getHermesNodeEnvExport(),
        '[ -x "$NODE_RUNTIME_HOME/bin/node" ] || { echo "[ronbot] Managed Node runtime missing at $NODE_RUNTIME_HOME/bin/node" >&2; echo "MANAGED_NODE_MISSING"; exit 2; }',
        'NODE_BIN="$NODE_RUNTIME_HOME/bin/node"',
        'NODE_VER="$("$NODE_BIN" --version 2>/dev/null || echo unknown)"',
        'echo "MANAGED_NODE_VERSION=$NODE_VER"',
        // Verify globalThis.crypto.subtle actually exists in the managed Node.
        '"$NODE_BIN" -e "process.exit(globalThis.crypto && globalThis.crypto.subtle ? 0 : 42)" 2>/dev/null',
        'PROBE_RC=$?',
        'if [ "$PROBE_RC" -ne 0 ]; then',
        '  echo "[ronbot] Managed Node $NODE_VER does not expose globalThis.crypto.subtle (probe rc=$PROBE_RC)" >&2',
        '  echo "MANAGED_NODE_PROBE_FAILED"',
        '  exit 3',
        'fi',
        // Write the shim. CRITICAL: we use printf (not heredoc) so the
        // literal "$@" survives. Previously an unquoted heredoc expanded
        // "$@" at write time to an empty string, producing a shim that
        // dropped every CLI argument — Baileys then crashed because the
        // bridge script path was never passed to node.
        'mkdir -p "$HOME/.hermes/bin"',
        'SHIM="$HOME/.hermes/bin/node"',
        'NPM_SHIM="$HOME/.hermes/bin/npm"',
        'NPX_SHIM="$HOME/.hermes/bin/npx"',
        'NPM_BIN_REAL="$NODE_RUNTIME_HOME/bin/npm"',
        'NPX_BIN_REAL="$NODE_RUNTIME_HOME/bin/npx"',
        // Write node shim with literal "$@" preserved (printf %s + single-quoted body).
        'printf %s \'#!/usr/bin/env bash\n# Auto-generated by Ronbot (RONBOT_NODE_SHIM_V2).\n# Forces the WhatsApp bridge and any Hermes child onto managed Node v20\n# so Baileys can load globalThis.crypto.subtle.\nexec "\'"$NODE_BIN"\'" "$@"\n\' > "$SHIM"',
        // npm/npx shims so child processes (postinstall scripts, etc.) all resolve to the managed runtime.
        '[ -x "$NPM_BIN_REAL" ] && printf %s \'#!/usr/bin/env bash\nexec "\'"$NPM_BIN_REAL"\'" "$@"\n\' > "$NPM_SHIM" && chmod 755 "$NPM_SHIM"',
        '[ -x "$NPX_BIN_REAL" ] && printf %s \'#!/usr/bin/env bash\nexec "\'"$NPX_BIN_REAL"\'" "$@"\n\' > "$NPX_SHIM" && chmod 755 "$NPX_SHIM"',
        'chmod 755 "$SHIM"',
        // Sanity-check that the written shim actually contains a literal "$@".
        'grep -q \'"$@"\' "$SHIM" || { echo "[ronbot] shim is missing literal \\"\\$@\\" — write failed" >&2; echo "SHIM_BODY_BAD"; exit 5; }',
        'echo "SHIM_PATH=$SHIM"',
        // Sanity-check the shim runs and reports v20+. We pass an actual
        // argument so a regression in "$@" handling shows up immediately.
        'SHIM_VER="$("$SHIM" --version 2>/dev/null || echo unknown)"',
        'echo "SHIM_VERSION=$SHIM_VER"',
        'case "$SHIM_VER" in',
        '  v2[0-9].*|v[3-9][0-9].*) ;;',
        '  *) echo "[ronbot] Node shim reports unexpected version: $SHIM_VER" >&2; echo "SHIM_VERSION_BAD"; exit 4 ;;',
        'esac',
        // Crypto probe through the shim itself, mirroring how the gateway invokes node.
        '"$SHIM" -e "process.exit(globalThis.crypto && globalThis.crypto.subtle ? 0 : 42)" 2>/dev/null || { echo "[ronbot] Shim Node $SHIM_VER does not expose globalThis.crypto.subtle" >&2; echo "SHIM_PROBE_FAILED"; exit 6; }',
        'exit 0',
      ].join('\n'),
      { timeout: 20000 },
    );
    const out = `${r.stdout || ''}\n${r.stderr || ''}`;
    const version = (out.match(/MANAGED_NODE_VERSION=(v\S+)/)?.[1] || '').trim() || undefined;
    const shimPath = (out.match(/SHIM_PATH=(\S+)/)?.[1] || '').trim() || undefined;
    if (!r.success) {
      let error = 'Could not prepare the managed Node runtime for the WhatsApp bridge.';
      if (out.includes('MANAGED_NODE_MISSING')) {
        error = 'The managed Node v20 runtime is not installed. Run the WhatsApp setup wizard from the start so Ronbot can install it.';
      } else if (out.includes('MANAGED_NODE_PROBE_FAILED')) {
        error = `Managed Node ${version ?? ''} does not expose globalThis.crypto.subtle. Reinstall the managed runtime and try again.`;
      } else if (out.includes('SHIM_BODY_BAD')) {
        error = 'Wrote ~/.hermes/bin/node but the file is missing the literal "$@" — the shim would drop arguments. Check filesystem permissions.';
      } else if (out.includes('SHIM_PROBE_FAILED')) {
        error = `~/.hermes/bin/node runs but does not expose globalThis.crypto.subtle. Reinstall the managed runtime.`;
      } else if (out.includes('SHIM_VERSION_BAD')) {
        error = 'Created a Node shim but it reports the wrong version. Check ~/.hermes/bin/node permissions.';
      } else if (r.stderr) {
        error = r.stderr.split('\n').find((l) => l.trim().length > 0) || error;
      }
      return { success: false, version, shimPath, error };
    }
    // Persist env overrides so the gateway service picks the right binary
    // when it sources ~/.hermes/.env. We write each key individually so we
    // don't disturb the rest of the file.
    const homeEnv = '$HOME/.hermes/bin/node';
    await this.setEnvVar('NODE', homeEnv).catch(() => undefined);
    await this.setEnvVar('NODE_BIN', homeEnv).catch(() => undefined);
    await this.setEnvVar('HERMES_NODE_BIN', homeEnv).catch(() => undefined);
    await this.setEnvVar('WHATSAPP_NODE_BIN', homeEnv).catch(() => undefined);
    // PATH must include ~/.hermes/bin BEFORE the system PATH. We write a
    // literal $PATH so bash expands it at source-time inside the gateway.
    await this.setEnvVar('PATH', '$HOME/.hermes/bin:$PATH').catch(() => undefined);
    agentLogs.push({
      source: 'system',
      level: 'info',
      summary: `ensureWhatsAppManagedNode: Node shim ready (${version ?? 'unknown'})`,
      detail: `Wrote ${shimPath ?? '~/.hermes/bin/node'} and added NODE/HERMES_NODE_BIN/WHATSAPP_NODE_BIN + PATH overrides to ~/.hermes/.env so the gateway spawns the WhatsApp bridge on Node v20.`,
    });
    // Best-effort follow-up: patch the gateway service unit/plist so its
    // captured PATH starts with ~/.hermes/bin, AND patch the installed
    // WhatsApp adapter so the bridge subprocess uses the managed Node even
    // if the service PATH is rewritten later. These do not block success
    // because the env overrides + shim alone may already be enough on some
    // setups; we still want to report any patch failures in the log.
    const svc = await this.patchGatewayServicePathForWhatsApp().catch((e) => ({
      success: false,
      patched: [] as string[],
      error: e instanceof Error ? e.message : String(e),
    }));
    const adapter = await this.patchHermesWhatsAppAdapterForNode().catch((e) => ({
      success: false,
      patched: false,
      error: e instanceof Error ? e.message : String(e),
    }));
    agentLogs.push({
      source: 'system',
      level: svc.success && adapter.success ? 'info' : 'warn',
      summary: `ensureWhatsAppManagedNode: service patched=${svc.patched.length} adapter patched=${adapter.patched}`,
      detail: [svc.error ? `service: ${svc.error}` : '', adapter.error ? `adapter: ${adapter.error}` : '']
        .filter(Boolean)
        .join('\n') || undefined,
    });
    return { success: true, version, shimPath };
  },

  /**
   * Patch every installed Hermes gateway service unit / launchd plist so
   * its captured PATH starts with `$HOME/.hermes/bin`. Without this, the
   * service supervisor spawns the WhatsApp bridge with system Node 18 and
   * Baileys crashes on `globalThis.crypto.subtle`.
   *
   * Also runs `systemctl --user daemon-reload` (or launchctl bootout +
   * bootstrap) so the patched definition is applied without a full reboot.
   *
   * Idempotent: running it twice is a no-op when the shim path is already
   * first in PATH.
   */
  async patchGatewayServicePathForWhatsApp(): Promise<{
    success: boolean;
    patched: string[];
    skipped: string[];
    error?: string;
  }> {
    if (!isElectron()) return { success: true, patched: [], skipped: [] };
    const r = await runHermesShell(
      [
        'set +e',
        'SHIM_DIR="$HOME/.hermes/bin"',
        '[ -x "$SHIM_DIR/node" ] || { echo "MISSING_SHIM"; exit 1; }',
        'PATCHED=""',
        'SKIPPED=""',
        // ── systemd user units: install a drop-in FIRST so the PATH override
        // survives `hermes gateway install` rewriting the base unit. The
        // drop-in is what makes the fix permanent; the in-place unit edit
        // below is a belt-and-braces fallback for older systemd.
        'if command -v systemctl >/dev/null 2>&1; then',
        '  for svc in hermes-gateway.service hermes-gateway-whatsapp.service hermes-gateway@.service; do',
        '    DROPIN_DIR="$HOME/.config/systemd/user/${svc}.d"',
        '    mkdir -p "$DROPIN_DIR"',
        '    DROPIN="$DROPIN_DIR/10-ronbot-whatsapp-node.conf"',
        '    cat > "$DROPIN" <<DROP_EOF',
        '[Service]',
        'Environment="PATH=%h/.hermes/bin:%h/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"',
        'Environment="WHATSAPP_NODE_BIN=%h/.hermes/bin/node"',
        'Environment="NODE_BIN=%h/.hermes/bin/node"',
        'Environment="HERMES_NODE_BIN=%h/.hermes/bin/node"',
        'Environment="NODE=%h/.hermes/bin/node"',
        'DROP_EOF',
        '    PATCHED="$PATCHED $DROPIN"',
        '  done',
        '  systemctl --user daemon-reload >/dev/null 2>&1 || true',
        'fi',
        // ── In-place unit edit (legacy fallback) ──
        'for u in "$HOME/.config/systemd/user"/hermes-gateway*.service; do',
        '  [ -f "$u" ] || continue',
        '  if grep -qE "Environment=\\\"PATH=" "$u"; then',
        '    if grep -qE "Environment=\\\"PATH=$HOME/.hermes/bin:" "$u" || grep -qF "Environment=\\\"PATH=$SHIM_DIR" "$u"; then',
        '      SKIPPED="$SKIPPED $u"; continue',
        '    fi',
        '    cp "$u" "$u.ronbot.bak.$(date +%s)" 2>/dev/null || true',
        '    # Insert the shim dir at the front of the existing PATH value',
        '    awk -v shim="$SHIM_DIR" \'{',
        '      if ($0 ~ /^Environment="PATH=/) {',
        '        sub(/^Environment="PATH=/, "Environment=\\"PATH=" shim ":")',
        '      }',
        '      print',
        '    }\' "$u" > "$u.tmp" && mv "$u.tmp" "$u"',
        '    PATCHED="$PATCHED $u"',
        '  else',
        '    cp "$u" "$u.ronbot.bak.$(date +%s)" 2>/dev/null || true',
        '    awk -v shim="$SHIM_DIR" \'',
        '      /^\\[Service\\]/ { print; print "Environment=\\"PATH=" shim ":/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\""; next }',
        '      { print }\' "$u" > "$u.tmp" && mv "$u.tmp" "$u"',
        '    PATCHED="$PATCHED $u"',
        '  fi',
        'done',
        // Reload user systemd if we touched a unit
        'if [ -n "$PATCHED" ] && command -v systemctl >/dev/null 2>&1; then',
        '  systemctl --user daemon-reload >/dev/null 2>&1 || true',
        'fi',
        // ── launchd (macOS) ──
        'for p in "$HOME/Library/LaunchAgents"/*hermes*gateway*.plist; do',
        '  [ -f "$p" ] || continue',
        '  if grep -qF "$SHIM_DIR:" "$p"; then SKIPPED="$SKIPPED $p"; continue; fi',
        '  cp "$p" "$p.ronbot.bak.$(date +%s)" 2>/dev/null || true',
        '  # Find the <key>PATH</key> followed by <string>...</string> and prepend shim',
        '  python3 - "$p" "$SHIM_DIR" <<\'PY\' || true',
        'import sys, re, pathlib',
        'p = pathlib.Path(sys.argv[1])',
        'shim = sys.argv[2]',
        'text = p.read_text()',
        'def repl(m):',
        '    val = m.group(2)',
        '    if val.startswith(shim + ":"):',
        '        return m.group(0)',
        '    return f"{m.group(1)}{shim}:{val}{m.group(3)}"',
        'new = re.sub(r"(<key>PATH</key>\\s*<string>)([^<]*)(</string>)", repl, text, count=1)',
        'if new != text:',
        '    p.write_text(new)',
        'PY',
        '  PATCHED="$PATCHED $p"',
        'done',
        'echo "PATCHED=$PATCHED"',
        'echo "SKIPPED=$SKIPPED"',
        'exit 0',
      ].join('\n'),
      { timeout: 20000 },
    );
    const out = `${r.stdout || ''}\n${r.stderr || ''}`;
    if (out.includes('MISSING_SHIM')) {
      return { success: false, patched: [], skipped: [], error: 'Managed Node shim not installed yet — run ensureWhatsAppManagedNode first.' };
    }
    const patched = (out.match(/PATCHED=(.*)/)?.[1] || '').trim().split(/\s+/).filter(Boolean);
    const skipped = (out.match(/SKIPPED=(.*)/)?.[1] || '').trim().split(/\s+/).filter(Boolean);
    return { success: r.success, patched, skipped };
  },

  /**
   * Patch the installed Hermes WhatsApp adapter so the bridge subprocess
   * uses the managed Node binary directly, regardless of the service
   * unit's effective PATH. Upstream Hermes hardcodes `["node", ...]`,
   * which means a bare `node` is resolved against the service PATH —
   * usually system Node 18 on Debian/Ubuntu — and Baileys crashes.
   *
   * The patch is minimal and idempotent: it inserts a small helper that
   * prefers `WHATSAPP_NODE_BIN` / `NODE_BIN` / `~/.hermes/bin/node`
   * before falling back to whatever `node` is on PATH. A `.ronbot.bak`
   * is created the first time the file is rewritten.
   */
  async patchHermesWhatsAppAdapterForNode(): Promise<{
    success: boolean;
    patched: boolean;
    path?: string;
    error?: string;
  }> {
    if (!isElectron()) return { success: true, patched: false };
    const r = await runHermesShell(
      [
        'set +e',
        'F=""',
        'for cand in "$HOME/.hermes/hermes-agent/gateway/platforms/whatsapp.py" "$HOME/.hermes/venv/lib"/python*/site-packages/gateway/platforms/whatsapp.py; do',
        '  [ -f "$cand" ] || continue',
        '  F="$cand"; break',
        'done',
        '[ -n "$F" ] || { echo "ADAPTER_NOT_FOUND"; exit 0; }',
        'echo "ADAPTER_PATH=$F"',
        'if grep -q "RONBOT_NODE_BIN_PATCH" "$F"; then echo "ALREADY_PATCHED"; exit 0; fi',
        'cp "$F" "$F.ronbot.bak" 2>/dev/null || true',
        'python3 - "$F" <<\'PY\' || { echo "PATCH_FAILED"; exit 1; }',
        'import sys, re, pathlib',
        'p = pathlib.Path(sys.argv[1])',
        'src = p.read_text()',
        'helper = (',
        '"\\n# RONBOT_NODE_BIN_PATCH: prefer managed Node so Baileys gets globalThis.crypto.subtle\\n"',
        '"def _ronbot_node_bin():\\n"',
        '"    import os, shutil\\n"',
        '"    for env_key in (\\"WHATSAPP_NODE_BIN\\", \\"NODE_BIN\\", \\"HERMES_NODE_BIN\\", \\"NODE\\"):\\n"',
        '"        v = os.environ.get(env_key)\\n"',
        '"        if v and os.path.isfile(v):\\n"',
        '"            return v\\n"',
        '"    home = os.path.expanduser(\\"~\\")\\n"',
        '"    shim = os.path.join(home, \\".hermes\\", \\"bin\\", \\"node\\")\\n"',
        '"    if os.path.isfile(shim):\\n"',
        '"        return shim\\n"',
        '"    found = shutil.which(\\"node\\")\\n"',
        '"    return found or \\"node\\"\\n"',
        ')',
        '# Insert the helper after the first import block / module docstring.',
        'm = re.search(r"(?ms)^(\\s*\\"\\"\\".*?\\"\\"\\"\\s*\\n)", src)',
        'insert_at = m.end() if m else 0',
        'src = src[:insert_at] + helper + src[insert_at:]',
        '# Replace [\\"node\\", ...bridge_path...] with [_ronbot_node_bin(), ...]',
        'src2, n = re.subn(r"\\[\\s*\\\"node\\\"\\s*,", "[_ronbot_node_bin(),", src)',
        'if n == 0:',
        '    sys.stderr.write("no node literal found\\n")',
        '    sys.exit(2)',
        'p.write_text(src2)',
        'PY',
        'PATCH_RC=$?',
        'if [ "$PATCH_RC" -eq 0 ]; then echo "PATCHED_OK"; else echo "PATCH_FAILED"; fi',
        'exit 0',
      ].join('\n'),
      { timeout: 15000 },
    );
    const out = `${r.stdout || ''}\n${r.stderr || ''}`;
    const path = (out.match(/ADAPTER_PATH=(\S+)/)?.[1] || '').trim() || undefined;
    if (out.includes('ADAPTER_NOT_FOUND')) {
      return { success: true, patched: false, error: 'Installed Hermes WhatsApp adapter not found at the expected paths.' };
    }
    if (out.includes('ALREADY_PATCHED')) return { success: true, patched: true, path };
    if (out.includes('PATCHED_OK')) return { success: true, patched: true, path };
    return { success: false, patched: false, path, error: out.split('\n').slice(-6).join('\n').trim() };
  },

  /**
   * Diagnostic snapshot used by the wizard before declaring failure: which
   * `node` the gateway service is actually about to spawn, what version it
   * reports, whether the shim + patches are in place, and whether the
   * recent bridge log already shows Node 18 crashes.
   */
  async getWhatsAppRuntimeDiagnostic(): Promise<{
    success: boolean;
    shimVersion?: string;
    serviceUnitPath?: string;
    serviceUnitPathStartsWithShim: boolean;
    adapterPatched: boolean;
    adapterPath?: string;
    bridgeLogShowsNode18: boolean;
    rawSummary: string;
  }> {
    if (!isElectron()) {
      return {
        success: true,
        shimVersion: HERMES_NODE_VERSION,
        serviceUnitPathStartsWithShim: true,
        adapterPatched: true,
        bridgeLogShowsNode18: false,
        rawSummary: '[preview] runtime diagnostic',
      };
    }
    const r = await runHermesShell(
      [
        'set +e',
        'SHIM_VER="$($HOME/.hermes/bin/node --version 2>/dev/null || echo missing)"',
        'echo "SHIM_VER=$SHIM_VER"',
        'UNIT=""',
        'for u in "$HOME/.config/systemd/user"/hermes-gateway*.service; do [ -f "$u" ] && { UNIT="$u"; break; }; done',
        'echo "UNIT=$UNIT"',
        'STARTS=0',
        'if [ -n "$UNIT" ] && grep -qE "Environment=\\\"PATH=$HOME/.hermes/bin:" "$UNIT"; then STARTS=1; fi',
        'echo "UNIT_STARTS_WITH_SHIM=$STARTS"',
        'ADAPT=""',
        'for cand in "$HOME/.hermes/hermes-agent/gateway/platforms/whatsapp.py" "$HOME/.hermes/venv/lib"/python*/site-packages/gateway/platforms/whatsapp.py; do',
        '  [ -f "$cand" ] && { ADAPT="$cand"; break; }',
        'done',
        'echo "ADAPTER=$ADAPT"',
        'AP=0',
        'if [ -n "$ADAPT" ] && grep -q "RONBOT_NODE_BIN_PATCH" "$ADAPT"; then AP=1; fi',
        'echo "ADAPTER_PATCHED=$AP"',
        'NODE18=0',
        'for f in "$HOME/.hermes/platforms/whatsapp/bridge.log" "$HOME/.hermes/logs/whatsapp-bridge.log" "$HOME/.hermes/hermes-agent/scripts/whatsapp-bridge/bridge.log"; do',
        '  [ -f "$f" ] || continue',
        '  if tail -n 60 "$f" 2>/dev/null | grep -qE "Node\\.js v18\\."; then NODE18=1; break; fi',
        'done',
        'echo "NODE18=$NODE18"',
        'exit 0',
      ].join('\n'),
      { timeout: 10000 },
    );
    const out = r.stdout || '';
    const get = (re: RegExp) => out.match(re)?.[1]?.trim() || '';
    return {
      success: r.success,
      shimVersion: get(/SHIM_VER=(\S+)/) || undefined,
      serviceUnitPath: get(/UNIT=(\S+)/) || undefined,
      serviceUnitPathStartsWithShim: get(/UNIT_STARTS_WITH_SHIM=(\d)/) === '1',
      adapterPatched: get(/ADAPTER_PATCHED=(\d)/) === '1',
      adapterPath: get(/ADAPTER=(\S+)/) || undefined,
      bridgeLogShowsNode18: get(/NODE18=(\d)/) === '1',
      rawSummary: out.trim(),
    };
  },

  /**
   * Quick read of the most recent WhatsApp bridge crash signature, if any.
   * Used by the wizard to map a "gateway didn't come up" failure to an
   * actionable explanation instead of a wall of stack traces.
   */
  async classifyWhatsAppBridgeFailure(): Promise<{
    kind: 'node-version' | 'unknown' | 'none';
    nodeVersion?: string;
    snippet?: string;
  }> {
    if (!isElectron()) return { kind: 'none' };
    const r = await runHermesShell(
      [
        'set +e',
        'WA_FILES="$HOME/.hermes/platforms/whatsapp/bridge.log $HOME/.hermes/logs/whatsapp-bridge.log $HOME/.hermes/hermes-agent/scripts/whatsapp-bridge/bridge.log /tmp/hermes-gateway.log"',
        'TAIL=""',
        'for f in $WA_FILES; do',
        '  [ -f "$f" ] || continue',
        '  TAIL="$TAIL$(tail -n 80 "$f" 2>/dev/null)"',
        '  TAIL="$TAIL\n"',
        'done',
        'echo "----TAIL----"',
        'printf "%s" "$TAIL"',
        'exit 0',
      ].join('\n'),
      { timeout: 8000 },
    );
    const tail = (r.stdout || '').split('----TAIL----').pop()?.trim() ?? '';
    if (!tail) return { kind: 'none' };
    if (
      tail.includes("Cannot destructure property 'subtle'") ||
      tail.includes('globalThis.crypto.subtle') ||
      /baileys\/lib\/Utils\/crypto\.js/.test(tail)
    ) {
      const verMatch = tail.match(/Node\.js\s+(v\d+[\d.]*)/);
      const lines = tail.split('\n').filter((l) => l.trim().length > 0);
      const snippet = lines.slice(-12).join('\n');
      return { kind: 'node-version', nodeVersion: verMatch?.[1], snippet };
    }
    return { kind: 'unknown', snippet: tail.split('\n').slice(-12).join('\n') };
  },

  /**
   * Rotate stale WhatsApp bridge / gateway logs so the failure classifier
   * doesn't read pre-fix Node 18 stack traces and report them as a current
   * failure. Renames *.log → *.log.prev (overwriting any existing .prev).
   */
  async rotateWhatsAppBridgeLogs(): Promise<{ success: boolean; rotated: string[] }> {
    if (!isElectron()) return { success: true, rotated: [] };
    const r = await runHermesShell(
      [
        'set +e',
        'ROTATED=""',
        'for f in \\',
        '  "$HOME/.hermes/platforms/whatsapp/bridge.log" \\',
        '  "$HOME/.hermes/logs/whatsapp-bridge.log" \\',
        '  "$HOME/.hermes/logs/gateway.log" \\',
        '  "$HOME/.hermes/hermes-agent/scripts/whatsapp-bridge/bridge.log"; do',
        '  [ -f "$f" ] || continue',
        '  mv -f "$f" "$f.prev" 2>/dev/null && ROTATED="$ROTATED $f" || true',
        'done',
        'echo "ROTATED=$ROTATED"',
        'exit 0',
      ].join('\n'),
      { timeout: 5000 },
    );
    const rotated = ((r.stdout || '').match(/ROTATED=(.*)/)?.[1] || '').trim().split(/\s+/).filter(Boolean);
    return { success: true, rotated };
  },

  /**
   * Verify that the running gateway process is actually using the managed
   * Node v20 by inspecting its captured environment block (Linux: /proc).
   * Returns whether the live PATH starts with ~/.hermes/bin.
   */
  async verifyGatewayUsesManagedNode(): Promise<{
    success: boolean;
    pid?: number;
    pathStartsWithShim: boolean;
    rawPath?: string;
    error?: string;
  }> {
    if (!isElectron()) return { success: true, pathStartsWithShim: true };
    const r = await runHermesShell(
      [
        'set +e',
        'PID=""',
        'if command -v systemctl >/dev/null 2>&1; then',
        '  PID="$(systemctl --user show -p MainPID --value hermes-gateway.service 2>/dev/null)"',
        '  [ "$PID" = "0" ] && PID=""',
        'fi',
        'if [ -z "$PID" ] && command -v pgrep >/dev/null 2>&1; then',
        '  PID="$(pgrep -f \'hermes.*gateway\' 2>/dev/null | head -n 1)"',
        'fi',
        '[ -n "$PID" ] || { echo "NO_PID"; exit 0; }',
        'echo "PID=$PID"',
        'if [ -r "/proc/$PID/environ" ]; then',
        '  ENVPATH="$(tr "\\0" "\\n" < /proc/$PID/environ | awk -F= "/^PATH=/{ sub(/^PATH=/,\\\"\\\"); print; exit }")"',
        '  echo "PATH_RAW=$ENVPATH"',
        'fi',
        'exit 0',
      ].join('\n'),
      { timeout: 6000 },
    );
    const out = r.stdout || '';
    if (out.includes('NO_PID')) {
      return { success: false, pathStartsWithShim: false, error: 'Gateway process not found.' };
    }
    const pidStr = out.match(/PID=(\d+)/)?.[1];
    const rawPath = out.match(/PATH_RAW=(.*)/)?.[1]?.trim();
    const pid = pidStr ? Number(pidStr) : undefined;
    if (!rawPath) {
      // /proc not readable (macOS or hardened systemd) — can't verify, treat as inconclusive success.
      return { success: true, pid, pathStartsWithShim: true, rawPath: undefined };
    }
    const home = process.env?.HOME || '';
    const shimPrefix = `${home}/.hermes/bin`;
    const startsWith = rawPath.startsWith(shimPrefix) || rawPath.startsWith('~/.hermes/bin');
    return { success: true, pid, pathStartsWithShim: startsWith, rawPath };
  },

  /**
   * Atomic, idempotent end-to-end repair for the WhatsApp bridge runtime.
   * Wraps every individual fix into a single call the wizard can invoke
   * from a "Repair runtime + restart gateway" button. Returns a structured
   * step list so the UI can render progress.
   */
  async repairWhatsAppGatewayRuntime(
    onOutput?: CommandOutputHandler,
  ): Promise<{
    ok: boolean;
    steps: Array<{ name: string; ok: boolean; detail?: string }>;
    diagnostics?: Awaited<ReturnType<typeof hermesAPI.getWhatsAppRuntimeDiagnostic>>;
  }> {
    const steps: Array<{ name: string; ok: boolean; detail?: string }> = [];
    const log = (line: string) => onOutput?.({ type: 'stdout', data: `[ronbot-repair] ${line}\n` });
    // 1. Ensure managed Node runtime tarball is installed.
    log('ensuring managed Node v20 runtime…');
    const runtime = await this.ensureHermesNodeRuntime(onOutput).catch((e) => ({
      success: false,
      stderr: e instanceof Error ? e.message : String(e),
      stdout: '',
      code: 1,
    } as CommandResult));
    steps.push({ name: 'managed-node-runtime', ok: runtime.success, detail: runtime.success ? undefined : (runtime.stderr || runtime.stdout || '').split('\n').slice(-3).join('\n') });
    if (!runtime.success) return { ok: false, steps };
    // 2. Write/refresh the shim and patch service + adapter.
    log('writing ~/.hermes/bin shims and patching gateway service + adapter…');
    const shim = await this.ensureWhatsAppManagedNode().catch((e) => ({ success: false, error: e instanceof Error ? e.message : String(e) }));
    steps.push({ name: 'managed-node-shim', ok: shim.success, detail: shim.success ? `version ${(shim as { version?: string }).version || 'unknown'}` : (shim as { error?: string }).error });
    if (!shim.success) return { ok: false, steps };
    // 3. Rotate stale logs so the next failure-classification reads fresh data.
    log('rotating stale bridge logs…');
    const rot = await this.rotateWhatsAppBridgeLogs().catch(() => ({ success: false, rotated: [] as string[] }));
    steps.push({ name: 'rotate-logs', ok: rot.success, detail: rot.rotated.length ? `rotated ${rot.rotated.length} file(s)` : 'no logs to rotate' });
    // 4. Kill any crash-looping bridge process before restart.
    log('terminating any crash-looping bridge processes…');
    await this.terminateWhatsAppPairingProcesses({ includeGatewayBridge: true }).catch(() => undefined);
    // 5. Materialize env + refresh gateway install (best-effort).
    await materializeHermesEnv().catch(() => undefined);
    const refresh = await this.refreshGatewayInstall().catch((e) => ({ success: false, stderr: e instanceof Error ? e.message : String(e), stdout: '', code: 1 } as CommandResult));
    steps.push({ name: 'refresh-gateway-install', ok: refresh.success, detail: refresh.success ? undefined : (refresh.stderr || refresh.stdout || '').split('\n')[0] });
    // 6. Re-apply patches AFTER refreshGatewayInstall (it may rewrite the unit).
    await this.patchGatewayServicePathForWhatsApp().catch(() => undefined);
    await this.patchHermesWhatsAppAdapterForNode().catch(() => undefined);
    // 7. Restart gateway.
    log('restarting gateway…');
    await this.stopGateway().catch(() => undefined);
    const start = await this.startGateway().catch((e) => ({ success: false, stderr: e instanceof Error ? e.message : String(e), stdout: '', code: 1 } as CommandResult));
    steps.push({ name: 'restart-gateway', ok: start.success, detail: start.success ? undefined : (start.stderr || start.stdout || '').split('\n')[0] });
    if (!start.success) return { ok: false, steps };
    // 8. Verify the running PID actually has ~/.hermes/bin in PATH.
    log('verifying gateway PID environment…');
    let verify = { success: false, pathStartsWithShim: false } as Awaited<ReturnType<typeof hermesAPI.verifyGatewayUsesManagedNode>>;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      verify = await this.verifyGatewayUsesManagedNode().catch(() => verify);
      if (verify.success && verify.pathStartsWithShim) break;
      await new Promise((res) => setTimeout(res, 1500));
    }
    steps.push({
      name: 'verify-gateway-path',
      ok: verify.pathStartsWithShim,
      detail: verify.rawPath ? `PATH=${verify.rawPath.split(':').slice(0, 3).join(':')}…` : (verify.error || 'unable to read /proc — assuming OK'),
    });
    const diagnostics = await this.getWhatsAppRuntimeDiagnostic().catch(() => undefined);
    const ok = steps.every((s) => s.ok || s.name === 'verify-gateway-path' && !verify.error);
    return { ok, steps, diagnostics };
  },

  /**
   * Run WhatsApp pairing in the official Baileys bridge `--pair-only` mode.
   *
   * Why bridge.js --pair-only instead of `hermes whatsapp`:
   *  - It prints the QR straight to stdout (qrcode-terminal), so the renderer
   *    sees the QR within seconds without a PTY/script dance.
   *  - It writes credentials to the canonical `~/.hermes/platforms/whatsapp/session`
   *    directory the gateway-managed bridge will reuse — no path mismatch.
   *  - It exits cleanly after pairing succeeds, so the wizard doesn't have
   *    to babysit an interactive prompt forest.
   *
   * Falls back to `hermes whatsapp` only when bridge.js is unavailable.
   * Uses `timeout: 0` so the child is not killed while the user scans.
   */
  async runWhatsAppPairing(
    onOutput?: CommandOutputHandler,
    options?: Record<string, unknown> & { onStreamId?: (id: string) => void },
  ): Promise<CommandResult> {
    await materializeHermesEnv().catch(() => undefined);
    if (!isElectron()) {
      onOutput?.({
        type: 'stdout',
        data:
          '[preview] WhatsApp QR pairing runs in the Ronbot desktop app after Hermes is installed.\n',
      });
      onOutput?.({ type: 'exit', code: 0 });
      return {
        success: true,
        stdout: '[preview] WhatsApp pairing is only available in the desktop app.\n',
        stderr: '',
        code: 0,
      };
    }
    const streamOpts = { ...(options ?? {}), timeout: 0 };
    return runHermesShell(
      [
        'set +e',
        HERMES_PATH_EXPORT,
        getHermesNodeEnvExport(),
        // Surface QR cleanly without ANSI/TTY weirdness.
        'export TERM="xterm-256color"',
        'export FORCE_COLOR=1',
        'export COLUMNS=120 LINES=40',
        // Make sure WHATSAPP_MODE/ALLOWED_USERS/DEBUG from .env are visible
        // to the bridge subprocess so QR + access control match what the
        // user picked in the wizard.
        'if [ -f "$HOME/.hermes/.env" ]; then',
        '  set -a',
        '  # shellcheck disable=SC1091',
        '  . "$HOME/.hermes/.env"',
        '  set +a',
        'fi',
        ': "${WHATSAPP_MODE:=self-chat}"',
        'export WHATSAPP_MODE',
        'export WHATSAPP_DEBUG="${WHATSAPP_DEBUG:-true}"',
        // Sweep stale pair attempts. We deliberately do NOT kill a healthy
        // gateway-managed bridge (it runs without --pair-only).
        'pkill -f "script -q -e -c hermes whatsapp" >/dev/null 2>&1 || true',
        'pkill -f "script -q /dev/null bash -lc hermes whatsapp" >/dev/null 2>&1 || true',
        'pkill -f "hermes whatsapp" >/dev/null 2>&1 || true',
        'pkill -f "whatsapp-bridge/bridge.js --pair-only" >/dev/null 2>&1 || true',
        // Canonical session directory used by the gateway adapter.
        'SESSION_DIR="$HOME/.hermes/platforms/whatsapp/session"',
        'mkdir -p "$SESSION_DIR"',
        'BRIDGE_DIR="$HOME/.hermes/hermes-agent/scripts/whatsapp-bridge"',
        'BRIDGE_JS="$BRIDGE_DIR/bridge.js"',
        'NODE_BIN="$NODE_RUNTIME_HOME/bin/node"',
        '[ -x "$NODE_BIN" ] || NODE_BIN="$(command -v node 2>/dev/null || true)"',
        'if [ -f "$BRIDGE_JS" ] && [ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ]; then',
        '  echo "[ronbot] Starting Hermes WhatsApp bridge in pair-only mode"',
        '  echo "[ronbot] Session: $SESSION_DIR"',
        '  echo "[ronbot] Mode:    $WHATSAPP_MODE"',
        '  cd "$BRIDGE_DIR" || exit 1',
        '  "$NODE_BIN" "$BRIDGE_JS" --pair-only --session "$SESSION_DIR" --mode "$WHATSAPP_MODE" 2>&1',
        '  PAIR_RC=$?',
        '  # Mirror credentials into the canonical path if the bridge wrote them',
        '  # to the legacy ~/.hermes/whatsapp/session directory for any reason.',
        '  if [ ! -f "$SESSION_DIR/creds.json" ] && [ -f "$HOME/.hermes/whatsapp/session/creds.json" ]; then',
        '    echo "[ronbot] Mirroring legacy session into canonical path"',
        '    mkdir -p "$SESSION_DIR"',
        '    cp -R "$HOME/.hermes/whatsapp/session/." "$SESSION_DIR/" 2>/dev/null || true',
        '  fi',
        '  exit ${PAIR_RC:-0}',
        'fi',
        // Fallback path: legacy `hermes whatsapp` flow (requires PTY).
        'echo "[ronbot] bridge.js not found — falling back to legacy hermes whatsapp flow" >&2',
        'command -v hermes >/dev/null 2>&1 || { echo "[hermes] FATAL: hermes CLI not found on PATH" >&2; exit 127; }',
        'if command -v script >/dev/null 2>&1; then',
        '  if script --version 2>&1 | grep -qF util-linux; then',
        "    script -q -e -f -c 'hermes whatsapp' /dev/null",
        '  else',
        "    script -q -f /dev/null bash -lc 'hermes whatsapp'",
        '  fi',
        '  PAIR_RC=$?',
        'else',
        '  echo "[ronbot] script(1) not found — cannot allocate a TTY for Hermes. Install util-linux (Linux) or use macOS /usr/bin/script, then retry." >&2',
        '  exit 1',
        'fi',
        'exit ${PAIR_RC:-0}',
      ].join('\n'),
      streamOpts,
      onOutput,
    );
  },

  /** Send a single chat prompt to the agent and return its reply.
   *
   *  Hermes ships a non-interactive single-query mode: `hermes chat -q "..."`
   *  We use that instead of piping into the interactive TUI (which would
   *  just dump its splash banner and exit without ever calling the model).
   *
   *  Notes:
   *  - Secrets are materialized to ~/.hermes/.env right before invocation
   *    so OPENROUTER_API_KEY (and friends) are visible to the agent.
   *  - We force a dumb terminal so the CLI doesn't emit ANSI/box-drawing
   *    chrome around the answer.
   *  - Timeout is generous (180s) because first-token latency on remote
   *    providers like OpenRouter can be slow, and tool-using turns can
   *    take multiple round-trips. */
  async chat(
    prompt: string,
    onOutput?: CommandOutputHandler,
    resumeId?: string,
    onStreamId?: (id: string) => void,
    timeoutMs?: number,
    permissions?: PermissionsConfig,
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
    // Modern Hermes (per docs): `hermes chat -p "..."` for one-shot, with
    // `--resume <id>` as a top-level flag. Older builds only know `-q` and
    // accept `chat --resume <id>` — capability probe selects automatically.
    await ensureHermesChatCaps();
    const noColorFlag = HERMES_CHAT_CAPS.supportsNoColor ? ' --no-color' : '';
    const chatInvocation = resumeId
      ? (HERMES_CHAT_CAPS.supportsModern
          ? `hermes --resume ${JSON.stringify(resumeId)} chat -p "$PROMPT"${noColorFlag} 2>&1`
          : `hermes chat --resume ${JSON.stringify(resumeId)} -q "$PROMPT" 2>&1`)
      : (HERMES_CHAT_CAPS.supportsModern
          ? `hermes chat -p "$PROMPT"${noColorFlag} 2>&1`
          : 'hermes chat -q "$PROMPT" 2>&1');
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
      `echo "[hermes-diag] invocation: ${HERMES_CHAT_CAPS.supportsModern ? 'modern (-p)' : 'legacy (-q)'}" >&2`,
      chatInvocation,
    ].join('\n');

    // Detect Hermes' interactive `Choice [o/s/a/D]:` permission prompts in
    // the streamed output and route them through the approval dialog.
    let activeStreamId: string | null = null;
    let promptBuffer = '';
    let answeringPrompt = false;
    const wrappedOnStreamId = (id: string) => {
      activeStreamId = id;
      onStreamId?.(id);
    };
    const interceptingOnOutput: CommandOutputHandler = (chunk) => {
      onOutput?.(chunk);
      if (chunk.type !== 'stdout' && chunk.type !== 'stderr') return;
      const text = chunk.data || '';
      if (!text) return;
      promptBuffer = (promptBuffer + text).slice(-8000);
      if (answeringPrompt) return;
      if (!matchesApprovalPrompt(promptBuffer)) return;

      // Pull the 20 lines preceding the prompt as context — this is what
      // gets shown to the user as "What" in the approval dialog so they
      // can see the actual command/path the agent wants to act on.
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

      const handler = getApprovalHandler();
      const sid = activeStreamId;
      if (!handler || !sid) {
        // No UI mounted — auto-deny so the agent doesn't hang forever.
        recordPermissionEvent({ action, target, decision: 'auto-denied', prompted: false });
        void coreAPI.writeStreamStdin(sid || '', 'd\n').catch(() => { /* */ });
        promptBuffer = '';
        return;
      }
      answeringPrompt = true;
      promptBuffer = '';
      void handler({ action, target }).then((choice) => {
        void coreAPI.writeStreamStdin(sid, choiceToStdin(choice)).catch(() => { /* */ });
        answeringPrompt = false;
      });
    };

    // Use the caller-provided timeout when given (the UI exposes this as
    // a setting), otherwise fall back to a generous 10 min default.
    const effectiveTimeout = Math.max(60_000, timeoutMs ?? 600_000);
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
      const freshInvocation = HERMES_CHAT_CAPS.supportsModern
        ? `hermes chat -p "$PROMPT"${noColorFlag} 2>&1`
        : 'hermes chat -q "$PROMPT" 2>&1';
      const freshScript = script.replace(chatInvocation, freshInvocation);
      result = await runHermesShell(freshScript, { timeout: effectiveTimeout, onStreamId: wrappedOnStreamId }, interceptingOnOutput);
    }

    const timedOut = !result.success && (result.code === 124 || /timed out after/i.test(result.stderr || ''));

    // Clean the reply: strip ANSI codes and any leftover banner/status lines.
    const stripAnsi = (s: string) =>
      s
        .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
        .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
        .replace(/\x1b[@-Z\\-_]/g, '');

    const boxChars = /[│┃┆┇┊┋║╎╏╽╿─━┄┅┈┉═╌╍╴╶╸╺▎▏▕▌▐▔▁▂▃▄▅▆▇█╭╮╯╰┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬]/;

    // Pull diagnostic lines out separately so we can show them to the user
    // when there's an error, but keep them out of the normal reply.
    const rawLines = stripAnsi(result.stdout || '')
      .split('\n')
      .map((line) => line.replace(/\r/g, ''));

    const diagnostics = rawLines
      .filter((line) => /^\[hermes-diag\]/.test(line.trim()))
      .map((line) => line.trim().replace(/^\[hermes-diag\]\s*/, ''))
      .join('\n');

    // Capture the session id Hermes prints in its footer:
    //   "Resume this session with:\n  hermes --resume 20260420_064718_7199c1"
    // We need this so the next turn can call `hermes chat --resume <id>` and
    // keep the conversation context — without it every turn is a fresh
    // session and the agent has no memory of what we just said.
    const sessionIdMatch = (result.stdout || '').match(/hermes\s+--resume\s+([A-Za-z0-9_\-:.]+)/);
    const sessionId = sessionIdMatch?.[1] || (sessionWasInvalid ? null : resumeId);
    const cleaned = (() => {
      const filtered = rawLines
        .filter((line) => {
          const t = line.trim();
          if (!t) return false;
          if (boxChars.test(t)) return false;
          if (/^(hermes agent v|available tools|available skills|session:|tip:|warning:|⚠|✦|⚕|❯)/i.test(t)) return false;
          if (/^\[hermes(-diag)?\]/.test(t)) return false;
          if (/^\d+\s+tools\s+·\s+\d+\s+skills/i.test(t)) return false;
          if (/^\/(exit|help)\b/.test(t)) return false;
          if (/^query:\s/i.test(t)) return false;
          if (/^goodbye/i.test(t)) return false;
          // Strip the lifecycle/footer noise Hermes prints around every reply.
          if (/^initializing agent\.{0,3}$/i.test(t)) return false;
          if (/^resume this session( with)?:?$/i.test(t)) return false;
          if (/^hermes\s+--resume\b/i.test(t)) return false;
          // "↻ Resumed session 20260421_171422_bdbc76 (3 user messages, 10 total messages)"
          if (/^[↻⟳⭯⟲]?\s*resumed session\b/i.test(t)) return false;
          // "▶ Starting new session ..." or similar lifecycle banners
          if (/^[▶►▷]?\s*starting (a )?new session\b/i.test(t)) return false;
          if (/^session id:\s/i.test(t)) return false;
          if (/^duration:\s/i.test(t)) return false;
          if (/^messages:\s/i.test(t)) return false;
          if (/^tokens?:\s/i.test(t)) return false;
          if (/^cost:\s/i.test(t)) return false;
          if (/^\d+\s+(user|tool calls?|assistant)/i.test(t)) return false;
          return true;
        });

      // Hermes sometimes echoes the user's prompt at the start of the reply
      // (often wrapped/indented, sometimes only the tail). Detect and remove
      // any leading lines that are a substring of, or fully contained within,
      // the original prompt.
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
      const promptNorm = norm(prompt);
      const promptWords = promptNorm.split(' ').filter(Boolean);
      const isEchoLine = (line: string) => {
        const ln = norm(line);
        if (!ln) return false;
        if (ln.length < 4) return false;
        // Whole line is contained in the prompt.
        if (promptNorm.includes(ln)) return true;
        // Or the line is a tail/head of the prompt (≥3 consecutive words match).
        const lnWords = ln.split(' ').filter(Boolean);
        if (lnWords.length >= 3) {
          const joined = lnWords.join(' ');
          if (promptNorm.endsWith(joined) || promptNorm.startsWith(joined)) return true;
        }
        return false;
      };
      while (filtered.length > 0 && isEchoLine(filtered[0])) {
        filtered.shift();
      }

      return filtered.join('\n').trim();
    })();

    // Detect Hermes's "no inference provider" / "missing API key" error so the
    // UI can render an actionable CTA → Secrets tab.
    let missingKey: { provider: string; envVar: string } | undefined;
    const hardErrorRe = /missing api key|api key.*not (set|found)|invalid api key|unauthorized.*api key|401.*unauthorized/i;
    const noProviderRe = /no inference provider configured/i;

    if (hardErrorRe.test(cleaned) || noProviderRe.test(cleaned)) {
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

    let finalReply = cleaned || stripAnsi(result.stdout || '').trim();
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
    const soul = `# ${trimmed}

You are ${trimmed}, the user's personal AI agent.

Your name is **${trimmed}**. When the user asks who you are or what your name is,
respond as ${trimmed} — not as "Hermes" or "an AI assistant". You were set up by
the user with this name during installation, and they expect you to use it.

You are still powered by the Hermes Agent framework (built by Nous Research)
and have full access to its tools, skills, and memory — but your identity to
the user is **${trimmed}**.
`;
    return writeHermesFile('$HOME/.hermes/SOUL.md', soul, '600');
  },

  /** Read the agent's name from SOUL.md (first H1), if any. */
  async getAgentName(): Promise<string | null> {
    const r = await readHermesFile('$HOME/.hermes/SOUL.md');
    if (!r.success || !r.content) return null;
    const m = r.content.match(/^#\s+(.+?)\s*$/m);
    return m ? m[1].trim() : null;
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
    if (listSkillsCache && Date.now() - listSkillsCache.at < LIST_SKILLS_CACHE_TTL_MS) {
      return {
        success: listSkillsCache.value.success,
        skills: listSkillsCache.value.skills.map((s) => ({ ...s })),
        error: listSkillsCache.value.error,
      };
    }
    const script = [
      'set +e',
      'export PATH="$HOME/.hermes/venv/bin:$HOME/.local/bin:$PATH"',
      // Locations to scan. The bundled skills dir lives inside the venv's
      // site-packages — find it dynamically because the python version varies.
      'USER_SKILLS="$HOME/.hermes/skills"',
      'BUNDLED_SKILLS=""',
      'if [ -x "$HOME/.hermes/venv/bin/python" ]; then',
      '  BUNDLED_SKILLS="$($HOME/.hermes/venv/bin/python - <<PYEOF 2>/dev/null',
      'import importlib.util, os, sys',
      'for mod in ("hermes_agent", "hermes"):',
      '    spec = importlib.util.find_spec(mod)',
      '    if spec and spec.submodule_search_locations:',
      '        for loc in spec.submodule_search_locations:',
      '            cand = os.path.join(loc, "skills")',
      '            if os.path.isdir(cand):',
      '                print(cand); sys.exit(0)',
      'PYEOF',
      '  )"',
      'fi',
      // Walk both trees, max depth 2, emit "SOURCE\tCATEGORY\tNAME\tDESC_PATH"
      'walk_skills() {',
      '  local root="$1" source="$2"',
      '  [ -d "$root" ] || return 0',
      '  for entry in "$root"/*; do',
      '    [ -d "$entry" ] || continue',
      '    name="$(basename "$entry")"',
      '    # If this dir itself contains a SKILL.md or a python module, treat it as a skill (flat layout).',
      '    if [ -f "$entry/SKILL.md" ] || [ -f "$entry/skill.md" ] || [ -f "$entry/__init__.py" ] || [ -f "$entry/skill.yaml" ]; then',
      '      desc=""',
      '      for d in "$entry/SKILL.md" "$entry/skill.md"; do',
      '        if [ -f "$d" ]; then desc="$d"; break; fi',
      '      done',
      '      printf "%s\\t%s\\t%s\\t%s\\n" "$source" "general" "$name" "$desc"',
      '      continue',
      '    fi',
      '    # Otherwise treat this dir as a category and descend one level.',
      '    for sub in "$entry"/*; do',
      '      [ -d "$sub" ] || continue',
      '      sub_name="$(basename "$sub")"',
      '      desc=""',
      '      for d in "$sub/SKILL.md" "$sub/skill.md"; do',
      '        if [ -f "$d" ]; then desc="$d"; break; fi',
      '      done',
      '      printf "%s\\t%s\\t%s\\t%s\\n" "$source" "$name" "$sub_name" "$desc"',
      '    done',
      '  done',
      '}',
      'walk_skills "$USER_SKILLS" user',
      'if [ -n "$BUNDLED_SKILLS" ]; then walk_skills "$BUNDLED_SKILLS" bundled; fi',
      'exit 0',
    ].join('\n');

    const result = await runHermesShell(script, { timeout: 30000 });
    if (!result.success && !result.stdout) {
      return { success: false, skills: [], error: result.stderr || 'Failed to list skills' };
    }

    const seen = new Set<string>();
    const skills: Array<{ name: string; category: string; source: 'user' | 'bundled'; description?: string; requiredSecrets?: string[] }> = [];
    const descPaths: Array<{ key: string; path: string }> = [];

    for (const line of (result.stdout || '').split('\n')) {
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const [source, category, name, descPath] = parts;
      if (!name) continue;
      const key = `${category}/${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const skill = {
        name,
        category: category || 'general',
        source: (source === 'user' ? 'user' : 'bundled') as 'user' | 'bundled',
      };
      skills.push(skill);
      if (descPath) descPaths.push({ key, path: descPath });
    }

    // Pull the first non-empty markdown line as a short description AND extract
    // any UPPER_SNAKE_CASE env-var names mentioned in the SKILL.md so we can
    // tell users exactly what secrets each skill needs.
    if (descPaths.length > 0) {
      const descScript = descPaths
        .map(({ key, path }) =>
          `printf "DESC\\t%s\\t" "${key}"; head -n 20 "${path}" 2>/dev/null | grep -m1 -E "^[A-Za-z]" | head -c 200; printf "\\n"; ` +
          `printf "ENV\\t%s\\t" "${key}"; cat "${path}" 2>/dev/null | grep -oE "[A-Z][A-Z0-9_]{3,}_(API_KEY|TOKEN|SECRET|PASSWORD|HOST|USER|PASS|ID|URL|BEARER_TOKEN|ACCESS_TOKEN|CLIENT_ID|CLIENT_SECRET|VERIFY_TOKEN|PHONE_NUMBER_ID)" | sort -u | tr "\\n" "," | head -c 500; printf "\\n"`,
        )
        .join('\n');
      const descResult = await runHermesShell(descScript, { timeout: 20000 });
      const descMap = new Map<string, string>();
      const envMap = new Map<string, string[]>();
      for (const line of (descResult.stdout || '').split('\n')) {
        const parts = line.split('\t');
        if (parts.length < 3) continue;
        const [tag, key, ...rest] = parts;
        const value = rest.join('\t').trim();
        if (tag === 'DESC' && value) descMap.set(key, value);
        if (tag === 'ENV' && value) {
          const vars = value.split(',').map((s) => s.trim()).filter(Boolean);
          if (vars.length) envMap.set(key, Array.from(new Set(vars)));
        }
      }
      for (const skill of skills) {
        const k = `${skill.category}/${skill.name}`;
        const d = descMap.get(k);
        if (d) skill.description = d;
        const e = envMap.get(k);
        if (e && e.length) skill.requiredSecrets = e;
      }
    }

    skills.sort((a, b) =>
      a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
    );
    const finalResult = { success: true, skills } as {
      success: boolean;
      skills: Array<{ name: string; category: string; source: 'user' | 'bundled'; description?: string; requiredSecrets?: string[] }>;
      error?: string;
    };
    listSkillsCache = { at: Date.now(), value: finalResult };
    return finalResult;
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

    const lines = (result.stdout || '').split('\n');
    const tsRe = /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})(?:[,.](\d{1,3}))?/;
    const parseTs = (line: string): number | null => {
      const m = line.match(tsRe);
      if (!m) return null;
      const ms = m[2] ? parseInt(m[2].padEnd(3, '0'), 10) : 0;
      const t = Date.parse(m[1].replace(' ', 'T'));
      return Number.isNaN(t) ? null : t + ms;
    };

    type Pending = { id: string; goal: string; startedAt: number; lastActivity?: number; lastEvent?: string };
    type Done = { id: string; goal: string; startedAt: number; completedAt: number; summary?: string };
    type Failed = { id: string; goal: string; startedAt: number; failedAt: number; reason?: string };

    const pending: Pending[] = [];
    const completed: Done[] = [];
    const failed: Failed[] = [];
    let lastDelegateGoal: string | null = null;

    const goalFromLine = (line: string): string | null => {
      const patterns = [
        /goal\s*[:=]\s*"([^"]{1,400})"/,
        /goal\s*[:=]\s*'([^']{1,400})'/,
        /"task"\s*:\s*"([^"]{1,400})"/,
        /preview\s*=\s*"([^"]{1,400})"/,
        /task\s*[:=]\s*"([^"]{1,400})"/,
        /spawned\s+(?:sub[-_ ]?agent|child\s+agent)\s+(?:for\s+)?["']?([^"'\n]{4,200})/i,
      ];
      for (const re of patterns) {
        const m = line.match(re);
        if (m) return m[1];
      }
      return null;
    };

    // Broadened classifiers — match the variety of phrasings Hermes (and
    // its versions / forks) use. We accept anything that looks like a
    // delegated/child agent lifecycle event.
    const isDelegate = (l: string) => /\bdelegate_task\b|\bdelegate\(.*task/i.test(l);
    const isStart = (l: string) =>
      /\bsub[-_]?agent\.start\b/i.test(l) ||
      /\bworker\.start\b/i.test(l) ||
      /\bchild[-_ ]?agent\b.*\b(started|spawn(ed)?|launch(ed)?)\b/i.test(l) ||
      /\bspawn(ed)?\s+(sub[-_ ]?agent|child\s+agent|worker)\b/i.test(l) ||
      /\b(task|delegation)\b.*\bstarted\b/i.test(l);
    const isComplete = (l: string) =>
      /\bsub[-_]?agent\.complete\b/i.test(l) ||
      /\bworker\.complete\b/i.test(l) ||
      /\bchild[-_ ]?agent\b.*\b(complete|finish(ed)?|done)\b/i.test(l) ||
      /\b(task|delegation)\b.*\bcompleted\b/i.test(l);
    const isFailed = (l: string) =>
      /\bsub[-_]?agent\.(failed|error|denied)\b/i.test(l) ||
      /\bworker\.failed\b/i.test(l) ||
      /\b(task|delegation)\b.*\b(failed|denied|errored)\b/i.test(l) ||
      /\bchild[-_ ]?agent\b.*\b(failed|denied|crashed)\b/i.test(l);
    const isHeartbeat = (l: string) =>
      /\bsub[-_]?agent\.(thinking|tool|progress)\b/i.test(l) ||
      /\bworker\.(thinking|tool|progress)\b/i.test(l);

    const reasonFromLine = (line: string): string | undefined => {
      const m =
        line.match(/(?:reason|error|denied)\s*[:=]\s*"([^"]{1,300})"/i) ||
        line.match(/(?:reason|error|denied)\s*[:=]\s*'([^']{1,300})'/i) ||
        line.match(/permission denied[:\s]*([^\n]{1,200})/i);
      return m ? m[1] : undefined;
    };

    for (const line of lines) {
      if (!line) continue;
      const ts = parseTs(line);

      if (isDelegate(line)) {
        const g = goalFromLine(line);
        if (g) lastDelegateGoal = g;
      }

      if (isStart(line) && ts !== null) {
        const goal = goalFromLine(line) || lastDelegateGoal || '(no goal recorded)';
        const id = `${ts}-${goal.slice(0, 40)}`;
        pending.push({ id, goal, startedAt: ts, lastActivity: ts, lastEvent: 'started' });
        lastDelegateGoal = null;
        continue;
      }

      if (isComplete(line) && ts !== null && pending.length > 0) {
        const open = pending.shift()!;
        const summary = goalFromLine(line) || undefined;
        completed.push({
          id: open.id,
          goal: open.goal,
          startedAt: open.startedAt,
          completedAt: ts,
          summary,
        });
        continue;
      }

      if (isFailed(line) && ts !== null) {
        const reason = reasonFromLine(line);
        const open = pending.shift();
        if (open) {
          failed.push({
            id: open.id,
            goal: open.goal,
            startedAt: open.startedAt,
            failedAt: ts,
            reason,
          });
        } else {
          // Failure without a paired start (denied at spawn time).
          const goal = goalFromLine(line) || lastDelegateGoal || '(no goal recorded)';
          failed.push({
            id: `${ts}-fail-${goal.slice(0, 40)}`,
            goal,
            startedAt: ts,
            failedAt: ts,
            reason,
          });
          lastDelegateGoal = null;
        }
        continue;
      }

      if (isHeartbeat(line) && ts !== null && pending.length > 0) {
        const last = pending[pending.length - 1];
        last.lastActivity = ts;
        if (/thinking/i.test(line)) last.lastEvent = 'thinking';
        else if (/tool/i.test(line)) last.lastEvent = 'using a tool';
        else last.lastEvent = 'working';
      }
    }

    const STALE_AFTER_MS = 60 * 60 * 1000;
    const now = Date.now();
    const stillActive = pending.filter(
      (p) => now - (p.lastActivity ?? p.startedAt) < STALE_AFTER_MS,
    );

    const toIso = (t: number) => new Date(t).toISOString();

    return {
      success: true,
      logPath: '~/.hermes/logs/agent.log',
      active: stillActive.map((p) => ({
        id: p.id,
        goal: p.goal,
        startedAt: toIso(p.startedAt),
        lastActivity: p.lastActivity ? toIso(p.lastActivity) : undefined,
        lastEvent: p.lastEvent,
      })),
      recent: completed
        .sort((a, b) => b.completedAt - a.completedAt)
        .slice(0, 25)
        .map((c) => ({
          id: c.id,
          goal: c.goal,
          startedAt: toIso(c.startedAt),
          completedAt: toIso(c.completedAt),
          durationMs: c.completedAt - c.startedAt,
          summary: c.summary,
        })),
      failed: failed
        .sort((a, b) => b.failedAt - a.failedAt)
        .slice(0, 25)
        .map((f) => ({
          id: f.id,
          goal: f.goal,
          startedAt: toIso(f.startedAt),
          failedAt: toIso(f.failedAt),
          reason: f.reason,
        })),
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
      let cleaned = existing
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

  /**
   * Install + enable the built-in Google Workspace skill and run its auth flow.
   * We try multiple command variants because Hermes CLI naming changed across releases.
   */
  async setupGoogleWorkspace(): Promise<{
    success: boolean;
    installed: boolean;
    enabled: boolean;
    authed: boolean;
    output: string;
    error?: string;
  }> {
    await materializeHermesEnv().catch(() => undefined);

    const install = await runHermesCli(
      [
        'hermes skills install google-workspace 2>&1',
        '|| hermes skill install google-workspace 2>&1',
        '|| hermes install skill google-workspace 2>&1',
        '|| hermes skills add google-workspace 2>&1',
      ].join(' '),
      { timeout: 120000 },
    );
    const installed = install.success;

    const enableRes = await this.setSkillEnabled('google-workspace', true).catch((e) => ({
      success: false,
      error: e instanceof Error ? e.message : String(e),
    }));
    const enabled = !!enableRes?.success;

    const auth = await runHermesCli(
      [
        'hermes auth google-workspace 2>&1',
        '|| hermes auth google 2>&1',
        '|| hermes google-workspace auth 2>&1',
        '|| gws auth login 2>&1',
      ].join(' '),
      { timeout: 180000 },
    );
    const authed = auth.success;

    const output = [install.stdout, install.stderr, auth.stdout, auth.stderr]
      .filter(Boolean)
      .join('\n')
      .trim();

    const success = installed && enabled && authed;
    const error = success
      ? undefined
      : !installed
      ? 'Could not install `google-workspace` skill from Hermes registry.'
      : !enabled
      ? (enableRes as { error?: string })?.error || 'Skill install succeeded but enabling `google-workspace` failed.'
      : 'Google Workspace auth did not complete. Retry setup and finish the browser/device login.'

    return { success, installed, enabled, authed, output, error };
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
};
