/** Paths and install URLs used across Hermes system API modules. */

export const HERMES_DIR = '$HOME/.hermes';
export const HERMES_ENV = '$HOME/.hermes/.env';
export const HERMES_CONFIG = '$HOME/.hermes/config.yaml';
export const INSTALL_SCRIPT =
  'https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh';
export const INSTALLER_ENTRYPOINT =
  'setsid bash /tmp/hermes-install.sh --skip-setup </dev/null 2>&1';

export const buildInstallerRunScript = (): string => INSTALLER_ENTRYPOINT;

/** Inline script size limit before staging to disk (argv / ENAMETOOLONG safety). */
export const INLINE_SCRIPT_LIMIT = 4096;

/** chmod browser-related binaries under the Hermes checkout (Errno 13 fix). */
export const BROWSER_EXECUTABLE_FIX_SCRIPT = [
  'if [ -d "$HOME/.hermes/hermes-agent/node_modules/.bin" ]; then',
  '  find "$HOME/.hermes/hermes-agent/node_modules/.bin" -maxdepth 1 -type f \\( -name "agent-browser" -o -name "playwright" -o -name "playwright-core" \\) -exec chmod +x {} + 2>/dev/null || true',
  'fi',
].join('\n');
