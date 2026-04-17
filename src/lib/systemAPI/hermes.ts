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
    const ensurePip = [
      'echo "[pip-bootstrap] checking for pip..."',
      'if python3 -m pip --version 2>/dev/null; then echo "[pip-bootstrap] pip already present"; else',
      '  echo "[pip-bootstrap] pip missing — attempting ensurepip"',
      '  python3 -m ensurepip --upgrade 2>&1 || echo "[pip-bootstrap] ensurepip failed (often disabled on Debian/Ubuntu)"',
      '  if ! python3 -m pip --version 2>/dev/null; then',
      '    echo "[pip-bootstrap] trying apt-get (sudo -n, no password)"',
      '    sudo -n apt-get update 2>&1 | tail -3 || true',
      '    sudo -n apt-get install -y python3-pip python3-venv python3-full 2>&1 | tail -5 || echo "[pip-bootstrap] apt-get failed (likely no passwordless sudo)"',
      '  fi',
      '  if ! python3 -m pip --version 2>/dev/null; then',
      '    echo "[pip-bootstrap] trying get-pip.py via curl --user"',
      '    curl -fsSL https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py 2>&1 || echo "[pip-bootstrap] curl get-pip.py failed"',
      '    python3 /tmp/get-pip.py --user --break-system-packages 2>&1 | tail -10 || python3 /tmp/get-pip.py --user 2>&1 | tail -10 || echo "[pip-bootstrap] get-pip.py execution failed"',
      '    export PATH="$HOME/.local/bin:$PATH"',
      '  fi',
      'fi',
      // Final hard check — abort with a helpful message if still missing.
      'if ! python3 -m pip --version 2>/dev/null; then',
      '  echo "[pip-bootstrap] FATAL: could not install pip automatically." >&2',
      '  echo "[pip-bootstrap] Please open a WSL/Ubuntu terminal and run:" >&2',
      '  echo "[pip-bootstrap]   sudo apt update && sudo apt install -y python3-pip python3-venv" >&2',
      '  echo "[pip-bootstrap] then retry the install from this app." >&2',
      '  exit 42',
      'fi',
      'echo "[pip-bootstrap] pip is ready: $(python3 -m pip --version)"',
    ].join('; ');
    const dl = `echo "[install] downloading installer script..." && curl -fsSL ${INSTALL_SCRIPT} -o /tmp/hermes-install.sh && chmod +x /tmp/hermes-install.sh`;
    // setsid detaches from controlling tty; </dev/null closes stdin.
    // Don't swallow exit code here — we want failures to propagate.
    const runScript =
      `echo "[install] running installer..." && setsid bash /tmp/hermes-install.sh --skip-setup </dev/null 2>&1`;
    const fullCmd = `${unattendedEnv}; ${ensurePip} && ${dl} && ${runScript}`;

    // Encode the whole payload as base64 to completely bypass shell quoting
    // issues when wrapping in `wsl bash -lc "..."` or `bash -lc "..."`.
    // Use btoa (browser-safe) since this code runs in Electron's renderer
    // process where Node's Buffer is not available.
    const toB64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
    const b64 = toB64(fullCmd);
    const wrapped = (shell: string) =>
      `${shell} -lc 'echo ${b64} | base64 -d | bash'`;

    if (platform.isWindows) {
      const baseResult = await coreAPI.runCommand(
        wrapped('wsl bash'),
        { timeout: 600000 }
      );
      if (!baseResult.success || !extrasFlag) return baseResult;
      const extrasB64 = toB64(`python3 -m pip install --upgrade 'hermes-agent${extrasFlag}'`);
      return coreAPI.runCommand(
        `wsl bash -lc 'echo ${extrasB64} | base64 -d | bash'`,
        { timeout: 300000 }
      );
    }

    if (platform.isWSL) {
      const baseResult = await coreAPI.runCommand(
        wrapped('bash'),
        { timeout: 600000 }
      );
      if (!baseResult.success || !extrasFlag) return baseResult;
      const extrasB64 = toB64(`python3 -m pip install --upgrade 'hermes-agent${extrasFlag}'`);
      return coreAPI.runCommand(
        `bash -lc 'echo ${extrasB64} | base64 -d | bash'`,
        { timeout: 300000 }
      );
    }

    // macOS / Linux — run directly via base64 too for consistency.
    const baseResult = await coreAPI.runCommand(
      `bash -c 'echo ${b64} | base64 -d | bash'`,
      { timeout: 600000 }
    );
    if (!baseResult.success || !extrasFlag) return baseResult;
    return coreAPI.runCommand(
      `python3 -m pip install --upgrade "hermes-agent${extrasFlag}"`,
      { timeout: 300000 }
    );

  /** Alternative: install via pip (uses WSL on Windows) */
  async installViaPip(): Promise<CommandResult> {
    const platform = await coreAPI.getPlatform();
    const cmd = platform.isWindows
      ? `wsl bash -lc "python3 -m pip install --upgrade hermes-agent"`
      : 'python3 -m pip install --upgrade hermes-agent';
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
