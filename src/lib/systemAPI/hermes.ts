import { coreAPI } from './core';
import { secretsStore } from './secretsStore';
import { isElectron } from './types';
import type { CommandResult } from './types';

const HERMES_DIR = '$HOME/.hermes';
const HERMES_ENV = '$HOME/.hermes/.env';
const HERMES_CONFIG = '$HOME/.hermes/config.yaml';
const INSTALL_SCRIPT = 'https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh';

// Anything beyond ~4 KB on the argv risks ENAMETOOLONG once Windows PATH +
// cmd.exe quoting is added. Larger scripts are written to a temp file and
// executed via `bash <file>` instead of being inlined as base64.
const INLINE_SCRIPT_LIMIT = 4096;

type CommandOutputHandler = (chunk: { type: string; data?: string; code?: number }) => void;

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
  const fileName = `ainoval-${tag}-${stamp}.sh`;

  if (platform.isWindows) {
    // Write under %USERPROFILE%\.ainoval\tmp, then translate to /mnt/<drive>/...
    const dir = `${platform.homeDir}\\.ainoval\\tmp`;
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

const runHermesShell = async (
  script: string,
  options?: Record<string, unknown>,
  onOutput?: CommandOutputHandler,
): Promise<CommandResult> => {
  const cmd = await buildHermesShellCommand(script);
  return onOutput ? coreAPI.runCommandStream(cmd, options, onOutput) : coreAPI.runCommand(cmd, options);
};

const runHermesCli = async (
  command: string,
  options?: Record<string, unknown>,
  onOutput?: CommandOutputHandler,
): Promise<CommandResult> => {
  return runHermesShell(
    [
      'set -e',
      'export PATH="$HOME/.hermes/venv/bin:$HOME/.local/bin:$PATH"',
      'command -v hermes >/dev/null 2>&1 || { echo "[hermes] FATAL: hermes CLI not found on PATH" >&2; exit 127; }',
      'echo "[hermes] using $(command -v hermes)"',
      command,
    ].join('\n'),
    options,
    onOutput,
  );
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
    const winTmpDir = `${platform.homeDir}\\.ainoval\\tmp`;
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

const inspectHermesInstall = async (): Promise<HermesInstallState> => {
  await repairLegacyWindowsInstall();
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
  const { keys } = await secretsStore.list();
  const secretEntries = (await Promise.all(
    keys.map(async (key) => [key, await secretsStore.get(key)] as const),
  )).filter(([, value]) => value !== '');

  const managedKeys = new Set(secretEntries.map(([key]) => key));
  const existing = await readHermesFile(HERMES_ENV);
  const preserved = existing.success && existing.content
    ? existing.content
        .split('\n')
        .filter((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return true;
          const eqIndex = trimmed.indexOf('=');
          if (eqIndex < 1) return true;
          return !managedKeys.has(trimmed.slice(0, eqIndex).trim());
        })
        .join('\n')
        .replace(/\n+$/, '')
    : '';

  const managed = secretEntries.map(([key, value]) => `${key}=${quoteEnvValue(value)}`).join('\n');
  const sections = [
    preserved,
    managed ? '# ─── Managed by Ainoval (do not edit by hand) ───' : '',
    managed,
  ].filter(Boolean);

  if (sections.length === 0) return { success: true, count: 0 };

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
  return { success: true, count: secretEntries.length };
};

/** Hermes Agent installation, configuration, and lifecycle */
export const hermesAPI = {
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
    const dl = [
      'echo "[install] downloading installer script..."',
      `curl -fsSL ${INSTALL_SCRIPT} -o /tmp/hermes-install.sh`,
      'chmod +x /tmp/hermes-install.sh',
    ].join('\n');
    const runScript = [
      'echo "[install] running installer (inside venv)..."',
      // Inherit our PATH/VIRTUAL_ENV so the installer's `pip install` lands
      // in the venv and PEP 668 protection no longer applies.
      'setsid bash /tmp/hermes-install.sh --skip-setup </dev/null 2>&1',
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
    const fullCmd = ['set -e', unattendedEnv, ensurePip, dl, runScript].join('\n');

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
    if (!extrasFlag) return finalizeInstallVerification(baseResult, onOutput);

    const extrasResult = await runHermesShell(extrasCmd(extrasFlag), { timeout: 300000 }, onOutput);
    return extrasResult.success ? finalizeInstallVerification(extrasResult, onOutput) : extrasResult;
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
    await materializeHermesEnv();
    return runHermesCli(
      [
        'echo "[doctor] starting diagnostics..."',
        'hermes doctor',
      ].join('\n'),
      { timeout: 90000 },
      onOutput,
    );
  },

  /** Get agent status */
  async status(): Promise<CommandResult> {
    return runHermesCli('hermes status');
  },

  /** Run hermes update */
  async update(): Promise<CommandResult> {
    return runHermesCli('hermes update', { timeout: 300000 });
  },

  // ─── API Key / .env management ────────────────────────────

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
    await materializeHermesEnv();
    return runHermesCli('hermes', { timeout: 10000 });
  },

  /** Start the messaging gateway */
  async startGateway(): Promise<CommandResult> {
    await materializeHermesEnv();
    return runHermesCli('hermes gateway start', { timeout: 30000 });
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
  ): Promise<CommandResult & { reply?: string; diagnostics?: string; missingKey?: { provider: string; envVar: string }; materializeFailed?: boolean }> {
    const mat = await materializeHermesEnv();

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
    const script = [
      'set -e',
      'export PATH="$HOME/.hermes/venv/bin:$HOME/.local/bin:$PATH"',
      // Force a non-interactive, plain-text environment.
      'export TERM=dumb NO_COLOR=1 CI=1 PYTHONUNBUFFERED=1',
      // Source ~/.hermes/.env so OPENROUTER_API_KEY (and friends) are visible
      // to the agent. Hermes itself does load .env, but only when run from
      // its own working directory — being explicit here removes any ambiguity
      // and also surfaces shell parse errors in the .env file immediately.
      'if [ -f "$HOME/.hermes/.env" ]; then',
      '  set -a',
      '  # shellcheck disable=SC1091',
      '  . "$HOME/.hermes/.env"',
      '  set +a',
      '  echo "[hermes-diag] sourced ~/.hermes/.env ($(wc -l < "$HOME/.hermes/.env") lines)" >&2',
      'else',
      '  echo "[hermes-diag] WARNING: ~/.hermes/.env does not exist" >&2',
      'fi',
      // Diagnostic: print which key vars are set (length only, never the value)
      // so the user can see whether the key reached the CLI.
      'for v in OPENROUTER_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY GOOGLE_API_KEY NOUS_API_KEY DEEPSEEK_API_KEY; do',
      '  eval "val=\\${$v}"',
      '  if [ -n "$val" ]; then echo "[hermes-diag] $v is set (len=${#val})" >&2; else echo "[hermes-diag] $v is NOT set" >&2; fi',
      'done',
      // Diagnostic: show the configured model so we can see what hermes will use.
      'if [ -f "$HOME/.hermes/config.yaml" ]; then',
      '  MODEL_LINE="$(grep -E "^\\s*model:" "$HOME/.hermes/config.yaml" | head -n1)"',
      '  echo "[hermes-diag] config model: ${MODEL_LINE:-<none>}" >&2',
      'else',
      '  echo "[hermes-diag] WARNING: ~/.hermes/config.yaml does not exist" >&2',
      'fi',
      'command -v hermes >/dev/null 2>&1 || { echo "[hermes-diag] FATAL: hermes CLI not found on PATH" >&2; exit 127; }',
      `PROMPT="$(echo ${promptB64} | base64 -d)"`,
      // Run from ~/.hermes so any relative config lookups also work.
      'cd "$HOME/.hermes" 2>/dev/null || true',
      'hermes chat -q "$PROMPT" </dev/null 2>&1',
    ].join('\n');

    const result = await runHermesShell(script, { timeout: 180000 }, onOutput);

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

    const cleaned = rawLines
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
        return true;
      })
      .join('\n')
      .trim();

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

    return {
      ...result,
      reply: cleaned || stripAnsi(result.stdout || '').trim(),
      diagnostics: diagnostics || (mat.success ? '' : `materializeEnv failed: ${mat.error || 'unknown'}`),
      missingKey,
    };
  },

  /** Write initial config for first-time setup */
  async writeInitialConfig(options: {
    model?: string;
  }): Promise<{ success: boolean }> {
    const configYaml = `# Ronbot — Hermes Agent Configuration
# Managed by Ronbot Control Panel

model: ${options.model || 'openrouter/auto'}
`;
    return this.writeConfig(configYaml);
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
    skills: Array<{ name: string; category: string; source: 'user' | 'bundled'; description?: string }>;
    error?: string;
  }> {
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
      '[ -n "$BUNDLED_SKILLS" ] && walk_skills "$BUNDLED_SKILLS" bundled',
    ].join('\n');

    const result = await runHermesShell(script, { timeout: 30000 });
    if (!result.success && !result.stdout) {
      return { success: false, skills: [], error: result.stderr || 'Failed to list skills' };
    }

    const seen = new Set<string>();
    const skills: Array<{ name: string; category: string; source: 'user' | 'bundled'; description?: string }> = [];
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

    // Pull the first non-empty markdown line as a short description for each
    // skill that ships one. Done in one shell call to stay fast.
    if (descPaths.length > 0) {
      const descScript = descPaths
        .map(({ key, path }) => `printf "%s\\t" "${key}"; head -n 20 "${path}" 2>/dev/null | grep -m1 -E "^[A-Za-z]" | head -c 200; printf "\\n"`)
        .join('\n');
      const descResult = await runHermesShell(descScript, { timeout: 15000 });
      const descMap = new Map<string, string>();
      for (const line of (descResult.stdout || '').split('\n')) {
        const idx = line.indexOf('\t');
        if (idx <= 0) continue;
        const key = line.slice(0, idx);
        const desc = line.slice(idx + 1).trim();
        if (desc) descMap.set(key, desc);
      }
      for (const skill of skills) {
        const d = descMap.get(`${skill.category}/${skill.name}`);
        if (d) skill.description = d;
      }
    }

    skills.sort((a, b) =>
      a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
    );
    return { success: true, skills };
  },
};
