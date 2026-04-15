const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');

function createWindow() {
  const mainWindow = new BrowserWindow({
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
}

// ─── IPC Handlers ─────────────────────────────────────────────

// Run a command and return stdout/stderr when complete
ipcMain.handle('run-command', async (_event, cmd, options = {}) => {
  return new Promise((resolve) => {
    const opts = {
      timeout: options.timeout || 60000,
      cwd: options.cwd || os.homedir(),
      shell: true,
      env: { ...process.env, ...options.env },
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
    const opts = {
      cwd: options.cwd || os.homedir(),
      shell: true,
      env: { ...process.env, ...options.env },
    };
    const child = spawn(cmd, [], opts);
    const streamId = options.streamId;

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
        code,
      });
      resolve({ success: code === 0, code });
    });

    child.on('error', (err) => {
      resolve({ success: false, error: err.message });
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

ipcMain.handle('write-file', async (_event, filePath, content) => {
  try {
    await fs.promises.writeFile(filePath, content, 'utf-8');
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

// ─── App Lifecycle ────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
