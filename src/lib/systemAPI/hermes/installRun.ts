// Hermes v0.13.0 sync — May 2026 (Ronbot)
import type { CommandResult } from '../types';
import type { CommandOutputHandler } from './shell';
import { runHermesShell } from './shell';
import { buildOfficialHermesInstallScript, BROWSER_EXECUTABLE_FIX_SCRIPT } from './constants';

export type FinalizeInstall = (
  result: CommandResult,
  onOutput?: CommandOutputHandler,
) => Promise<CommandResult>;

/**
 * Official `curl … | bash` installer only (Hermes v0.13+). No Ronbot-managed
 * venv bootstrap or post-script pip extras — the script owns the full install.
 */
export async function runOfficialHermesInstall(
  _extras: string[] | undefined,
  onOutput: CommandOutputHandler | undefined,
  finalize: FinalizeInstall,
  onStreamId?: (id: string) => void,
): Promise<CommandResult> {
  void _extras;
  const script = buildOfficialHermesInstallScript();
  const baseResult = await runHermesShell(script, { timeout: 600_000, onStreamId }, onOutput);
  if (!baseResult.success) return baseResult;
  await runHermesShell(BROWSER_EXECUTABLE_FIX_SCRIPT, { timeout: 15_000 }, onOutput).catch(() => undefined);
  return finalize(baseResult, onOutput);
}

/** pip install -e from an existing source folder (already a POSIX path). */
export async function runLocalFolderHermesInstall(
  posixPath: string,
  extras: string[] | undefined,
  onOutput: CommandOutputHandler | undefined,
  finalize: FinalizeInstall,
  onStreamId?: (id: string) => void,
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

  const result = await runHermesShell(script, { timeout: 600_000, onStreamId }, onOutput);
  if (!result.success) return result;
  await runHermesShell(BROWSER_EXECUTABLE_FIX_SCRIPT, { timeout: 15_000 }, onOutput).catch(() => undefined);
  return finalize(result, onOutput);
}
