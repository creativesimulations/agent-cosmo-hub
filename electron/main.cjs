const { app, BrowserWindow, ipcMain, safeStorage, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const IPC = require(path.join(__dirname, 'ipc', 'channels.cjs'));
const state = require(path.join(__dirname, 'main', 'state.cjs'));
const { createWindowing } = require(path.join(__dirname, 'main', 'windowing.cjs'));
const { registerCommandHandlers } = require(path.join(__dirname, 'main', 'commands.cjs'));
const { registerFsHandlers } = require(path.join(__dirname, 'main', 'fs.cjs'));
const { registerSecretsHandlers } = require(path.join(__dirname, 'main', 'secrets.cjs'));
const { registerControlHandlers } = require(path.join(__dirname, 'main', 'control.cjs'));
const { createProcessCleanup } = require(path.join(__dirname, 'main', 'processCleanup.cjs'));

const windowing = createWindowing(app, BrowserWindow, Tray, Menu, nativeImage, IPC, state);

const commandRuntime = registerCommandHandlers(ipcMain, IPC);
registerFsHandlers(ipcMain, BrowserWindow, dialog, IPC);
registerSecretsHandlers(ipcMain, safeStorage, IPC);
registerControlHandlers(ipcMain, app, IPC, state, windowing.rebuildTrayMenu);
const processCleanup = createProcessCleanup(commandRuntime);

app.on('before-quit', (event) => {
  state.isQuittingForReal = true;
  if (!processCleanup.shouldBlockQuit()) return;
  event.preventDefault();
  if (processCleanup.isQuitCleanupStarted()) return;
  processCleanup.cleanupOnQuit().finally(() => app.quit());
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  windowing.showMainWindow();
});

app.whenReady().then(async () => {
  await processCleanup.cleanupOnStartup().catch((error) => {
    console.warn('[cleanup] startup cleanup failed:', error?.message || error);
  });
  if (process.platform !== 'darwin') {
    try { Menu.setApplicationMenu(null); } catch { /* best effort */ }
  }
  if (process.platform === 'darwin' && app.dock) {
    try {
      const dockIconPath = path.join(__dirname, '..', 'build', 'icon.png');
      if (fs.existsSync(dockIconPath)) {
        app.dock.setIcon(nativeImage.createFromPath(dockIconPath));
      }
    } catch { /* best effort */ }
  }
  windowing.createWindow();
  windowing.ensureTray();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) windowing.createWindow();
    else windowing.showMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (state.runInBackground && !state.isQuittingForReal) return;
  if (process.platform !== 'darwin') app.quit();
});
