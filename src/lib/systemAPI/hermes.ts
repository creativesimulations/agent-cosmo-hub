import { coreAPI } from './core';
import { secretsStore } from './secretsStore';
import type { CommandResult } from './types';

const HERMES_DIR = '~/.hermes';
const HERMES_ENV = '~/.hermes/.env';
const HERMES_CONFIG = '~/.hermes/config.yaml';
const INSTALL_SCRIPT = 'https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh';

/** Hermes Agent installation, configuration, and lifecycle */
export const hermesAPI = {
  /** Install the agent using the official install script.
   *  On Windows we always run inside WSL because hermes-agent is not published
   *  to PyPI and requires the install script (which expects a POSIX shell). */
  async install(extras?: string[]): Promise<CommandResult> {
    const platform = await coreAPI.getPlatform();
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
      '# Ensure venv module is available (Debian/Ubuntu split it out)',
      'if ! python3 -c "import venv" 2>/dev/null; then',
      '  echo "[pip-bootstrap] python venv module missing — trying apt-get (sudo -n)"',
      '  sudo -n apt-get update 2>&1 | tail -3 || true',
      '  sudo -n apt-get install -y python3-venv python3-full 2>&1 | tail -5 || echo "[pip-bootstrap] apt-get failed (no passwordless sudo?)"',
      'fi',
      'if ! python3 -c "import venv" 2>/dev/null; then',
      '  echo "[pip-bootstrap] FATAL: python3-venv is not installed." >&2',
      '  echo "[pip-bootstrap] Open a WSL/Ubuntu terminal and run:" >&2',
      '  echo "[pip-bootstrap]   sudo apt update && sudo apt install -y python3-venv python3-full" >&2',
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

    // Encode the whole payload as base64 to completely bypass shell quoting
    // issues. The base64 string is alphanumeric + `+/=` so it survives any
    // shell unscathed. We then decode + execute it inside bash.
    // Use btoa (browser-safe) since this code runs in Electron's renderer
    // process where Node's Buffer is not available.
    const toB64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
    const b64 = toB64(fullCmd);

    // IMPORTANT: on Windows, `exec` with `shell: true` uses cmd.exe, which
    // does NOT treat single quotes as quoting — it treats them as literal
    // characters. So `wsl bash -lc '...'` would split on spaces. We must
    // use double quotes for the outer shell (cmd-friendly) and rely on the
    // base64 payload being whitespace/quote-free.
    const decodeCmd = `echo ${b64} | base64 -d | bash`;

    // Extras must install into the same venv we just created.
    const extrasCmd = (extrasFlagInner: string) =>
      `"$HOME/.hermes/venv/bin/pip" install --upgrade 'hermes-agent${extrasFlagInner}'`;

    if (platform.isWindows) {
      const baseResult = await coreAPI.runCommand(
        `wsl bash -lc "${decodeCmd}"`,
        { timeout: 600000 }
      );
      if (!baseResult.success || !extrasFlag) return baseResult;
      const extrasB64 = toB64(extrasCmd(extrasFlag));
      return coreAPI.runCommand(
        `wsl bash -lc "echo ${extrasB64} | base64 -d | bash"`,
        { timeout: 300000 }
      );
    }

    if (platform.isWSL) {
      const baseResult = await coreAPI.runCommand(
        `bash -lc "${decodeCmd}"`,
        { timeout: 600000 }
      );
      if (!baseResult.success || !extrasFlag) return baseResult;
      const extrasB64 = toB64(extrasCmd(extrasFlag));
      return coreAPI.runCommand(
        `bash -lc "echo ${extrasB64} | base64 -d | bash"`,
        { timeout: 300000 }
      );
    }

    // macOS / Linux
    const baseResult = await coreAPI.runCommand(
      `bash -c "${decodeCmd}"`,
      { timeout: 600000 }
    );
    if (!baseResult.success || !extrasFlag) return baseResult;
    const extrasB64 = toB64(extrasCmd(extrasFlag));
    return coreAPI.runCommand(
      `bash -c "echo ${extrasB64} | base64 -d | bash"`,
      { timeout: 300000 }
    );
  },

  /** Alternative: install via pip into the dedicated venv (uses WSL on Windows) */
  async installViaPip(): Promise<CommandResult> {
    const platform = await coreAPI.getPlatform();
    const script =
      'set -e; mkdir -p "$HOME/.hermes"; ' +
      'if [ -d "$HOME/.hermes/venv" ] && [ ! -x "$HOME/.hermes/venv/bin/pip" ]; then rm -rf "$HOME/.hermes/venv"; fi; ' +
      '[ -x "$HOME/.hermes/venv/bin/pip" ] || python3 -m venv "$HOME/.hermes/venv"; ' +
      '"$HOME/.hermes/venv/bin/pip" install --upgrade pip wheel setuptools; ' +
      '"$HOME/.hermes/venv/bin/pip" install --upgrade hermes-agent; ' +
      'mkdir -p "$HOME/.local/bin"; ' +
      'ln -sf "$HOME/.hermes/venv/bin/hermes" "$HOME/.local/bin/hermes"';
    const b64 = btoa(unescape(encodeURIComponent(script)));
    const decode = `echo ${b64} | base64 -d | bash`;
    const cmd = platform.isWindows ? `wsl bash -lc "${decode}"` : `bash -lc "${decode}"`;
    return coreAPI.runCommand(cmd, { timeout: 300000 });
  },

  /** Run hermes doctor to verify installation */
  async doctor(): Promise<CommandResult> {
    return coreAPI.runCommand('hermes doctor');
  },

  /** Get agent status */
  async status(): Promise<CommandResult> {
    return coreAPI.runCommand('hermes status');
  },

  /** Run hermes update */
  async update(): Promise<CommandResult> {
    return coreAPI.runCommand('hermes update', { timeout: 300000 });
  },

  // ─── API Key / .env management ────────────────────────────

  /** Read the current ~/.hermes/.env file */
  async readEnvFile(): Promise<Record<string, string>> {
    const homeDir = (await coreAPI.getPlatform()).homeDir;
    const envPath = `${homeDir}/.hermes/.env`;
    const result = await coreAPI.readFile(envPath);
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
    const homeDir = (await coreAPI.getPlatform()).homeDir;
    const envPath = `${homeDir}/.hermes/.env`;

    // Ensure .hermes dir exists
    await coreAPI.mkdir(`${homeDir}/.hermes`);

    // Read existing
    const result = await coreAPI.readFile(envPath);
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

    return coreAPI.writeFile(envPath, updated.join('\n'));
  },

  /** Remove a key from ~/.hermes/.env */
  async removeEnvVar(key: string): Promise<{ success: boolean }> {
    const homeDir = (await coreAPI.getPlatform()).homeDir;
    const envPath = `${homeDir}/.hermes/.env`;
    const result = await coreAPI.readFile(envPath);
    if (!result.success || !result.content) return { success: true };

    const lines = result.content.split('\n').filter((line) => !line.trim().startsWith(`${key}=`));
    return coreAPI.writeFile(envPath, lines.join('\n'));
  },

  // ─── Config management (~/.hermes/config.yaml) ────────────

  /** Read the current config.yaml */
  async readConfig(): Promise<{ success: boolean; content?: string }> {
    const homeDir = (await coreAPI.getPlatform()).homeDir;
    return coreAPI.readFile(`${homeDir}/.hermes/config.yaml`);
  },

  /** Write config.yaml */
  async writeConfig(content: string): Promise<{ success: boolean }> {
    const homeDir = (await coreAPI.getPlatform()).homeDir;
    await coreAPI.mkdir(`${homeDir}/.hermes`);
    return coreAPI.writeFile(`${homeDir}/.hermes/config.yaml`, content);
  },

  /** Set the model in config */
  async setModel(modelString: string): Promise<CommandResult> {
    // Use hermes CLI to set model
    return coreAPI.runCommand(`hermes config set model "${modelString}"`);
  },

  // ─── Agent lifecycle ──────────────────────────────────────

  /** Start the agent (interactive mode in a terminal).
   *  Decrypts secrets and materializes ~/.hermes/.env (chmod 600) right
   *  before launch, so plaintext secrets only exist on disk while running. */
  async start(): Promise<CommandResult> {
    await secretsStore.materializeEnv();
    return coreAPI.runCommand('hermes', { timeout: 10000 });
  },

  /** Start the messaging gateway */
  async startGateway(): Promise<CommandResult> {
    await secretsStore.materializeEnv();
    return coreAPI.runCommand('hermes gateway start', { timeout: 30000 });
  },

  /** Write initial config for first-time setup */
  async writeInitialConfig(options: {
    model?: string;
  }): Promise<{ success: boolean }> {
    const configYaml = `# Ronbot — Hermes Agent Configuration
# Managed by Ronbot Control Panel

model: ${options.model || 'openrouter/nous/hermes-3-llama-3.1-70b'}
`;
    return this.writeConfig(configYaml);
  },

  /** Check if hermes config directory exists */
  async isConfigured(): Promise<boolean> {
    const homeDir = (await coreAPI.getPlatform()).homeDir;
    return coreAPI.fileExists(`${homeDir}/.hermes/.env`);
  },
};
