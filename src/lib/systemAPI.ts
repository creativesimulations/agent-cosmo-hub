/**
 * System API bridge — calls Electron IPC when running in desktop,
 * falls back to simulated responses in browser for development.
 */

interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

interface PlatformInfo {
  platform: string;
  arch: string;
  release: string;
  isWSL: boolean;
  isWindows: boolean;
  isMac: boolean;
  isLinux: boolean;
  homeDir: string;
  totalMemory: number;
  freeMemory: number;
}

declare global {
  interface Window {
    electronAPI?: {
      runCommand: (cmd: string, options?: Record<string, unknown>) => Promise<CommandResult>;
      runCommandStream: (cmd: string, options?: Record<string, unknown>) => { id: string; promise: Promise<{ success: boolean; code?: number }> };
      onCommandOutput: (callback: (data: { streamId: string; type: string; data?: string; code?: number }) => void) => () => void;
      getPlatform: () => Promise<PlatformInfo>;
      fileExists: (path: string) => Promise<boolean>;
      readFile: (path: string) => Promise<{ success: boolean; content?: string; error?: string }>;
      writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }>;
      mkdir: (path: string) => Promise<{ success: boolean; error?: string }>;
      isElectron: boolean;
    };
  }
}

export const isElectron = (): boolean => {
  return !!window.electronAPI?.isElectron;
};

// ─── Simulation helpers for browser dev mode ──────────────────

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

// ─── Public API ───────────────────────────────────────────────

export const systemAPI = {
  /** Get platform information */
  async getPlatform(): Promise<PlatformInfo> {
    if (isElectron()) {
      return window.electronAPI!.getPlatform();
    }
    await delay(300);
    return simulatedPlatform;
  },

  /** Run a shell command and return the result */
  async runCommand(cmd: string, options?: Record<string, unknown>): Promise<CommandResult> {
    if (isElectron()) {
      return window.electronAPI!.runCommand(cmd, options);
    }
    // Simulated responses for common prerequisite checks
    return simulateCommand(cmd);
  },

  /** Check if a file/directory exists */
  async fileExists(path: string): Promise<boolean> {
    if (isElectron()) {
      return window.electronAPI!.fileExists(path);
    }
    return false;
  },

  /** Read a file */
  async readFile(path: string): Promise<{ success: boolean; content?: string; error?: string }> {
    if (isElectron()) {
      return window.electronAPI!.readFile(path);
    }
    return { success: false, error: 'Not running in Electron' };
  },

  /** Write a file */
  async writeFile(path: string, content: string): Promise<{ success: boolean; error?: string }> {
    if (isElectron()) {
      return window.electronAPI!.writeFile(path, content);
    }
    return { success: true }; // Simulate success in browser
  },

  /** Create a directory */
  async mkdir(path: string): Promise<{ success: boolean; error?: string }> {
    if (isElectron()) {
      return window.electronAPI!.mkdir(path);
    }
    return { success: true };
  },

  // ─── High-level prerequisite checks ───────────────────────

  /** Detect OS */
  async detectOS(): Promise<{ name: string; version: string }> {
    const platform = await this.getPlatform();
    if (platform.isWindows) {
      const result = await this.runCommand('ver');
      const version = result.stdout.match(/\d+\.\d+\.\d+/) || [platform.release];
      return { name: `Windows (${platform.arch})`, version: version[0] };
    }
    if (platform.isMac) {
      const result = await this.runCommand('sw_vers -productVersion');
      return { name: `macOS (${platform.arch})`, version: result.stdout.trim() };
    }
    const result = await this.runCommand('cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d \'"\'');
    return { name: result.stdout.trim() || `Linux (${platform.arch})`, version: platform.release };
  },

  /** Check WSL2 (Windows only) */
  async checkWSL(): Promise<{ installed: boolean; version?: string; distro?: string }> {
    const platform = await this.getPlatform();
    if (!platform.isWindows) return { installed: false };

    const result = await this.runCommand('wsl --status');
    if (!result.success) return { installed: false };

    const versionMatch = result.stdout.match(/Default Version:\s*(\d+)/i) ||
                         result.stdout.match(/WSL\s*version:\s*([\d.]+)/i);
    const distroResult = await this.runCommand('wsl -l -v');
    const distroMatch = distroResult.stdout.match(/\*\s+(\S+)\s+\w+\s+(\d+)/);

    return {
      installed: true,
      version: versionMatch ? `WSL ${versionMatch[1]}` : 'WSL 2',
      distro: distroMatch ? distroMatch[1] : undefined,
    };
  },

  /** Check Python */
  async checkPython(): Promise<{ installed: boolean; version?: string; path?: string }> {
    // Try python3 first, then python
    for (const cmd of ['python3 --version', 'python --version']) {
      const result = await this.runCommand(cmd);
      if (result.success) {
        const version = result.stdout.match(/(\d+\.\d+\.\d+)/) || result.stderr.match(/(\d+\.\d+\.\d+)/);
        if (version) {
          const major = parseInt(version[1].split('.')[0]);
          const minor = parseInt(version[1].split('.')[1]);
          if (major >= 3 && minor >= 11) {
            const whichResult = await this.runCommand(cmd.includes('python3') ? 'which python3' : 'which python');
            return { installed: true, version: version[1], path: whichResult.stdout.trim() };
          }
        }
      }
    }
    return { installed: false };
  },

  /** Check pip */
  async checkPip(): Promise<{ installed: boolean; version?: string }> {
    for (const cmd of ['pip3 --version', 'pip --version', 'pipx --version']) {
      const result = await this.runCommand(cmd);
      if (result.success) {
        const version = result.stdout.match(/(\d+\.\d+[\.\d]*)/);
        return { installed: true, version: version?.[1] };
      }
    }
    return { installed: false };
  },

  /** Check Git */
  async checkGit(): Promise<{ installed: boolean; version?: string }> {
    const result = await this.runCommand('git --version');
    if (result.success) {
      const version = result.stdout.match(/(\d+\.\d+\.\d+)/);
      return { installed: true, version: version?.[1] };
    }
    return { installed: false };
  },

  /** Check Ollama */
  async checkOllama(): Promise<{ installed: boolean; version?: string }> {
    const result = await this.runCommand('ollama --version');
    if (result.success) {
      const version = result.stdout.match(/(\d+\.\d+[\.\d]*)/);
      return { installed: true, version: version?.[1] };
    }
    return { installed: false };
  },

  // ─── Installation commands ────────────────────────────────

  /** Install WSL2 (Windows, requires admin) */
  async installWSL(): Promise<CommandResult> {
    return this.runCommand('wsl --install', { timeout: 300000 });
  },

  /** Install Python via winget/apt/brew */
  async installPython(): Promise<CommandResult> {
    const platform = await this.getPlatform();
    if (platform.isWindows) {
      return this.runCommand('winget install Python.Python.3.11 --accept-package-agreements --accept-source-agreements', { timeout: 300000 });
    }
    if (platform.isMac) {
      return this.runCommand('brew install python@3.11', { timeout: 300000 });
    }
    return this.runCommand('sudo apt-get install -y python3.11 python3.11-venv python3-pip', { timeout: 300000 });
  },

  /** Install Git */
  async installGit(): Promise<CommandResult> {
    const platform = await this.getPlatform();
    if (platform.isWindows) {
      return this.runCommand('winget install Git.Git --accept-package-agreements --accept-source-agreements', { timeout: 300000 });
    }
    if (platform.isMac) {
      return this.runCommand('brew install git', { timeout: 300000 });
    }
    return this.runCommand('sudo apt-get install -y git', { timeout: 300000 });
  },

  /** Install Ollama */
  async installOllama(): Promise<CommandResult> {
    const platform = await this.getPlatform();
    if (platform.isWindows) {
      return this.runCommand('winget install Ollama.Ollama --accept-package-agreements --accept-source-agreements', { timeout: 300000 });
    }
    if (platform.isMac) {
      return this.runCommand('brew install ollama', { timeout: 300000 });
    }
    return this.runCommand('curl -fsSL https://ollama.com/install.sh | sh', { timeout: 300000 });
  },

  /** Clone the agent repo */
  async cloneRepo(token: string, targetDir?: string): Promise<CommandResult> {
    const dir = targetDir || '~/ronbot-agent';
    const repoUrl = `https://${token}@github.com/ronbot/agent.git`;
    return this.runCommand(`git clone ${repoUrl} ${dir}`, { timeout: 120000 });
  },

  /** Create venv and install agent */
  async setupPythonEnv(agentDir?: string): Promise<CommandResult> {
    const dir = agentDir || '~/ronbot-agent';
    const cmds = [
      `cd ${dir}`,
      'python3 -m venv .venv',
      'source .venv/bin/activate',
      'pip install -e .',
    ].join(' && ');
    return this.runCommand(cmds, { timeout: 300000, cwd: dir });
  },

  /** Launch the agent */
  async launchAgent(name: string, port: number = 8000): Promise<CommandResult> {
    const dir = '~/ronbot-agent';
    return this.runCommand(
      `cd ${dir} && source .venv/bin/activate && ronbot start --name "${name}" --port ${port}`,
      { timeout: 30000, cwd: dir }
    );
  },

  /** Write agent config.yaml */
  async writeAgentConfig(config: { name: string; port: number; provider: string }): Promise<{ success: boolean }> {
    const yaml = `# Ronbot Agent Configuration
agent:
  name: "${config.name}"
  version: "0.1.0"
  max_sub_agents: 10
  auto_restart: true

gateway:
  host: "0.0.0.0"
  port: ${config.port}
  platforms:
    - name: "rest_api"
      enabled: true

providers:
  default: "${config.provider}"

logging:
  level: "info"
  file: "agent.log"
  max_size: "50MB"
  rotation: true
`;
    const homeDir = (await this.getPlatform()).homeDir;
    return this.writeFile(`${homeDir}/ronbot-agent/config.yaml`, yaml);
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
  if (cmd.includes('which python')) {
    return { success: true, stdout: '/usr/bin/python3', stderr: '', code: 0 };
  }
  if (cmd.includes('pip') && cmd.includes('--version')) {
    return { success: true, stdout: 'pip 23.3.1 from /usr/lib/python3/dist-packages/pip (python 3.11)', stderr: '', code: 0 };
  }
  if (cmd.includes('git --version')) {
    return { success: true, stdout: 'git version 2.43.0', stderr: '', code: 0 };
  }
  if (cmd.includes('ollama --version')) {
    return { success: false, stdout: '', stderr: 'command not found: ollama', code: 127 };
  }
  if (cmd.includes('git clone')) {
    await delay(2000);
    return { success: true, stdout: "Cloning into 'ronbot-agent'...\ndone.", stderr: '', code: 0 };
  }
  if (cmd.includes('pip install') || cmd.includes('venv')) {
    await delay(3000);
    return { success: true, stdout: 'Successfully installed ronbot-agent-0.1.0', stderr: '', code: 0 };
  }
  if (cmd.includes('ronbot start')) {
    return { success: true, stdout: 'Agent started successfully', stderr: '', code: 0 };
  }
  if (cmd.includes('winget install') || cmd.includes('brew install') || cmd.includes('apt-get install') || cmd.includes('curl')) {
    await delay(3000);
    return { success: true, stdout: 'Successfully installed', stderr: '', code: 0 };
  }

  return { success: true, stdout: '', stderr: '', code: 0 };
}

export default systemAPI;
