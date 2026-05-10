'use strict';

const path = require('path');
const fs = require('fs');

function createWindowing(app, BrowserWindow, Tray, Menu, nativeImage, IPC, state) {
  function showMainWindow() {
    if (!state.mainWindow) {
      createWindow();
      return;
    }
    if (state.mainWindow.isMinimized()) state.mainWindow.restore();
    state.mainWindow.show();
    state.mainWindow.focus();
  }

  function rebuildTrayMenu() {
    if (!state.tray) return;
    const statusLabel = state.agentRunning ? '● Agent: ON' : '○ Agent: OFF';
    const toggleLabel = state.agentRunning ? 'Turn Agent Off' : 'Turn Agent On';
    const menu = Menu.buildFromTemplate([
      { label: statusLabel, enabled: false },
      { type: 'separator' },
      { label: 'Open Ronbot', click: () => showMainWindow() },
      {
        label: toggleLabel,
        click: () => {
          state.agentRunning = !state.agentRunning;
          if (state.mainWindow && !state.mainWindow.isDestroyed()) {
            state.mainWindow.webContents.send(IPC.AGENT_RUNNING_CHANGED, state.agentRunning);
          }
          rebuildTrayMenu();
          try {
            state.tray.setToolTip(state.agentRunning
              ? 'Ronbot — agent ON (running in background)'
              : 'Ronbot — agent OFF (idle)');
          } catch { /* best effort */ }
        },
      },
      { type: 'separator' },
      {
        label: 'Quit Ronbot (stops the agent)',
        click: () => {
          state.isQuittingForReal = true;
          app.quit();
        },
      },
    ]);
    state.tray.setContextMenu(menu);
  }

  function loadTrayIcon() {
    const assetDirs = [
      path.join(__dirname, '..', 'assets'),
      path.join(process.resourcesPath || '', 'assets'),
      path.join(process.resourcesPath || '', 'electron', 'assets'),
      path.join(__dirname, '..', '..', 'public'),
      path.join(process.resourcesPath || '', 'public'),
    ];

    let names;
    if (process.platform === 'darwin') {
      names = ['trayTemplate.png', 'tray-icon.png', 'favicon.ico'];
    } else if (process.platform === 'win32') {
      names = ['tray-icon.ico', 'tray-icon.png', 'favicon.ico'];
    } else {
      names = ['tray-icon.png', 'trayTemplate@2x.png', 'favicon.ico'];
    }

    for (const dir of assetDirs) {
      for (const name of names) {
        const p = path.join(dir, name);
        try {
          if (p && fs.existsSync(p)) {
            const img = nativeImage.createFromPath(p);
            if (!img.isEmpty()) return { img, name };
          }
        } catch { /* try next */ }
      }
    }
    return null;
  }

  function ensureTray() {
    if (state.tray) return state.tray;
    const loaded = loadTrayIcon();
    let icon = loaded?.img;
    const name = loaded?.name;
    if (!icon) icon = nativeImage.createEmpty();

    if (!icon.isEmpty()) {
      if (process.platform === 'darwin') {
        icon = icon.resize({ width: 18, height: 18 });
        icon.setTemplateImage(true);
      } else if (process.platform === 'win32') {
        if (name && !name.endsWith('.ico')) icon = icon.resize({ width: 16, height: 16 });
      } else {
        icon = icon.resize({ width: 22, height: 22 });
      }
    }

    try {
      state.tray = new Tray(icon);
    } catch (e) {
      console.warn('[tray] failed to create tray icon:', e.message);
      state.tray = null;
      return null;
    }

    state.tray.setToolTip(state.agentRunning
      ? 'Ronbot — agent ON (running in background)'
      : 'Ronbot — agent OFF (idle)');
    rebuildTrayMenu();
    state.tray.on('click', () => showMainWindow());
    return state.tray;
  }

  function resolveAppIcon() {
    const platform = process.platform;
    const candidates = platform === 'win32'
      ? ['build/icon.ico', 'electron/assets/tray-icon.ico']
      : ['build/icon.png', 'build/icon-512.png', 'electron/assets/tray-icon.png'];
    for (const rel of candidates) {
      const p = path.join(__dirname, '..', '..', rel);
      if (fs.existsSync(p)) return p;
    }
    return undefined;
  }

  function createWindow() {
    const appIcon = resolveAppIcon();
    state.mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1024,
      minHeight: 700,
      titleBarStyle: 'hiddenInset',
      backgroundColor: '#050714',
      autoHideMenuBar: true,
      ...(appIcon ? { icon: appIcon } : {}),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, '..', 'preload.cjs'),
      },
    });

    state.mainWindow.setMenuBarVisibility(false);
    state.mainWindow.setMenu(null);
    state.mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));

    if (state.runInBackground) ensureTray();

    state.mainWindow.on('close', (event) => {
      if (state.isQuittingForReal) return;
      if (process.platform === 'darwin') {
        event.preventDefault();
        state.mainWindow.hide();
        if (state.runInBackground) ensureTray();
        return;
      }
      if (state.runInBackground) {
        event.preventDefault();
        const t = ensureTray();
        if (!t && process.platform === 'linux') {
          state.mainWindow.show();
          return;
        }
        state.mainWindow.hide();

        if (!state.hasShownTrayHint && t) {
          state.hasShownTrayHint = true;
          try {
            if (process.platform === 'win32' && typeof t.displayBalloon === 'function') {
              t.displayBalloon({
                title: 'Ronbot is still running',
                content: 'Right-click the tray icon to open Ronbot or quit it completely.',
              });
            }
          } catch { /* best effort */ }
        }
      }
    });

    state.mainWindow.on('closed', () => {
      state.mainWindow = null;
    });
  }

  return {
    createWindow,
    showMainWindow,
    ensureTray,
    rebuildTrayMenu,
  };
}

module.exports = {
  createWindowing,
};
