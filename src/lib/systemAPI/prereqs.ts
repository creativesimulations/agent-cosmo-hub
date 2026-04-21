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

  /**
   * Check pip. On Windows we auto-upgrade pip; on macOS/Linux modern systems
   * mark the system Python as PEP 668 "externally-managed" and `pip install
   * --upgrade pip` fails with a scary error — we skip the upgrade there since
   * the Hermes installer creates its own venv anyway.
   */
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

    // Only auto-upgrade pip on Windows. On macOS/Linux the system Python is
    // typically PEP 668-managed (externally-managed-environment error) and the
    // upgrade isn't needed anyway because Hermes installs into its own venv.
    if (platform.isWindows) {
      const upgradeCmd = foundCmd.replace(/--version$/, 'install --upgrade pip');
      const upgrade = await coreAPI.runCommand(upgradeCmd, { timeout: 180000 });
      if (upgrade.success) {
        const recheck = await coreAPI.runCommand(foundCmd);
        const v = recheck.stdout.match(/(\d+\.\d+[\.\d]*)/);
        if (v) foundVersion = v[1];
      }
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

  // Helper: detect Homebrew presence on macOS. We don't auto-install brew
  // (large scope, requires root). If missing, return a friendly message
  // pointing the user at https://brew.sh.
  async _brewMissingResult(pkg: string): Promise<CommandResult> {
    const probe = await coreAPI.runCommand('command -v brew');
    if (probe.success && probe.stdout.trim()) {
      return coreAPI.runCommand(`brew install ${pkg}`, { timeout: 600000 });
    }
    return {
      success: false,
      stdout: '',
      stderr:
        `Homebrew is not installed. Install it once with:\n\n` +
        `  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"\n\n` +
        `Then click Install again to install ${pkg}.`,
      code: 127,
    };
  },

  /**
   * Install Python.
   * - Windows: winget
   * - macOS:   brew (if installed) — but skipped entirely if system Python 3.11+ already exists.
   * - Linux:   delegated to the in-app sudo dialog (caller must use sudoAPI.aptInstall).
   */
  async installPython(): Promise<CommandResult> {
    const platform = await coreAPI.getPlatform();
    if (platform.isWindows) {
      return coreAPI.runCommand('winget install Python.Python.3.11 --accept-package-agreements --accept-source-agreements', { timeout: 300000 });
    }
    if (platform.isMac) {
      return this._brewMissingResult('python@3.11');
    }
    // Linux: don't shell out to `sudo` directly — would hang with no TTY.
    // The PrerequisiteCheck UI will route through the sudo dialog instead.
    return {
      success: false,
      stdout: '',
      stderr:
        'Python install on Linux requires administrator access. ' +
        'Open a terminal and run:\n  sudo apt-get install -y python3.11 python3.11-venv python3-pip',
      code: 1,
    };
  },

  /** Install Git */
  async installGit(): Promise<CommandResult> {
    const platform = await coreAPI.getPlatform();
    if (platform.isWindows) {
      return coreAPI.runCommand('winget install Git.Git --accept-package-agreements --accept-source-agreements', { timeout: 300000 });
    }
    if (platform.isMac) {
      // macOS ships git via Xcode CLT — trigger the system installer prompt.
      const probe = await coreAPI.runCommand('command -v git');
      if (probe.success && probe.stdout.trim()) {
        return { success: true, stdout: 'git already installed', stderr: '', code: 0 };
      }
      const brewProbe = await coreAPI.runCommand('command -v brew');
      if (brewProbe.success && brewProbe.stdout.trim()) {
        return coreAPI.runCommand('brew install git', { timeout: 300000 });
      }
      return {
        success: false,
        stdout: '',
        stderr:
          'Git is provided by Apple\'s Xcode Command Line Tools. Run this once in Terminal:\n\n' +
          '  xcode-select --install\n\n' +
          'A system dialog will appear — click "Install" and wait for it to finish.',
        code: 1,
      };
    }
    return {
      success: false,
      stdout: '',
      stderr:
        'Git install on Linux requires administrator access. Open a terminal and run:\n' +
        '  sudo apt-get install -y git',
      code: 1,
    };
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
    return {
      success: false,
      stdout: '',
      stderr:
        'curl install on Linux requires administrator access. Open a terminal and run:\n' +
        '  sudo apt-get install -y curl',
      code: 1,
    };
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
      // macOS: ensurepip may fail under PEP 668; try --user fallback.
      const r = await coreAPI.runCommand('python3 -m ensurepip --upgrade --user', { timeout: 120000 });
      if (r.success) return r;
      return coreAPI.runCommand('python3 -m ensurepip --upgrade', { timeout: 120000 });
    }
    return {
      success: false,
      stdout: '',
      stderr:
        'pip install on Linux requires administrator access. Open a terminal and run:\n' +
        '  sudo apt-get install -y python3-pip',
      code: 1,
    };
  },

  // ─── Optional system packages used by Hermes extras ───────

  /** Check if ffmpeg is on PATH (host or, on Windows, inside WSL via /mnt/c). */
  async checkFfmpeg(): Promise<{ found: boolean; version?: string }> {
    const platform = await coreAPI.getPlatform();
    // On Windows we care whether ffmpeg is visible to WSL (where Hermes runs).
    // ffmpeg.exe installed via winget on the host appears at /mnt/c/... and is
    // automatically on the WSL PATH thanks to WSL interop, so checking from
    // inside WSL is the most accurate test.
    const inner = 'command -v ffmpeg && ffmpeg -version 2>/dev/null | head -1';
    const b64 = btoa(unescape(encodeURIComponent(inner)));
    const decode = `echo ${b64} | base64 -d | bash`;
    const cmd = platform.isWindows
      ? `wsl bash -lc "${decode}"`
      : `bash -lc "${decode}"`;
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
  /** Check if Python can actually create venvs with pip/ensurepip available. */
  async checkPythonVenv(): Promise<{ installed: boolean; packageName?: string }> {
    const platform = await coreAPI.getPlatform();
    // Base64-encode the inner script so it survives any host shell quoting
    // (cmd.exe → wsl, zsh on macOS, fish on Linux, etc.). bash -lc decodes it.
    const inner = `python3 -c 'import sys; pkg=f"python{sys.version_info.major}.{sys.version_info.minor}-venv"; import venv, ensurepip; print("OK:" + pkg)' 2>/dev/null || python3 -c 'import sys; print("NO:" + f"python{sys.version_info.major}.{sys.version_info.minor}-venv")'`;
    const b64 = btoa(unescape(encodeURIComponent(inner)));
    const decode = `echo ${b64} | base64 -d | bash`;
    const cmd = platform.isWindows
      ? `wsl bash -lc "${decode}"`
      : `bash -lc "${decode}"`;
    const result = await coreAPI.runCommand(cmd, { timeout: 10000 });
    const output = (result.stdout || '').trim();
    const match = output.match(/^(OK|NO):(.+)$/);
    return {
      installed: match?.[1] === 'OK',
      packageName: match?.[2]?.trim() || 'python3-venv',
    };
  },

  async installFfmpeg(): Promise<CommandResult> {
    const platform = await coreAPI.getPlatform();

    // Helper: install ffmpeg inside WSL via passwordless apt. The agent runs
    // in WSL, so installing on the Windows host alone (winget) doesn't always
    // make ffmpeg discoverable to the Python process inside Linux.
    const installInsideWSL = async (wrapper: (inner: string) => string): Promise<CommandResult> => {
      const script = [
        'set -e',
        'export DEBIAN_FRONTEND=noninteractive',
        'if command -v ffmpeg >/dev/null 2>&1; then echo "[ffmpeg] already installed"; exit 0; fi',
        'echo "[ffmpeg] trying passwordless apt-get..."',
        'if sudo -n true 2>/dev/null; then',
        '  sudo -n apt-get update 2>&1 | tail -3 || true',
        '  sudo -n apt-get install -y ffmpeg 2>&1 | tail -10',
        'else',
        '  echo "[ffmpeg] no passwordless sudo available" >&2',
        '  echo "Open your WSL/Ubuntu terminal and run:" >&2',
        '  echo "  sudo apt update && sudo apt install -y ffmpeg" >&2',
        '  exit 1',
        'fi',
        'command -v ffmpeg >/dev/null 2>&1 || { echo "[ffmpeg] install did not produce a binary" >&2; exit 1; }',
        'echo "[ffmpeg] installed: $(ffmpeg -version 2>/dev/null | head -1)"',
      ].join('\n');
      const b64 = btoa(unescape(encodeURIComponent(script)));
      return coreAPI.runCommand(wrapper(`echo ${b64} | base64 -d | bash`), { timeout: 600000 });
    };

    if (platform.isWindows) {
      // Install inside WSL where the agent actually runs.
      const wslResult = await installInsideWSL((inner) => `wsl bash -lc "${inner}"`);
      if (wslResult.success) return wslResult;
      // Fallback: try winget on the host so at least ffmpeg.exe is on the WSL
      // PATH via interop. Better than nothing.
      const wingetResult = await coreAPI.runCommand(
        'winget install --id=Gyan.FFmpeg -e --accept-package-agreements --accept-source-agreements',
        { timeout: 600000 }
      );
      if (wingetResult.success) return wingetResult;
      return {
        success: false,
        stdout: wslResult.stdout,
        stderr:
          (wslResult.stderr || '').trim() +
          '\n\nManual fix: open WSL/Ubuntu and run:\n  sudo apt update && sudo apt install -y ffmpeg',
        code: wslResult.code ?? 1,
      };
    }
    if (platform.isMac) {
      return this._brewMissingResult('ffmpeg');
    }
    // Native Linux / WSL session — try passwordless apt, then surface manual cmd.
    // Caller (InstallContext) routes through the sudo dialog if this path is needed.
    return installInsideWSL((inner) => `bash -lc "${inner}"`);
  },
};
