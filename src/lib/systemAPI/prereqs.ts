import { coreAPI } from './core';
import type { CommandResult } from './types';

/** Prerequisite detection and installation */
export const prereqAPI = {
  /** Detect OS */
  async detectOS(): Promise<{ name: string; version: string }> {
    const platform = await coreAPI.getPlatform();
    if (platform.isWindows) {
      const result = await coreAPI.runCommand('ver');
      const version = result.stdout.match(/\d+\.\d+\.\d+/) || [platform.release];
      return { name: `Windows (${platform.arch})`, version: version[0] };
    }
    if (platform.isMac) {
      const result = await coreAPI.runCommand('sw_vers -productVersion');
      return { name: `macOS (${platform.arch})`, version: result.stdout.trim() };
    }
    const result = await coreAPI.runCommand('cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d \'"\'');
    return { name: result.stdout.trim() || `Linux (${platform.arch})`, version: platform.release };
  },

  /** Check WSL2 (Windows only) */
  async checkWSL(): Promise<{ installed: boolean; version?: string; distro?: string }> {
    const platform = await coreAPI.getPlatform();
    if (!platform.isWindows) return { installed: false };

    const result = await coreAPI.runCommand('wsl --status');
    if (!result.success) return { installed: false };

    const versionMatch = result.stdout.match(/Default Version:\s*(\d+)/i) ||
                          result.stdout.match(/WSL\s*version:\s*([\d.]+)/i);
    const distroResult = await coreAPI.runCommand('wsl -l -v');
    const distroMatch = distroResult.stdout.match(/\*\s+(\S+)\s+\w+\s+(\d+)/);

    return {
      installed: true,
      version: versionMatch ? `WSL ${versionMatch[1]}` : 'WSL 2',
      distro: distroMatch ? distroMatch[1] : undefined,
    };
  },

  /** Check Python */
  async checkPython(): Promise<{ installed: boolean; version?: string; path?: string }> {
    const platform = await coreAPI.getPlatform();
    const cmds = platform.isWindows
      ? ['python --version', 'python3 --version', 'py -3 --version']
      : ['python3 --version', 'python --version'];

    for (const cmd of cmds) {
      const result = await coreAPI.runCommand(cmd);
      const output = result.stdout + result.stderr;
      const version = output.match(/(\d+\.\d+\.\d+)/);
      if (result.success && version) {
        const major = parseInt(version[1].split('.')[0]);
        const minor = parseInt(version[1].split('.')[1]);
        if (major >= 3 && minor >= 11) {
          const whichCmd = platform.isWindows ? `where ${cmd.split(' ')[0]}` : `which ${cmd.split(' ')[0]}`;
          const whichResult = await coreAPI.runCommand(whichCmd);
          return { installed: true, version: version[1], path: whichResult.stdout.trim().split('\n')[0] };
        }
      }
    }
    return { installed: false };
  },

  /** Check pip — also auto-upgrades to latest if outdated */
  async checkPip(): Promise<{ installed: boolean; version?: string }> {
    const platform = await coreAPI.getPlatform();
    const cmds = platform.isWindows
      ? ['py -3 -m pip --version', 'python -m pip --version', 'pip --version', 'pip3 --version']
      : ['python3 -m pip --version', 'pip3 --version', 'pip --version'];

    let foundCmd: string | null = null;
    let foundVersion: string | undefined;

    for (const cmd of cmds) {
      const result = await coreAPI.runCommand(cmd);
      if (result.success && result.stdout.includes('pip')) {
        const version = result.stdout.match(/(\d+\.\d+[\.\d]*)/);
        foundCmd = cmd;
        foundVersion = version?.[1];
        break;
      }
    }

    if (!foundCmd) return { installed: false };

    // Auto-upgrade pip to latest so agent install doesn't fail later.
    // Use the SAME interpreter that worked above to avoid prefix mismatch.
    const upgradeCmd = foundCmd.replace(/--version$/, 'install --upgrade pip');
    const upgrade = await coreAPI.runCommand(upgradeCmd, { timeout: 180000 });
    if (upgrade.success) {
      const recheck = await coreAPI.runCommand(foundCmd);
      const v = recheck.stdout.match(/(\d+\.\d+[\.\d]*)/);
      if (v) foundVersion = v[1];
    }

    return { installed: true, version: foundVersion };
  },

  /** Check Git */
  async checkGit(): Promise<{ installed: boolean; version?: string }> {
    const result = await coreAPI.runCommand('git --version');
    if (result.success) {
      const version = result.stdout.match(/(\d+\.\d+\.\d+)/);
      return { installed: true, version: version?.[1] };
    }
    return { installed: false };
  },

  /** Check curl */
  async checkCurl(): Promise<{ installed: boolean; version?: string }> {
    const result = await coreAPI.runCommand('curl --version');
    if (result.success) {
      const version = result.stdout.match(/(\d+\.\d+[\.\d]*)/);
      return { installed: true, version: version?.[1] };
    }
    return { installed: false };
  },

  /** Check if Hermes Agent is already installed */
  async checkHermes(): Promise<{ installed: boolean; version?: string }> {
    const result = await coreAPI.runCommand('hermes --version');
    if (result.success) {
      const version = result.stdout.match(/(\d+\.\d+[\.\d]*)/);
      return { installed: true, version: version?.[1] };
    }
    return { installed: false };
  },

  // ─── Installation commands ────────────────────────────────

  /** Install WSL2 (Windows, requires admin) */
  async installWSL(): Promise<CommandResult> {
    return coreAPI.runCommand('wsl --install', { timeout: 300000 });
  },

  /** Install Python via winget/apt/brew */
  async installPython(): Promise<CommandResult> {
    const platform = await coreAPI.getPlatform();
    if (platform.isWindows) {
      return coreAPI.runCommand('winget install Python.Python.3.11 --accept-package-agreements --accept-source-agreements', { timeout: 300000 });
    }
    if (platform.isMac) {
      return coreAPI.runCommand('brew install python@3.11', { timeout: 300000 });
    }
    return coreAPI.runCommand('sudo apt-get install -y python3.11 python3.11-venv python3-pip', { timeout: 300000 });
  },

  /** Install Git */
  async installGit(): Promise<CommandResult> {
    const platform = await coreAPI.getPlatform();
    if (platform.isWindows) {
      return coreAPI.runCommand('winget install Git.Git --accept-package-agreements --accept-source-agreements', { timeout: 300000 });
    }
    if (platform.isMac) {
      return coreAPI.runCommand('brew install git', { timeout: 300000 });
    }
    return coreAPI.runCommand('sudo apt-get install -y git', { timeout: 300000 });
  },

  /** Install curl */
  async installCurl(): Promise<CommandResult> {
    const platform = await coreAPI.getPlatform();
    if (platform.isWindows) {
      return coreAPI.runCommand('winget install cURL.cURL --accept-package-agreements --accept-source-agreements', { timeout: 300000 });
    }
    if (platform.isMac) {
      return { success: true, stdout: 'curl is pre-installed on macOS', stderr: '', code: 0 };
    }
    return coreAPI.runCommand('sudo apt-get install -y curl', { timeout: 300000 });
  },

  /** Install pip (uses ensurepip or get-pip.py) */
  async installPip(): Promise<CommandResult> {
    const platform = await coreAPI.getPlatform();
    if (platform.isWindows) {
      // Try ensurepip first, then get-pip.py as fallback
      const result = await coreAPI.runCommand('py -3 -m ensurepip --upgrade', { timeout: 120000 });
      if (result.success) return result;
      // Fallback: try python -m ensurepip
      const result2 = await coreAPI.runCommand('python -m ensurepip --upgrade', { timeout: 120000 });
      if (result2.success) return result2;
      // Last resort: download get-pip.py
      return coreAPI.runCommand(
        'curl -sS https://bootstrap.pypa.io/get-pip.py -o %TEMP%\\get-pip.py && python %TEMP%\\get-pip.py',
        { timeout: 300000 }
      );
    }
    if (platform.isMac) {
      return coreAPI.runCommand('python3 -m ensurepip --upgrade', { timeout: 120000 });
    }
    return coreAPI.runCommand('sudo apt-get install -y python3-pip', { timeout: 300000 });
  },

  // ─── Optional system packages used by Hermes extras ───────

  /** Check if ffmpeg is on PATH (host or, on Windows, inside WSL via /mnt/c). */
  async checkFfmpeg(): Promise<{ found: boolean; version?: string }> {
    const platform = await coreAPI.getPlatform();
    // On Windows we care whether ffmpeg is visible to WSL (where Hermes runs).
    // ffmpeg.exe installed via winget on the host appears at /mnt/c/... and is
    // automatically on the WSL PATH thanks to WSL interop, so checking from
    // inside WSL is the most accurate test.
    const cmd = platform.isWindows
      ? 'wsl bash -lc "command -v ffmpeg && ffmpeg -version 2>/dev/null | head -1"'
      : 'command -v ffmpeg && ffmpeg -version 2>/dev/null | head -1';
    const result = await coreAPI.runCommand(cmd, { timeout: 10000 });
    if (!result.success || !result.stdout?.trim()) return { found: false };
    const lines = result.stdout.trim().split('\n');
    return { found: true, version: lines[lines.length - 1] };
  },

  /**
   * Install ffmpeg on the host so the Hermes installer's optional ffmpeg check
   * passes and we never hit the sudo-prompt code path.
   *
   * - Windows: `winget install ffmpeg` runs as the user with their own UAC
   *   consent (no stored passwords). WSL sees it via interop.
   * - macOS: `brew install ffmpeg` (no sudo needed).
   * - Linux/WSL: requires sudo, which we cannot provide non-interactively.
   *   Returns success=false with a clear message so the UI can tell the user
   *   to install it manually.
   */
  async installFfmpeg(): Promise<CommandResult> {
    const platform = await coreAPI.getPlatform();
    if (platform.isWindows) {
      return coreAPI.runCommand(
        'winget install --id=Gyan.FFmpeg -e --accept-package-agreements --accept-source-agreements',
        { timeout: 600000 }
      );
    }
    if (platform.isMac) {
      return coreAPI.runCommand('brew install ffmpeg', { timeout: 600000 });
    }
    // Linux / WSL — sudo required, can't do unattended.
    return {
      success: false,
      stdout: '',
      stderr:
        'ffmpeg cannot be installed automatically on Linux/WSL because it requires sudo. ' +
        'Please run `sudo apt install ffmpeg` (or your distro equivalent) in a terminal, then retry.',
      code: 1,
    };
  },
};
