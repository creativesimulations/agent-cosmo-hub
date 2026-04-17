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
    // Refresh PATH on Windows so newly installed programs are found
    let env = { ...process.env, ...options.env };
    if (process.platform === 'win32') {
      try {
        const { execSync } = require('child_process');
        const freshPath = execSync('powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'Path\', \'Machine\') + \';\' + [Environment]::GetEnvironmentVariable(\'Path\', \'User\')"', { timeout: 5000 }).toString().trim();
        if (freshPath) {
          env.PATH = freshPath;
          env.Path = freshPath;
        }
      } catch (e) {
        // Fallback: use existing PATH
      }
    }
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
