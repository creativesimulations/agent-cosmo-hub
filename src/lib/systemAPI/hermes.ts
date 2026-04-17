import { coreAPI } from './core';
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
    // Use `yes` to answer ALL interactive prompts in the install script
    // (extras prompt, ffmpeg prompt, etc.) instead of just the first one.
    const yesCmd = wantsExtras ? 'yes y' : 'yes n';
    const extrasFlag = wantsExtras ? `[${extras!.join(',')}]` : '';

    if (platform.isWindows) {
      // Run install script inside WSL. Use bash -lc so the user's profile
      // (PATH, pyenv, etc.) is loaded.
      const baseResult = await coreAPI.runCommand(
        `wsl bash -lc "${yesCmd} 2>/dev/null | curl -fsSL ${INSTALL_SCRIPT} | bash"`,
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
        `bash -lc "${yesCmd} 2>/dev/null | curl -fsSL ${INSTALL_SCRIPT} | bash"`,
        { timeout: 600000 }
      );
      if (!baseResult.success || !extrasFlag) return baseResult;
      return coreAPI.runCommand(
        `bash -lc "python3 -m pip install --upgrade 'hermes-agent${extrasFlag}'"`,
        { timeout: 300000 }
      );
    }

    // macOS / Linux
    const baseResult = await coreAPI.runCommand(
      `${yesCmd} 2>/dev/null | curl -fsSL ${INSTALL_SCRIPT} | bash`,
      { timeout: 600000 }
    );
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

  /** Start the agent (interactive mode in a terminal) */
  async start(): Promise<CommandResult> {
    return coreAPI.runCommand('hermes', { timeout: 10000 });
  },

  /** Start the messaging gateway */
  async startGateway(): Promise<CommandResult> {
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
