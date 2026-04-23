/**
 * Zero-CLI browser backend setup.
 *
 * Drives Docker / Camofox / Chrome installation and launch on macOS, Windows,
 * and Linux without ever sending the user to a terminal. All elevation goes
 * through the in-app SudoPasswordDialog (or the macOS osascript prompt or
 * Windows UAC for winget) — nothing is stored, nothing is typed in a shell.
 */

import { coreAPI } from './core';
import { sudoAPI } from './sudo';
import type { CommandResult } from './types';

export type StreamLogger = (event: { type: string; data?: string; code?: number }) => void;

const log = (onOutput: StreamLogger | undefined, line: string, type: 'stdout' | 'stderr' = 'stdout') => {
  onOutput?.({ type, data: line.endsWith('\n') ? line : line + '\n' });
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── HTTP polling (Electron `fetch` is fine; no Node http needed) ────────────

async function pollUrl(url: string, timeoutMs: number, onOutput?: StreamLogger): Promise<boolean> {
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < timeoutMs) {
    attempt += 1;
    try {
      const resp = await fetch(url, { method: 'GET' });
      if (resp.ok || resp.status === 200) {
        log(onOutput, `✓ ${url} responded (HTTP ${resp.status}) after ${attempt} attempt(s)`);
        return true;
      }
    } catch {
      /* not yet up */
    }
    await sleep(2000);
  }
  log(onOutput, `✗ Timed out waiting for ${url} after ${Math.round(timeoutMs / 1000)}s`, 'stderr');
  return false;
}

// ─── Docker detection / install ──────────────────────────────────────────────

export interface DockerStatus {
  installed: boolean;
  running: boolean;
  version?: string;
}

export const detectDocker = async (): Promise<DockerStatus> => {
  const platform = await coreAPI.getPlatform();
  const cmd = platform.isWindows
    ? 'where docker'
    : 'command -v docker';
  const which = await coreAPI.runCommand(cmd, { timeout: 8000 });
  if (!which.success || !which.stdout.trim()) {
    return { installed: false, running: false };
  }
  const ver = await coreAPI.runCommand('docker version --format "{{.Server.Version}}"', { timeout: 8000 });
  if (ver.success && ver.stdout.trim() && !/error/i.test(ver.stderr)) {
    return { installed: true, running: true, version: ver.stdout.trim() };
  }
  return { installed: true, running: false };
};

export const installDocker = async (
  onOutput: StreamLogger | undefined,
  sudoPassword: string | null,
): Promise<CommandResult> => {
  const platform = await coreAPI.getPlatform();

  if (platform.isMac) {
    log(onOutput, 'Checking for Homebrew…');
    const brew = await coreAPI.runCommand('command -v brew', { timeout: 8000 });
    if (brew.success && brew.stdout.trim()) {
      log(onOutput, '✓ Homebrew found — installing Docker Desktop via brew (this can take a few minutes)…');
      return coreAPI.runCommandStream(
        'brew install --cask docker',
        { timeout: 900000 },
        onOutput,
      );
    }
    log(onOutput, '⚠ Homebrew not found. Downloading the official Docker Desktop installer…');
    const arch = platform.arch === 'arm64' ? 'arm64' : 'amd64';
    const dmgUrl = `https://desktop.docker.com/mac/main/${arch}/Docker.dmg`;
    const dest = '$HOME/Downloads/Docker.dmg';
    const dl = await coreAPI.runCommandStream(
      `bash -lc "mkdir -p $HOME/Downloads && curl -L --fail -o ${dest} '${dmgUrl}' && open ${dest}"`,
      { timeout: 900000 },
      onOutput,
    );
    if (dl.success) {
      log(onOutput, 'ℹ Drag Docker into Applications, then launch it from Launchpad. Click "I installed Docker" below when ready.');
    }
    return dl;
  }

  if (platform.isWindows) {
    log(onOutput, 'Installing Docker Desktop via winget (a UAC consent prompt will appear)…');
    return coreAPI.runCommandStream(
      'winget install --id Docker.DockerDesktop -e --accept-package-agreements --accept-source-agreements',
      { timeout: 1200000 },
      onOutput,
    );
  }

  // Linux (or WSL — but inside WSL we still install docker via apt)
  if (sudoPassword === null) {
    return { success: false, stdout: '', stderr: 'sudo password required to install docker.io', code: 1 };
  }
  log(onOutput, 'Installing docker.io via apt (this may take a few minutes)…');
  const apt = await sudoAPI.aptInstall(['docker.io'], sudoPassword);
  log(onOutput, apt.stdout || '');
  if (apt.stderr) log(onOutput, apt.stderr, 'stderr');
  return apt;
};

export const startDockerDaemon = async (onOutput?: StreamLogger): Promise<boolean> => {
  const platform = await coreAPI.getPlatform();
  if (platform.isMac) {
    log(onOutput, 'Launching Docker Desktop…');
    await coreAPI.runCommand('open -a Docker', { timeout: 8000 });
  } else if (platform.isWindows) {
    log(onOutput, 'Starting Docker Desktop…');
    await coreAPI.runCommand(
      'powershell -NoProfile -Command "Start-Process \\"$env:ProgramFiles\\Docker\\Docker\\Docker Desktop.exe\\""',
      { timeout: 12000 },
    );
  } else {
    log(onOutput, 'Starting docker daemon (systemctl)…');
    await coreAPI.runCommand('bash -lc "sudo -n systemctl start docker 2>/dev/null || true"', { timeout: 15000 });
  }

  log(onOutput, 'Waiting for Docker daemon to come up…');
  const start = Date.now();
  while (Date.now() - start < 90000) {
    const probe = await coreAPI.runCommand('docker info --format "{{.ServerVersion}}"', { timeout: 6000 });
    if (probe.success && probe.stdout.trim() && !/error/i.test(probe.stderr)) {
      log(onOutput, `✓ Docker daemon ready (server ${probe.stdout.trim()})`);
      return true;
    }
    await sleep(3000);
  }
  log(onOutput, '✗ Docker daemon did not come up within 90s', 'stderr');
  return false;
};

// ─── Camofox (git + npm install + npm start) ─────────────────────────────────
//
// The upstream `jo-inc/camofox-browser` repo does NOT publish a public Docker
// image (the GHCR `denied` error users hit was because the package is not
// published). The project's own README installs it via `git clone && npm
// install && npm start`, so that's what we automate here. No Docker required.

const CAMOFOX_REPO = 'https://github.com/jo-inc/camofox-browser.git';
const CAMOFOX_DIR_POSIX = '$HOME/.ronbot/camofox';
const CAMOFOX_DIR_WIN = '%USERPROFILE%\\.ronbot\\camofox';
const CAMOFOX_LOG_POSIX = '$HOME/.ronbot/camofox.log';
const CAMOFOX_LOG_WIN = '%USERPROFILE%\\.ronbot\\camofox.log';

export interface NodeStatus {
  installed: boolean;
  version?: string;
}

export const detectNode = async (): Promise<NodeStatus> => {
  const r = await coreAPI.runCommand('node --version', { timeout: 8000 });
  if (r.success && r.stdout.trim().startsWith('v')) {
    return { installed: true, version: r.stdout.trim() };
  }
  return { installed: false };
};

export const detectGit = async (): Promise<boolean> => {
  const platform = await coreAPI.getPlatform();
  const cmd = platform.isWindows ? 'where git' : 'command -v git';
  const r = await coreAPI.runCommand(cmd, { timeout: 8000 });
  return r.success && !!r.stdout.trim();
};

/**
 * Install Node.js (LTS) via the platform-native package manager.
 * macOS: brew (no sudo); Windows: winget (UAC); Linux: nodesource via apt.
 */
export const installNode = async (
  onOutput: StreamLogger | undefined,
  sudoPassword: string | null,
): Promise<CommandResult> => {
  const platform = await coreAPI.getPlatform();
  if (platform.isMac) {
    const brew = await coreAPI.runCommand('command -v brew', { timeout: 8000 });
    if (brew.success && brew.stdout.trim()) {
      log(onOutput, '✓ Homebrew found — installing Node via brew…');
      return coreAPI.runCommandStream('brew install node', { timeout: 600000 }, onOutput);
    }
    log(onOutput, '⚠ Homebrew not found — opening the official Node.js installer page.');
    await coreAPI.runCommand('open https://nodejs.org/en/download', { timeout: 8000 });
    return { success: false, stdout: '', stderr: 'Install Node from nodejs.org, then click "Install & start Camofox" again.', code: 1 };
  }
  if (platform.isWindows) {
    log(onOutput, 'Installing Node.js LTS via winget (a UAC prompt may appear)…');
    return coreAPI.runCommandStream(
      'winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements',
      { timeout: 900000 },
      onOutput,
    );
  }
  // Linux
  if (sudoPassword === null) {
    return { success: false, stdout: '', stderr: 'sudo password required to install Node.js', code: 1 };
  }
  log(onOutput, 'Installing Node.js LTS via apt…');
  return sudoAPI.aptInstall(['nodejs', 'npm'], sudoPassword);
};

export const installGit = async (
  onOutput: StreamLogger | undefined,
  sudoPassword: string | null,
): Promise<CommandResult> => {
  const platform = await coreAPI.getPlatform();
  if (platform.isMac) {
    log(onOutput, 'Installing git via xcode-select (a system prompt will appear)…');
    return coreAPI.runCommandStream('xcode-select --install', { timeout: 600000 }, onOutput);
  }
  if (platform.isWindows) {
    log(onOutput, 'Installing Git via winget (UAC prompt may appear)…');
    return coreAPI.runCommandStream(
      'winget install --id Git.Git -e --accept-package-agreements --accept-source-agreements',
      { timeout: 900000 },
      onOutput,
    );
  }
  if (sudoPassword === null) {
    return { success: false, stdout: '', stderr: 'sudo password required to install git', code: 1 };
  }
  return sudoAPI.aptInstall(['git'], sudoPassword);
};

let camofoxStreamId: string | null = null;

/**
 * End-to-end: clone (or pull) the repo, install dependencies, start the
 * server in the background. Output streams into onOutput.
 */
export const setupAndStartCamofox = async (onOutput?: StreamLogger): Promise<CommandResult> => {
  const platform = await coreAPI.getPlatform();
  const dir = platform.isWindows ? CAMOFOX_DIR_WIN : CAMOFOX_DIR_POSIX;
  const logPath = platform.isWindows ? CAMOFOX_LOG_WIN : CAMOFOX_LOG_POSIX;

  // 1. Stop any prior instance we launched (best-effort).
  await stopCamofoxServer().catch(() => undefined);

  // 2. Clone or pull. We use a single shell line so the success criterion is
  //    "either fresh clone OR pull succeeded".
  if (platform.isWindows) {
    log(onOutput, `Cloning/updating Camofox into ${dir}…`);
    const clone = await coreAPI.runCommandStream(
      `cmd /c "if exist ${dir}\\.git (cd /d ${dir} && git pull --ff-only) else (mkdir ${dir.replace(/\\camofox$/, '')} 2>nul & git clone ${CAMOFOX_REPO} ${dir})"`,
      { timeout: 600000 },
      onOutput,
    );
    if (!clone.success) return clone;
  } else {
    log(onOutput, `Cloning/updating Camofox into ${dir}…`);
    const clone = await coreAPI.runCommandStream(
      `bash -lc 'mkdir -p "$(dirname ${dir})" && if [ -d "${dir}/.git" ]; then cd "${dir}" && git pull --ff-only; else git clone ${CAMOFOX_REPO} "${dir}"; fi'`,
      { timeout: 600000 },
      onOutput,
    );
    if (!clone.success) return clone;
  }

  // 3. npm install (downloads Camoufox browser binary on first run — can be slow).
  log(onOutput, 'Running npm install (this can take a few minutes the first time)…');
  const installCmd = platform.isWindows
    ? `cmd /c "cd /d ${dir} && npm install"`
    : `bash -lc 'cd "${dir}" && npm install'`;
  const inst = await coreAPI.runCommandStream(installCmd, { timeout: 1200000 }, onOutput);
  if (!inst.success) return inst;

  // 4. Start `npm start` in the background, redirecting output to a log file.
  log(onOutput, 'Starting Camofox server (npm start)…');
  const startCmd = platform.isWindows
    ? `cmd /c "cd /d ${dir} && start /B cmd /c "npm start > ${logPath} 2>&1""`
    : `bash -lc 'cd "${dir}" && nohup npm start > "${logPath}" 2>&1 &'`;
  const start = await coreAPI.runCommandStream(
    startCmd,
    {
      timeout: 8000,
      onStreamId: (id) => {
        camofoxStreamId = id;
      },
    },
    onOutput,
  );
  // We don't fail on non-zero from the spawn wrapper because the background
  // process is what matters — pollCamofox() decides if it actually came up.
  log(onOutput, `Camofox launched in the background. Log file: ${logPath}`);
  return start;
};

export const stopCamofoxServer = async (onOutput?: StreamLogger): Promise<void> => {
  const platform = await coreAPI.getPlatform();
  if (camofoxStreamId) {
    await coreAPI.killStream(camofoxStreamId).catch(() => undefined);
    camofoxStreamId = null;
  }
  if (platform.isWindows) {
    await coreAPI.runCommand(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" | Where-Object { $_.CommandLine -match \'camofox\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"',
      { timeout: 10000 },
    );
  } else {
    await coreAPI.runCommand(
      `bash -lc "pkill -f 'camofox-browser' || true; pkill -f 'node .*camofox' || true"`,
      { timeout: 8000 },
    );
  }
  if (onOutput) log(onOutput, '✓ Camofox stopped.');
};

export const pollCamofox = async (timeoutMs = 180000, onOutput?: StreamLogger): Promise<boolean> => {
  // First-run npm install downloads Camoufox (~300MB) so we give it a longer
  // window than a simple service health check would warrant.
  return pollUrl('http://localhost:9377/health', timeoutMs, onOutput);
};

// ─── Chrome detection / install / launch ─────────────────────────────────────

export const detectChrome = async (): Promise<string | null> => {
  const platform = await coreAPI.getPlatform();
  const candidates: string[] = [];
  if (platform.isMac) {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    candidates.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else if (platform.isWindows) {
    candidates.push('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    candidates.push('C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe');
  } else {
    // Linux — probe via `which`
    for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome']) {
      const r = await coreAPI.runCommand(`command -v ${bin}`, { timeout: 5000 });
      if (r.success && r.stdout.trim()) return r.stdout.trim();
    }
    return null;
  }

  for (const path of candidates) {
    if (await coreAPI.fileExists(path)) return path;
  }
  return null;
};

export const installChrome = async (
  onOutput: StreamLogger | undefined,
  sudoPassword: string | null,
): Promise<CommandResult> => {
  const platform = await coreAPI.getPlatform();

  if (platform.isMac) {
    const brew = await coreAPI.runCommand('command -v brew', { timeout: 8000 });
    if (brew.success && brew.stdout.trim()) {
      log(onOutput, '✓ Homebrew found — installing Google Chrome via brew…');
      return coreAPI.runCommandStream('brew install --cask google-chrome', { timeout: 900000 }, onOutput);
    }
    log(onOutput, '⚠ Homebrew not found. Downloading the official Chrome installer…');
    const dmgUrl = 'https://dl.google.com/chrome/mac/stable/GGRO/googlechrome.dmg';
    const dl = await coreAPI.runCommandStream(
      `bash -lc "mkdir -p $HOME/Downloads && curl -L --fail -o $HOME/Downloads/GoogleChrome.dmg '${dmgUrl}' && open $HOME/Downloads/GoogleChrome.dmg"`,
      { timeout: 900000 },
      onOutput,
    );
    if (dl.success) log(onOutput, 'ℹ Drag Google Chrome into Applications, then click "I installed Chrome" below.');
    return dl;
  }

  if (platform.isWindows) {
    log(onOutput, 'Installing Google Chrome via winget (UAC prompt may appear)…');
    return coreAPI.runCommandStream(
      'winget install --id Google.Chrome -e --accept-package-agreements --accept-source-agreements',
      { timeout: 1200000 },
      onOutput,
    );
  }

  // Linux
  if (sudoPassword === null) {
    return { success: false, stdout: '', stderr: 'sudo password required to install Chrome', code: 1 };
  }
  log(onOutput, 'Downloading Google Chrome .deb…');
  const dl = await coreAPI.runCommandStream(
    'bash -lc "curl -L --fail -o /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb"',
    { timeout: 600000 },
    onOutput,
  );
  if (!dl.success) return dl;
  log(onOutput, 'Installing google-chrome-stable via apt…');
  // Use sudoAPI to install the local .deb (apt handles .deb paths).
  const inst = await sudoAPI.aptInstall(['/tmp/google-chrome.deb'], sudoPassword);
  log(onOutput, inst.stdout || '');
  if (inst.stderr) log(onOutput, inst.stderr, 'stderr');
  return inst;
};

// Track the spawned Chrome stream so we can stop it later.
let launchedChromeStreamId: string | null = null;

export const launchChromeWithCdp = async (
  chromePath: string,
  port: number,
  onOutput?: StreamLogger,
): Promise<CommandResult> => {
  const platform = await coreAPI.getPlatform();
  const dataDir = platform.isWindows ? '%USERPROFILE%\\.ronbot-chrome' : '$HOME/.ronbot-chrome';

  // Quote path for the OS shell.
  const quotedPath = platform.isWindows
    ? `"${chromePath}"`
    : `"${chromePath.replace(/"/g, '\\"')}"`;

  const cmd = platform.isWindows
    ? `cmd /c start "" ${quotedPath} --remote-debugging-port=${port} --user-data-dir="${dataDir}" --no-first-run --no-default-browser-check`
    : `bash -lc 'nohup ${quotedPath} --remote-debugging-port=${port} --user-data-dir="${dataDir}" --no-first-run --no-default-browser-check > /tmp/ronbot-chrome.log 2>&1 &'`;

  log(onOutput, `Launching Chrome with CDP on port ${port}…`);
  // Fire-and-forget — Chrome runs detached.
  const result = await coreAPI.runCommandStream(
    cmd,
    {
      timeout: 15000,
      onStreamId: (id) => {
        launchedChromeStreamId = id;
      },
    },
    onOutput,
  );
  return result;
};

export const stopLaunchedChrome = async (onOutput?: StreamLogger): Promise<void> => {
  const platform = await coreAPI.getPlatform();
  if (launchedChromeStreamId) {
    await coreAPI.killStream(launchedChromeStreamId);
    launchedChromeStreamId = null;
  }
  // Best-effort kill of any Chrome we launched with our user-data-dir.
  if (platform.isWindows) {
    await coreAPI.runCommand(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'chrome.exe\'\\" | Where-Object { $_.CommandLine -match \'.ronbot-chrome\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"',
      { timeout: 10000 },
    );
  } else {
    await coreAPI.runCommand(
      `bash -lc "pkill -f -- '--user-data-dir=.*\\.ronbot-chrome' || true"`,
      { timeout: 8000 },
    );
  }
  log(onOutput, '✓ Chrome stopped.');
};

export const pollCdp = async (port: number, timeoutMs = 30000, onOutput?: StreamLogger): Promise<boolean> => {
  return pollUrl(`http://127.0.0.1:${port}/json/version`, timeoutMs, onOutput);
};
