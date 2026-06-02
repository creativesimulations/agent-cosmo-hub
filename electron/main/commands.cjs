'use strict';

const os = require('os');
const { exec, spawn, execSync } = require('child_process');

// Dedupe a PATH-style string while preserving order.
function dedupePath(value, sep) {
  if (!value) return value;
  const seen = new Set();
  const out = [];
  for (const raw of value.split(sep)) {
    const part = raw.trim();
    if (!part) continue;
    const key = process.platform === 'win32' ? part.toLowerCase() : part;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(part);
  }
  return out.join(sep);
}

function buildCommandEnv(extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  const sep = process.platform === 'win32' ? ';' : ':';

  if (process.platform === 'win32') {
    try {
      const freshPath = execSync(
        'powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'Path\', \'Machine\') + \';\' + [Environment]::GetEnvironmentVariable(\'Path\', \'User\')"',
        { timeout: 5000 },
      ).toString().trim();
      if (freshPath) {
        env.PATH = freshPath;
        env.Path = freshPath;
      }
    } catch {
      // Best effort: fallback to current PATH.
    }
  }

  if (env.PATH) env.PATH = dedupePath(env.PATH, sep);
  if (env.Path) env.Path = dedupePath(env.Path, sep);

  const MAX_PATH_BYTES = 8192;
  if (env.PATH && Buffer.byteLength(env.PATH, 'utf8') > MAX_PATH_BYTES) {
    const parts = env.PATH.split(sep);
    const kept = [];
    let bytes = 0;
    for (const p of parts) {
      const add = Buffer.byteLength(p, 'utf8') + 1;
      if (bytes + add > MAX_PATH_BYTES) break;
      kept.push(p);
      bytes += add;
    }
    env.PATH = kept.join(sep);
    if (env.Path) env.Path = env.PATH;
  }

  return env;
}

/**
 * Force wsl.exe to emit UTF-8 instead of UTF-16LE for its own management
 * output (`wsl --status`, `wsl -l -v`, etc.). Without this, the regex
 * parsing in checkWSL() never matches because every character is followed
 * by a null byte. Supported in WSL >= 0.64.16.
 * Only applies to commands that invoke wsl directly for management — does
 * NOT affect `wsl bash -lc "..."` payloads, which output normal UTF-8 from
 * Linux processes.
 */
function isWslManagementCommand(cmd) {
  if (typeof cmd !== 'string') return false;
  const trimmed = cmd.trim();
  if (!/^wsl(\.exe)?(\s|$)/i.test(trimmed)) return false;
  // wsl bash -lc "..." is a Linux payload — Linux already emits UTF-8.
  if (/^wsl(\.exe)?\s+(bash|sh|--exec|-e|-d\s+\S+\s+bash)/i.test(trimmed)) return false;
  return true;
}

/** Strip UTF-16 BOM and interleaved null bytes that leak through when WSL_UTF8 is unsupported. */
function sanitizeWslOutput(text) {
  if (!text) return text;
  // If every other byte is 0x00, treat as UTF-16LE and decode.
  if (text.includes('\u0000')) {
    try {
      const buf = Buffer.from(text, 'binary');
      // Drop BOM
      const offset = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe ? 2 : 0;
      const decoded = buf.slice(offset).toString('utf16le');
      // Only use decoded form if it looks saner (fewer null bytes).
      if (!decoded.includes('\u0000')) return decoded;
    } catch {
      /* fall through */
    }
    return text.replace(/\u0000/g, '');
  }
  return text;
}

function registerCommandHandlers(ipcMain, IPC) {
  const liveStreams = new Map();

  function terminateChildTree(child) {
    if (!child || child.killed) return;
    if (process.platform === 'win32' && child.pid) {
      exec(`taskkill /pid ${child.pid} /T /F`, { windowsHide: true }, () => {
        try { if (!child.killed) child.kill('SIGKILL'); } catch { /* best effort */ }
      });
      return;
    }
    try { child.kill('SIGTERM'); } catch { /* best effort */ }
    setTimeout(() => {
      try { if (!child.killed) child.kill('SIGKILL'); } catch { /* best effort */ }
    }, 2000);
  }

  ipcMain.handle(IPC.RUN_COMMAND, async (_event, cmd, options = {}) => {
    return new Promise((resolve) => {
      const isWslMgmt = isWslManagementCommand(cmd);
      const env = buildCommandEnv({
        ...(isWslMgmt ? { WSL_UTF8: '1' } : {}),
        ...(options.env || {}),
      });
      const shellOverride = process.platform === 'win32' ? true : '/bin/bash';
      const timeoutMs = options.timeout ?? 60000;
      const opts = {
        timeout: timeoutMs,
        cwd: options.cwd || os.homedir(),
        shell: shellOverride,
        env,
      };
      exec(cmd, opts, (error, stdout, stderr) => {
        let outStr = stdout?.toString() || '';
        let errStr = stderr?.toString() || '';
        if (isWslMgmt) {
          outStr = sanitizeWslOutput(outStr);
          errStr = sanitizeWslOutput(errStr);
        }
        resolve({
          success: !error,
          stdout: outStr,
          stderr: errStr,
          code: error?.code || 0,
        });
      });
    });
  });

  ipcMain.handle(IPC.RUN_COMMAND_STREAM, async (event, cmd, options = {}) => {
    return new Promise((resolve) => {
      const streamId = options.streamId;
      const timeoutMs = options.timeout ?? 60000;
      const shellOverride = process.platform === 'win32' ? true : '/bin/bash';
      const opts = {
        cwd: options.cwd || os.homedir(),
        shell: shellOverride,
        env: buildCommandEnv(options.env || {}),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      };
      const child = spawn(cmd, [], opts);
      if (streamId) liveStreams.set(streamId, child);
      let settled = false;
      let timedOut = false;
      let collectedStdout = '';
      let collectedStderr = '';

      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(result);
      };

      const timer = timeoutMs > 0
        ? setTimeout(() => {
          timedOut = true;
          event.sender.send(IPC.COMMAND_OUTPUT, {
            streamId,
            type: 'stderr',
            data: `[process] Command timed out after ${timeoutMs}ms\n`,
          });
          terminateChildTree(child);
        }, timeoutMs)
        : null;

      child.stdout.on('data', (data) => {
        const chunk = data.toString();
        collectedStdout += chunk;
        event.sender.send(IPC.COMMAND_OUTPUT, {
          streamId,
          type: 'stdout',
          data: chunk,
        });
      });

      child.stderr.on('data', (data) => {
        const chunk = data.toString();
        collectedStderr += chunk;
        event.sender.send(IPC.COMMAND_OUTPUT, {
          streamId,
          type: 'stderr',
          data: chunk,
        });
      });

      child.on('close', (code) => {
        if (streamId) liveStreams.delete(streamId);
        event.sender.send(IPC.COMMAND_OUTPUT, {
          streamId,
          type: 'exit',
          code: timedOut ? 124 : (code ?? 0),
        });
        finish({
          success: !timedOut && code === 0,
          code: timedOut ? 124 : (code ?? 0),
          stdout: collectedStdout,
          stderr: collectedStderr,
        });
      });

      child.on('error', (err) => {
        if (streamId) liveStreams.delete(streamId);
        event.sender.send(IPC.COMMAND_OUTPUT, {
          streamId,
          type: 'stderr',
          data: `[process] ${err.message}\n`,
        });
        finish({ success: false, code: 1, stdout: collectedStdout, stderr: `${collectedStderr}[process] ${err.message}\n` });
      });
    });
  });

  ipcMain.handle(IPC.WRITE_STREAM_STDIN, async (_event, streamId, data) => {
    const child = liveStreams.get(streamId);
    if (!child || !child.stdin || child.stdin.destroyed) {
      return { success: false, error: 'stream not found or stdin closed' };
    }
    try {
      child.stdin.write(typeof data === 'string' ? data : String(data ?? ''));
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle(IPC.KILL_STREAM, async (_event, streamId) => {
    const child = liveStreams.get(streamId);
    if (!child) return { success: false, error: 'stream not found' };
    try {
      terminateChildTree(child);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  return {
    terminateAllStreams() {
      for (const child of liveStreams.values()) terminateChildTree(child);
      liveStreams.clear();
    },
  };
}

module.exports = {
  registerCommandHandlers,
};
