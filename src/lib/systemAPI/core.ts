import { isElectron } from './types';
import type { CommandResult, PlatformInfo, DiskSpaceInfo } from './types';

type CommandOutputEvent = {
  streamId: string;
  type: string;
  data?: string;
  code?: number;
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const simulatedPlatform: PlatformInfo = {
  platform: 'win32',
  arch: 'x64',
  release: '10.0.22631',
  isWSL: false,
  isWindows: true,
  isMac: false,
  isLinux: false,
  homeDir: 'C:\\Users\\User',
  totalMemory: 17179869184,
  freeMemory: 8589934592,
};

/** Core platform & command execution */
export const coreAPI = {
  async getPlatform(): Promise<PlatformInfo> {
    if (isElectron()) return window.electronAPI!.getPlatform();
    await delay(300);
    return simulatedPlatform;
  },

  async runCommand(cmd: string, options?: Record<string, unknown>): Promise<CommandResult> {
    if (isElectron()) return window.electronAPI!.runCommand(cmd, options);
    return simulateCommand(cmd);
  },

  async runCommandStream(
    cmd: string,
    options?: Record<string, unknown>,
    onOutput?: (event: Omit<CommandOutputEvent, 'streamId'>) => void,
  ): Promise<CommandResult> {
    if (isElectron()) {
      return new Promise((resolve) => {
        const { id, promise } = window.electronAPI!.runCommandStream(cmd, options);
        let stdout = '';
        let stderr = '';
        let code = 0;

        const unsubscribe = window.electronAPI!.onCommandOutput((event) => {
          if (event.streamId !== id) return;

          if (event.type === 'stdout' && event.data) stdout += event.data;
          if (event.type === 'stderr' && event.data) stderr += event.data;
          if (event.type === 'exit') code = event.code ?? code;

          onOutput?.({ type: event.type, data: event.data, code: event.code });
        });

        promise
          .then((result) => {
            unsubscribe();
            resolve({
              success: result.success,
              stdout,
              stderr,
              code: typeof result.code === 'number' ? result.code : code,
            });
          })
          .catch((error) => {
            unsubscribe();
            const message = error instanceof Error ? error.message : String(error);
            const normalized = message.endsWith('\n') ? message : `${message}\n`;
            onOutput?.({ type: 'stderr', data: normalized, code: 1 });
            resolve({
              success: false,
              stdout,
              stderr: `${stderr}${normalized}`,
              code: code || 1,
            });
          });
      });
    }

    const result = await simulateCommand(cmd);
    if (result.stdout) onOutput?.({ type: 'stdout', data: result.stdout, code: result.code });
    if (result.stderr) onOutput?.({ type: 'stderr', data: result.stderr, code: result.code });
    onOutput?.({ type: 'exit', code: result.code });
    return result;
  },

  async fileExists(path: string): Promise<boolean> {
    if (isElectron()) return window.electronAPI!.fileExists(path);
    return false;
  },

  async readFile(path: string): Promise<{ success: boolean; content?: string; error?: string }> {
    if (isElectron()) return window.electronAPI!.readFile(path);
    return { success: false, error: 'Not running in Electron' };
  },

  async writeFile(path: string, content: string): Promise<{ success: boolean; error?: string }> {
    if (isElectron()) return window.electronAPI!.writeFile(path, content);
    return { success: true };
  },

  async mkdir(path: string): Promise<{ success: boolean; error?: string }> {
    if (isElectron()) return window.electronAPI!.mkdir(path);
    return { success: true };
  },

  async getDiskSpace(): Promise<DiskSpaceInfo> {
    if (isElectron()) return window.electronAPI!.getDiskSpace();
    // Simulated: 25 GB free of 250 GB on C:
    await delay(200);
    return { success: true, drive: 'C:', freeBytes: 25 * 1024 ** 3, totalBytes: 250 * 1024 ** 3 };
  },
};

// ─── Simulation for browser development ─────────────────────

async function simulateCommand(cmd: string): Promise<CommandResult> {
  await delay(400 + Math.random() * 600);

  if (cmd === 'ver' || cmd.includes('sw_vers')) {
    return { success: true, stdout: 'Microsoft Windows [Version 10.0.22631.4460]', stderr: '', code: 0 };
  }
  if (cmd.includes('wsl --status')) {
    return { success: true, stdout: 'Default Version: 2\nWSL version: 2.0.14', stderr: '', code: 0 };
  }
  if (cmd.includes('wsl -l')) {
    return { success: true, stdout: '* Ubuntu-22.04    Running    2', stderr: '', code: 0 };
  }
  if (cmd.includes('python') && cmd.includes('--version')) {
    return { success: true, stdout: 'Python 3.11.5', stderr: '', code: 0 };
  }
  if (cmd.includes('which python') || cmd.includes('where python')) {
    return { success: true, stdout: '/usr/bin/python3', stderr: '', code: 0 };
  }
  if (cmd.includes('pip') && cmd.includes('--version')) {
    return { success: true, stdout: 'pip 23.3.1 from /usr/lib/python3/dist-packages/pip (python 3.11)', stderr: '', code: 0 };
  }
  if (cmd.includes('git --version')) {
    return { success: true, stdout: 'git version 2.43.0', stderr: '', code: 0 };
  }
  if (cmd.includes('curl --version') || cmd.includes('which curl')) {
    return { success: true, stdout: 'curl 8.4.0', stderr: '', code: 0 };
  }
  if (cmd.includes('hermes --version') || cmd.includes('which hermes')) {
    return { success: true, stdout: 'hermes-agent 0.9.0', stderr: '', code: 0 };
  }
  if (cmd.includes('hermes doctor')) {
    return { success: true, stdout: '✓ Python 3.11.5\n✓ hermes-agent 0.9.0\n✓ Config found\n✓ API key configured\n✓ All checks passed', stderr: '', code: 0 };
  }
  if (cmd.includes('hermes status')) {
    return { success: true, stdout: 'Agent: Ron\nStatus: running\nModel: openrouter/nous/hermes-3-llama-3.1-70b\nUptime: 2h 34m', stderr: '', code: 0 };
  }
  // Install script
  if (cmd.includes('scripts/install.sh') || cmd.includes('pip install hermes-agent')) {
    await delay(3000);
    return { success: true, stdout: 'Installing hermes-agent...\nCreating virtualenv...\nInstalling dependencies...\n✓ hermes-agent 0.9.0 installed successfully\nRun `source ~/.bashrc` then `hermes` to get started!', stderr: '', code: 0 };
  }
  // winget/brew/apt installs
  if (cmd.includes('winget install') || cmd.includes('brew install') || cmd.includes('apt-get install') || cmd.includes('curl -fsSL')) {
    await delay(3000);
    return { success: true, stdout: 'Successfully installed', stderr: '', code: 0 };
  }
  // hermes setup / launch
  if (cmd.includes('hermes')) {
    return { success: true, stdout: 'OK', stderr: '', code: 0 };
  }

  return { success: true, stdout: '', stderr: '', code: 0 };
}
