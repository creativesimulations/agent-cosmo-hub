'use strict';

const { exec } = require('child_process');

const HERMES_PATH_EXPORT =
  'export PATH="$HOME/.hermes/venv/bin:$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:/snap/bin:$PATH"';

function execQuiet(command, timeout = 8000) {
  return new Promise((resolve) => {
    exec(command, { timeout, windowsHide: true }, () => resolve());
  });
}

function execCapture(command, timeout = 8000) {
  return new Promise((resolve) => {
    exec(command, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 }, (_err, stdout) => {
      resolve(stdout?.toString() || '');
    });
  });
}

function decodeInlineBashPayload(commandLine) {
  const match = String(commandLine || '').match(/\becho\s+([A-Za-z0-9+/=]{40,})\s+\|\s+base64\s+-d\s+\|\s+bash\b/);
  if (!match) return '';
  try {
    return Buffer.from(match[1], 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function isRonbotManagedCommand(commandLine) {
  const line = String(commandLine || '');
  if (line.includes('RONBOT_MANAGED_PROCESS=1')) return true;
  if (!/\bwsl(?:\.exe)?\b/i.test(line) || !/\bbase64\s+-d\s+\|\s+bash\b/.test(line)) return false;

  const decoded = decodeInlineBashPayload(line);
  return [
    'RONBOT_MANAGED_PROCESS=1',
    'hermes-agent/main/scripts/install.sh',
    '$HOME/.hermes',
    'HERMES_HOME=',
    'ronbot-',
  ].some((needle) => decoded.includes(needle));
}

async function listWindowsProcesses() {
  const ps = [
    'Get-CimInstance Win32_Process',
    "| Where-Object { $_.Name -in @('wsl.exe','bash.exe','node.exe','python.exe') }",
    '| Select-Object ProcessId,ParentProcessId,Name,CommandLine',
    '| ConvertTo-Json -Depth 2',
  ].join(' ');
  const stdout = await execCapture(`powershell -NoProfile -Command "${ps}"`);
  if (!stdout.trim()) return [];
  try {
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

async function terminateWindowsProcessTree(pid) {
  if (!pid || Number(pid) === process.pid) return;
  await execQuiet(`taskkill /pid ${Number(pid)} /T /F`, 8000);
}

async function cleanupWindowsOrphans() {
  const processes = await listWindowsProcesses();
  const matches = processes.filter((p) => isRonbotManagedCommand(p.CommandLine));
  for (const proc of matches) {
    await terminateWindowsProcessTree(proc.ProcessId);
  }
}

async function cleanupPosixOrphans() {
  await execQuiet(`pkill -TERM -f 'RONBOT_MANAGED_PROCESS=1' 2>/dev/null || true`, 5000);
  await execQuiet(`pkill -KILL -f 'RONBOT_MANAGED_PROCESS=1' 2>/dev/null || true`, 5000);
}

async function stopHermesRuntime() {
  const script = [
    HERMES_PATH_EXPORT,
    'if command -v hermes >/dev/null 2>&1; then',
    '  hermes gateway stop 2>/dev/null || true',
    'fi',
    'pkill -f "[h]ermes chat" 2>/dev/null || true',
    'pkill -f "[h]ermes gateway" 2>/dev/null || true',
  ].join('; ');
  const escaped = script.replace(/"/g, '\\"');
  const cmd = process.platform === 'win32'
    ? `wsl bash -lc "${escaped}"`
    : `bash -lc "${escaped}"`;
  await execQuiet(cmd, 12000);
}

function createProcessCleanup(commandRuntime) {
  let quitCleanupStarted = false;
  let quitCleanupComplete = false;

  async function cleanupOrphans() {
    if (process.platform === 'win32') await cleanupWindowsOrphans();
    else await cleanupPosixOrphans();
  }

  async function cleanupOnStartup() {
    await cleanupOrphans();
    await stopHermesRuntime();
  }

  async function cleanupOnQuit() {
    if (quitCleanupComplete) return;
    quitCleanupStarted = true;
    commandRuntime?.terminateAllStreams?.();
    await cleanupOrphans();
    await stopHermesRuntime();
    quitCleanupComplete = true;
  }

  function shouldBlockQuit() {
    return !quitCleanupComplete;
  }

  function isQuitCleanupStarted() {
    return quitCleanupStarted;
  }

  return {
    cleanupOnStartup,
    cleanupOnQuit,
    shouldBlockQuit,
    isQuitCleanupStarted,
  };
}

module.exports = {
  createProcessCleanup,
  isRonbotManagedCommand,
};
