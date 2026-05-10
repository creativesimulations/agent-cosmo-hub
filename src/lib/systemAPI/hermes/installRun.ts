import type { CommandResult } from '../types';
import type { CommandOutputHandler } from './shell';
import { runHermesShell } from './shell';
import {
  INSTALL_SCRIPT,
  buildInstallerRunScript,
  BROWSER_EXECUTABLE_FIX_SCRIPT,
} from './constants';

export type FinalizeInstall = (
  result: CommandResult,
  onOutput?: CommandOutputHandler,
) => Promise<CommandResult>;

/**
 * Official curl | bash installer + optional editable extras from the cloned
 * ~/.hermes/hermes-agent checkout. Caller supplies post-success verification.
 */
export async function runOfficialHermesInstall(
  extras: string[] | undefined,
  onOutput: CommandOutputHandler | undefined,
  finalize: FinalizeInstall,
): Promise<CommandResult> {
  const wantsExtras = !!(extras && extras.length > 0);
  const extrasFlag = wantsExtras ? `[${extras!.join(',')}]` : '';

  const unattendedEnv =
    'export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a SUDO_ASKPASS=/bin/false';
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
  const fullCmd = ['set -e', unattendedEnv, ensurePip, cleanupStaleCheckout, dl, runScript].join('\n');

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

  const baseResult = await runHermesShell(fullCmd, { timeout: 600000 }, onOutput);
  if (!baseResult.success) return baseResult;
  if (!extrasFlag) {
    await runHermesShell(BROWSER_EXECUTABLE_FIX_SCRIPT, { timeout: 15000 }, onOutput).catch(() => undefined);
    return finalize(baseResult, onOutput);
  }

  const extrasResult = await runHermesShell(extrasCmd(extrasFlag), { timeout: 300000 }, onOutput);
  if (!extrasResult.success) return extrasResult;
  await runHermesShell(BROWSER_EXECUTABLE_FIX_SCRIPT, { timeout: 15000 }, onOutput).catch(() => undefined);
  return finalize(extrasResult, onOutput);
}

/** pip install -e from an existing source folder (already a POSIX path). */
export async function runLocalFolderHermesInstall(
  posixPath: string,
  extras: string[] | undefined,
  onOutput: CommandOutputHandler | undefined,
  finalize: FinalizeInstall,
): Promise<CommandResult> {
  const wantsExtras = !!(extras && extras.length > 0);
  const extrasFlag = wantsExtras ? `[${extras!.join(',')}]` : '';

  const script = [
    'set -e',
    'export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a SUDO_ASKPASS=/bin/false',
    `SRC="${posixPath}"`,
    'echo "[local-install] using source folder: $SRC"',
    'if [ ! -d "$SRC" ]; then',
    '  echo "[local-install] FATAL: folder does not exist: $SRC" >&2',
    '  exit 60',
    'fi',
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
  return finalize(result, onOutput);
}
