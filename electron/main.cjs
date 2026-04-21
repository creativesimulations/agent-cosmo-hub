const { app, BrowserWindow, ipcMain, safeStorage, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');

// keytar is optional — if it fails to load (e.g. missing libsecret on Linux),
// we gracefully fall back to safeStorage-encrypted file.
let keytar = null;
try {
  keytar = require('keytar');
} catch (e) {
  console.warn('[secrets] keytar unavailable, falling back to safeStorage:', e.message);
}

const KEYCHAIN_SERVICE = 'Ronbot';
// Encrypted secrets store (used when keytar is unavailable)
const SAFESTORAGE_FILE = path.join(os.homedir(), '.ronbot', 'secrets.enc');

// Dedupe a PATH-style string while preserving order. Windows PATHs grow
// huge over time (especially when this app is restarted), and Node's spawn
// fails with ENAMETOOLONG once the combined env block + argv exceeds the
// OS limit (~32 KB on Windows, 128 KB per-string on Linux).
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
      const { execSync } = require('child_process');
      const freshPath = execSync(
        'powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'Path\', \'Machine\') + \';\' + [Environment]::GetEnvironmentVariable(\'Path\', \'User\')"',
        { timeout: 5000 }
      ).toString().trim();

      if (freshPath) {
        env.PATH = freshPath;
        env.Path = freshPath;
      }
    } catch (e) {
      // Fallback: keep the existing PATH
    }
  }

  // Dedupe PATH on every platform — protects against ENAMETOOLONG when the
  // env block balloons (duplicate entries, repeated app launches, etc.)
  if (env.PATH) env.PATH = dedupePath(env.PATH, sep);
  if (env.Path) env.Path = dedupePath(env.Path, sep);

  // Hard cap: if PATH is still pathologically large, truncate to the first
  // 8 KB worth of entries. Better to lose obscure tools than crash the spawn.
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

// ─── App-wide state for run-in-background / tray ───────────
// `runInBackground` is toggled by the renderer via IPC whenever the user
// flips the Settings switch. When true, closing the main window hides it
// to a tray icon instead of quitting — that way `hermes chat`/gateways
// (and queued chat replies) keep running in the background.
let runInBackground = false;
let mainWindow = null;
let tray = null;
let isQuittingForReal = false;

function ensureTray() {
  if (tray) return tray;
  // Platform-appropriate tray icon. On macOS the icon should be a small
  // template image so it tints with the menu bar (light/dark). We render an
  // empty image as a safe default; if a packaged icon is bundled, it will
  // be used instead. On Win/Linux a full-color image is preferred but the
  // empty placeholder still produces a working tray entry.
  let icon = nativeImage.createEmpty();
  try {
    const iconPath = path.join(__dirname, '..', 'public', 'tray-icon.png');
    if (fs.existsSync(iconPath)) {
      icon = nativeImage.createFromPath(iconPath);
      if (process.platform === 'darwin') {
        // Resize for macOS menu bar (16-22pt). Mark as template so macOS
        // tints it automatically based on the active menu bar theme.
        icon = icon.resize({ width: 18, height: 18 });
        icon.setTemplateImage(true);
      }
    }
  } catch { /* fall back to empty image */ }
  tray = new Tray(icon);
  tray.setToolTip('Ronbot — agent running in background');
  const menu = Menu.buildFromTemplate([
    { label: 'Open Ronbot', click: () => showMainWindow() },
    { type: 'separator' },
    {
      label: 'Quit Ronbot (stops the agent)',
      click: () => {
        isQuittingForReal = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => showMainWindow());
  return tray;
}

function showMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#050714',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  mainWindow.on('close', (event) => {
    if (isQuittingForReal) return;
    // macOS convention: closing the window keeps the app alive in the Dock,
    // matching every other Mac app. Win/Linux only persist when the user
    // has explicitly enabled "Run in background" so the tray icon appears.
    if (process.platform === 'darwin') {
      event.preventDefault();
      mainWindow.hide();
      if (runInBackground) ensureTray();
      return;
    }
    if (runInBackground) {
      event.preventDefault();
      mainWindow.hide();
      ensureTray();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── IPC Handlers ─────────────────────────────────────────────

// Run a command and return stdout/stderr when complete
ipcMain.handle('run-command', async (_event, cmd, options = {}) => {
  return new Promise((resolve) => {
    const env = buildCommandEnv(options.env || {});
    const opts = {
      timeout: options.timeout || 60000,
      cwd: options.cwd || os.homedir(),
      shell: true,
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

// Run a command with streaming output
ipcMain.handle('run-command-stream', async (event, cmd, options = {}) => {
  return new Promise((resolve) => {
    const streamId = options.streamId;
    const timeoutMs = options.timeout || 60000;
    const opts = {
      cwd: options.cwd || os.homedir(),
      shell: true,
      env: buildCommandEnv(options.env || {}),
      windowsHide: true,
    };
    const child = spawn(cmd, [], opts);
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
          event.sender.send('command-output', {
            streamId,
            type: 'stderr',
            data: `[process] Command timed out after ${timeoutMs}ms\n`,
          });

          try {
            child.kill('SIGTERM');
          } catch (e) {
            // Best effort
          }

          setTimeout(() => {
            if (!child.killed) {
              try {
                child.kill('SIGKILL');
              } catch (e) {
                // Best effort
              }
            }
          }, 2000);
        }, timeoutMs)
      : null;

    child.stdout.on('data', (data) => {
      event.sender.send('command-output', {
        streamId,
        type: 'stdout',
        data: data.toString(),
      });
    });

    child.stderr.on('data', (data) => {
      event.sender.send('command-output', {
        streamId,
        type: 'stderr',
        data: data.toString(),
      });
    });

    child.on('close', (code) => {
      event.sender.send('command-output', {
        streamId,
        type: 'exit',
        code: timedOut ? 124 : (code ?? 0),
      });
      finish({ success: !timedOut && code === 0, code: timedOut ? 124 : (code ?? 0) });
    });

    child.on('error', (err) => {
      event.sender.send('command-output', {
        streamId,
        type: 'stderr',
        data: `[process] ${err.message}\n`,
      });
      finish({ success: false, code: 1 });
    });
  });
});

// Get platform info
ipcMain.handle('get-platform', async () => {
  const platform = os.platform(); // 'win32', 'darwin', 'linux'
  const arch = os.arch();
  const release = os.release();
  const isWSL = platform === 'linux' && fs.existsSync('/proc/version') &&
    fs.readFileSync('/proc/version', 'utf-8').toLowerCase().includes('microsoft');

  return {
    platform,
    arch,
    release,
    isWSL,
    isWindows: platform === 'win32',
    isMac: platform === 'darwin',
    isLinux: platform === 'linux' && !isWSL,
    homeDir: os.homedir(),
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
  };
});

// File system operations
ipcMain.handle('file-exists', async (_event, filePath) => {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('read-file', async (_event, filePath) => {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return { success: true, content };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('write-file', async (_event, filePath, content, options = {}) => {
  try {
    await fs.promises.writeFile(filePath, content, 'utf-8');
    // Apply restrictive permissions if requested (POSIX only — chmod is a no-op on Windows)
    if (options.mode && process.platform !== 'win32') {
      try { await fs.promises.chmod(filePath, options.mode); } catch { /* best effort */ }
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('mkdir', async (_event, dirPath) => {
  try {
    await fs.promises.mkdir(dirPath, { recursive: true });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Get free/total bytes on the drive that holds the home directory.
// On Windows we query C: (or whatever drive homedir is on). On *nix, df -k /.
ipcMain.handle('get-disk-space', async () => {
  return new Promise((resolve) => {
    try {
      if (process.platform === 'win32') {
        // Determine drive letter from homedir, default to C:
        const drive = (os.homedir().match(/^([A-Za-z]):/) || [, 'C'])[1] + ':';
        const cmd = `wmic logicaldisk where "DeviceID='${drive}'" get FreeSpace,Size /format:value`;
        exec(cmd, { timeout: 8000, windowsHide: true }, (err, stdout) => {
          if (err) return resolve({ success: false, error: err.message });
          const free = parseInt((stdout.match(/FreeSpace=(\d+)/) || [])[1] || '0', 10);
          const total = parseInt((stdout.match(/Size=(\d+)/) || [])[1] || '0', 10);
          resolve({ success: true, drive, freeBytes: free, totalBytes: total });
        });
      } else {
        // df -kP / → portable; second line, columns: Filesystem 1024-blocks Used Available ...
        exec(`df -kP "${os.homedir()}"`, { timeout: 8000 }, (err, stdout) => {
          if (err) return resolve({ success: false, error: err.message });
          const lines = stdout.trim().split('\n');
          const cols = (lines[1] || '').split(/\s+/);
          const totalBytes = (parseInt(cols[1], 10) || 0) * 1024;
          const freeBytes = (parseInt(cols[3], 10) || 0) * 1024;
          resolve({ success: true, drive: '/', freeBytes, totalBytes });
        });
      }
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  });
});

// ─── Secrets storage ──────────────────────────────────────────
// Three-tier storage with graceful degradation:
//   1. OS keychain (keytar)        → preferred
//   2. safeStorage encrypted file  → fallback
//   3. plaintext .env              → legacy / migration target only
//
// The renderer never sees raw values until it explicitly asks via 'secrets-get'.

function backendInfo() {
  if (keytar) return { backend: 'keychain', label: keychainLabel() };
  if (safeStorage.isEncryptionAvailable()) return { backend: 'safestorage', label: safeStorageLabel() };
  return { backend: 'plaintext', label: 'Plaintext file (insecure fallback)' };
}

function keychainLabel() {
  if (process.platform === 'darwin') return 'macOS Keychain';
  if (process.platform === 'win32') return 'Windows Credential Manager';
  return 'System Keyring (libsecret)';
}

function safeStorageLabel() {
  if (process.platform === 'darwin') return 'Encrypted (Keychain-derived key)';
  if (process.platform === 'win32') return 'Encrypted (DPAPI)';
  return 'Encrypted (safeStorage)';
}

// safeStorage file format: JSON map of key → base64(safeStorage.encryptString(value))
async function readSafeStorageFile() {
  try {
    const buf = await fs.promises.readFile(SAFESTORAGE_FILE, 'utf-8');
    return JSON.parse(buf);
  } catch {
    return {};
  }
}

async function writeSafeStorageFile(map) {
  await fs.promises.mkdir(path.dirname(SAFESTORAGE_FILE), { recursive: true });
  await fs.promises.writeFile(SAFESTORAGE_FILE, JSON.stringify(map, null, 2), 'utf-8');
  if (process.platform !== 'win32') {
    try { await fs.promises.chmod(SAFESTORAGE_FILE, 0o600); } catch { /* best effort */ }
  }
}

ipcMain.handle('secrets-backend', async () => backendInfo());

ipcMain.handle('secrets-list', async () => {
  // Returns list of { key, backend } — never values
  if (keytar) {
    try {
      const items = await keytar.findCredentials(KEYCHAIN_SERVICE);
      return { success: true, backend: 'keychain', keys: items.map((i) => i.account) };
    } catch (e) {
      return { success: false, error: e.message, keys: [] };
    }
  }
  if (safeStorage.isEncryptionAvailable()) {
    const map = await readSafeStorageFile();
    return { success: true, backend: 'safestorage', keys: Object.keys(map) };
  }
  return { success: true, backend: 'plaintext', keys: [] };
});

ipcMain.handle('secrets-get', async (_event, key) => {
  if (keytar) {
    try {
      const v = await keytar.getPassword(KEYCHAIN_SERVICE, key);
      return { success: true, value: v ?? '' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  if (safeStorage.isEncryptionAvailable()) {
    const map = await readSafeStorageFile();
    const enc = map[key];
    if (!enc) return { success: true, value: '' };
    try {
      const value = safeStorage.decryptString(Buffer.from(enc, 'base64'));
      return { success: true, value };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  return { success: false, error: 'No secure storage available' };
});

ipcMain.handle('secrets-set', async (_event, key, value) => {
  if (keytar) {
    try {
      await keytar.setPassword(KEYCHAIN_SERVICE, key, value);
      return { success: true, backend: 'keychain' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  if (safeStorage.isEncryptionAvailable()) {
    const map = await readSafeStorageFile();
    map[key] = safeStorage.encryptString(value).toString('base64');
    await writeSafeStorageFile(map);
    return { success: true, backend: 'safestorage' };
  }
  return { success: false, error: 'No secure storage available' };
});

ipcMain.handle('secrets-delete', async (_event, key) => {
  if (keytar) {
    try {
      await keytar.deletePassword(KEYCHAIN_SERVICE, key);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  if (safeStorage.isEncryptionAvailable()) {
    const map = await readSafeStorageFile();
    delete map[key];
    await writeSafeStorageFile(map);
    return { success: true };
  }
  return { success: false, error: 'No secure storage available' };
});

// Materialize all stored secrets into ~/.hermes/.env (chmod 600).
// Called right before launching the agent. Merges with any existing
// non-secret entries already in the file.
ipcMain.handle('secrets-materialize-env', async (_event, envPath) => {
  try {
    const target = envPath || path.join(os.homedir(), '.hermes', '.env');
    await fs.promises.mkdir(path.dirname(target), { recursive: true });

    // Collect all secrets
    let entries = {};
    if (keytar) {
      const items = await keytar.findCredentials(KEYCHAIN_SERVICE);
      for (const it of items) entries[it.account] = it.password;
    } else if (safeStorage.isEncryptionAvailable()) {
      const map = await readSafeStorageFile();
      for (const [k, enc] of Object.entries(map)) {
        try { entries[k] = safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { /* skip */ }
      }
    }

    // Preserve any existing non-secret entries (comments, non-managed keys)
    let preserved = '';
    try {
      const existing = await fs.promises.readFile(target, 'utf-8');
      const lines = existing.split('\n').filter((line) => {
        const t = line.trim();
        if (!t || t.startsWith('#')) return true;
        const eq = t.indexOf('=');
        if (eq < 0) return true;
        const key = t.substring(0, eq).trim();
        return !(key in entries);
      });
      preserved = lines.join('\n').replace(/\n+$/, '');
    } catch { /* file doesn't exist yet */ }

    const managed = Object.entries(entries)
      .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`)
      .join('\n');

    const content =
      (preserved ? preserved + '\n' : '') +
      '# ─── Managed by Ronbot (do not edit by hand) ───\n' +
      managed + '\n';

    await fs.promises.writeFile(target, content, 'utf-8');
    if (process.platform !== 'win32') {
      try { await fs.promises.chmod(target, 0o600); } catch { /* best effort */ }
    }
    return { success: true, count: Object.keys(entries).length, path: target };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// One-shot migration: read plaintext ~/.hermes/.env → push all keys into
// secure storage → rewrite the .env via materialize. Safe to call repeatedly.
ipcMain.handle('secrets-migrate-from-env', async (_event, envPath) => {
  try {
    const target = envPath || path.join(os.homedir(), '.hermes', '.env');
    let content = '';
    try { content = await fs.promises.readFile(target, 'utf-8'); }
    catch { return { success: true, migrated: 0 }; }

    const migrated = [];
    for (const line of content.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 1) continue;
      const key = t.substring(0, eq).trim();
      let value = t.substring(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // Push into secure storage
      if (keytar) {
        try { await keytar.setPassword(KEYCHAIN_SERVICE, key, value); migrated.push(key); } catch { /* skip */ }
      } else if (safeStorage.isEncryptionAvailable()) {
        const map = await readSafeStorageFile();
        map[key] = safeStorage.encryptString(value).toString('base64');
        await writeSafeStorageFile(map);
        migrated.push(key);
      }
    }
    return { success: true, migrated: migrated.length, keys: migrated };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Renderer toggles "Keep agent running when window is closed" — when ON we
// hide to tray on close instead of quitting. When OFF, we destroy the tray
// and quit on the next window close.
ipcMain.handle('set-run-in-background', async (_event, enabled) => {
  runInBackground = !!enabled;
  if (!runInBackground && tray) {
    try { tray.destroy(); } catch { /* best effort */ }
    tray = null;
  }
  return { success: true, runInBackground };
});

// Force-quit from the renderer (used by the "Quit Ronbot" Settings button).
ipcMain.handle('quit-app', async () => {
  isQuittingForReal = true;
  app.quit();
  return { success: true };
});

// ─── App Lifecycle ────────────────────────────────────────────

app.on('before-quit', () => { isQuittingForReal = true; });

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });
});

app.on('window-all-closed', () => {
  // When run-in-background is on, the main window only ever hides — so this
  // handler won't fire. If the user explicitly closed everything (e.g. tray
  // "Quit"), respect platform conventions.
  if (runInBackground && !isQuittingForReal) return;
  if (process.platform !== 'darwin') app.quit();
});
