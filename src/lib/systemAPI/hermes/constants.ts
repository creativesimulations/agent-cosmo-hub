// Hermes v0.13.0 sync — May 2026 (Ronbot)
/** Paths and install URLs used across Hermes system API modules. */

export const HERMES_DIR = '$HOME/.hermes';
export const HERMES_ENV = '$HOME/.hermes/.env';
export const HERMES_CONFIG = '$HOME/.hermes/config.yaml';
export const INSTALL_SCRIPT =
  'https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh';

/** Official Hermes one-liner (v0.13+). Run inside bash after prereqs; streamed via runHermesShell. */
export const buildOfficialHermesInstallScript = (): string =>
  [
    'set -euo pipefail',
    'export DEBIAN_FRONTEND=noninteractive',
    // Pin install/data path to the location Ronbot verifies and manages.
    'export HERMES_HOME="$HOME/.hermes"',
    // Guard against accidental env leakage that would switch installer modes.
    'unset ENSURE_DEPS POSTINSTALL_MODE',
    'echo "[install] target HERMES_HOME=$HERMES_HOME"',
    'TMP_INSTALL_SCRIPT="$(mktemp 2>/dev/null || echo /tmp/hermes-install.$$.$RANDOM.sh)"',
    'trap \'rm -f "$TMP_INSTALL_SCRIPT" 2>/dev/null || true\' EXIT',
    `curl -fLsS --retry 3 --connect-timeout 10 --max-time 180 "${INSTALL_SCRIPT}" -o "$TMP_INSTALL_SCRIPT"`,
    'if [ ! -s "$TMP_INSTALL_SCRIPT" ]; then',
    '  echo "[install] FATAL: downloaded installer script is empty" >&2',
    '  exit 52',
    'fi',
    'bash "$TMP_INSTALL_SCRIPT"',
  ].join('\n');

/** @deprecated use buildOfficialHermesInstallScript — kept for grep/tests migration */
export const buildInstallerRunScript = (): string => buildOfficialHermesInstallScript();

/** Inline script size limit before staging to disk (argv / ENAMETOOLONG safety). */
export const INLINE_SCRIPT_LIMIT = 4096;

/** chmod browser-related binaries under the Hermes checkout (Errno 13 fix). */
export const BROWSER_EXECUTABLE_FIX_SCRIPT = [
  'if [ -d "$HOME/.hermes/hermes-agent/node_modules/.bin" ]; then',
  '  find "$HOME/.hermes/hermes-agent/node_modules/.bin" -maxdepth 1 -type f \\( -name "agent-browser" -o -name "playwright" -o -name "playwright-core" \\) -exec chmod +x {} + 2>/dev/null || true',
  'fi',
].join('\n');
