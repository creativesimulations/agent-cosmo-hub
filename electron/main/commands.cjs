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

function registerCommandHandlers(ipcMain, IPC) {
  const liveStreams = new Map();

  ipcMain.handle(IPC.RUN_COMMAND, async (_event, cmd, options = {}) => {
    return new Promise((resolve) => {
      const env = buildCommandEnv(options.env || {});
      const shellOverride = process.platform === 'win32' ? true : '/bin/bash';
      const timeoutMs = options.timeout ?? 60000;
      const opts = {
        timeout: timeoutMs,
        cwd: options.cwd || os.homedir(),
        shell: shellOverride,
        env,
      };
      exec(cmd, opts, (error, stdout, stderr) => {
        resolve({
          success: !error,
          stdout: stdout?.toString() || '',
          stderr: stderr?.toString() || '',
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
          try { child.kill('SIGTERM'); } catch { /* best effort */ }
          setTimeout(() => {
            if (!child.killed) {
              try { child.kill('SIGKILL'); } catch { /* best effort */ }
            }
          }, 2000);
        }, timeoutMs)
        : null;

      child.stdout.on('data', (data) => {
        event.sender.send(IPC.COMMAND_OUTPUT, {
          streamId,
          type: 'stdout',
          data: data.toString(),
        });
      });

      child.stderr.on('data', (data) => {
        event.sender.send(IPC.COMMAND_OUTPUT, {
          streamId,
          type: 'stderr',
          data: data.toString(),
        });
      });

      child.on('close', (code) => {
        if (streamId) liveStreams.delete(streamId);
        event.sender.send(IPC.COMMAND_OUTPUT, {
          streamId,
          type: 'exit',
          code: timedOut ? 124 : (code ?? 0),
        });
        finish({ success: !timedOut && code === 0, code: timedOut ? 124 : (code ?? 0) });
      });

      child.on('error', (err) => {
        if (streamId) liveStreams.delete(streamId);
        event.sender.send(IPC.COMMAND_OUTPUT, {
          streamId,
          type: 'stderr',
          data: `[process] ${err.message}\n`,
        });
        finish({ success: false, code: 1 });
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
      child.kill('SIGTERM');
      setTimeout(() => { try { if (!child.killed) child.kill('SIGKILL'); } catch { /* */ } }, 1500);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

module.exports = {
  registerCommandHandlers,
};
