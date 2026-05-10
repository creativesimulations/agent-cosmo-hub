'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

function registerFsHandlers(ipcMain, BrowserWindow, dialog, IPC) {
  ipcMain.handle(IPC.GET_PLATFORM, async () => {
    const platform = os.platform();
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

  ipcMain.handle(IPC.FILE_EXISTS, async (_event, filePath) => {
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle(IPC.READ_FILE, async (_event, filePath) => {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return { success: true, content };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle(IPC.WRITE_FILE, async (_event, filePath, content, options = {}) => {
    try {
      await fs.promises.writeFile(filePath, content, 'utf-8');
      if (options.mode && process.platform !== 'win32') {
        try { await fs.promises.chmod(filePath, options.mode); } catch { /* best effort */ }
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle(IPC.MKDIR, async (_event, dirPath) => {
    try {
      await fs.promises.mkdir(dirPath, { recursive: true });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle(IPC.GET_DISK_SPACE, async () => {
    return new Promise((resolve) => {
      try {
        if (process.platform === 'win32') {
          const drive = (os.homedir().match(/^([A-Za-z]):/) || [, 'C'])[1] + ':';
          const cmd = `wmic logicaldisk where "DeviceID='${drive}'" get FreeSpace,Size /format:value`;
          exec(cmd, { timeout: 8000, windowsHide: true }, (err, stdout) => {
            if (err) return resolve({ success: false, error: err.message });
            const free = parseInt((stdout.match(/FreeSpace=(\d+)/) || [])[1] || '0', 10);
            const total = parseInt((stdout.match(/Size=(\d+)/) || [])[1] || '0', 10);
            resolve({ success: true, drive, freeBytes: free, totalBytes: total });
          });
        } else {
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

  ipcMain.handle(IPC.SELECT_FOLDER, async (_event, options = {}) => {
    try {
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      const defaultPath = options.defaultPath || os.homedir();
      const result = win
        ? await dialog.showOpenDialog(win, {
          title: options.title || 'Select a folder',
          defaultPath,
          properties: ['openDirectory', 'createDirectory'],
        })
        : await dialog.showOpenDialog({
          title: options.title || 'Select a folder',
          defaultPath,
          properties: ['openDirectory', 'createDirectory'],
        });
      if (result.canceled || !result.filePaths.length) {
        return { success: true, canceled: true };
      }
      let chosen = result.filePaths[0];
      const home = os.homedir();
      if (chosen === home) chosen = '~';
      else if (chosen.startsWith(home + path.sep)) chosen = '~' + chosen.slice(home.length);
      return { success: true, canceled: false, path: chosen };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

module.exports = {
  registerFsHandlers,
};
