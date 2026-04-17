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
    const dl = `curl -fsSL ${INSTALL_SCRIPT} -o /tmp/hermes-install.sh && chmod +x /tmp/hermes-install.sh`;
    // setsid detaches from controlling tty; </dev/null closes stdin.
    const runScript =
      `setsid bash /tmp/hermes-install.sh --skip-setup </dev/null 2>&1 || true`;
    const fullCmd = `${unattendedEnv} && ${dl} && ${runScript}`;

    if (platform.isWindows) {
      const baseResult = await coreAPI.runCommand(
        `wsl bash -lc "${fullCmd.replace(/"/g, '\\"')}"`,
        { timeout: 600000 }
      );
      if (!baseResult.success || !extrasFlag) return baseResult;
      return coreAPI.runCommand(
        `wsl bash -lc "python3 -m pip install --upgrade 'hermes-agent${extrasFlag}'"`,
        { timeout: 300000 }
      );
    }

    if (platform.isWSL) {
      const baseResult = await coreAPI.runCommand(
        `bash -lc "${fullCmd.replace(/"/g, '\\"')}"`,
        { timeout: 600000 }
      );
      if (!baseResult.success || !extrasFlag) return baseResult;
      return coreAPI.runCommand(
        `bash -lc "python3 -m pip install --upgrade 'hermes-agent${extrasFlag}'"`,
        { timeout: 300000 }
      );
    }

    // macOS / Linux
    const baseResult = await coreAPI.runCommand(fullCmd, { timeout: 600000 });
    if (!baseResult.success || !extrasFlag) return baseResult;
    return coreAPI.runCommand(
      `python3 -m pip install --upgrade "hermes-agent${extrasFlag}"`,
      { timeout: 300000 }
    );
  },

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
