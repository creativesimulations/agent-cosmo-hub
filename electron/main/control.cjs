'use strict';

function registerControlHandlers(ipcMain, app, IPC, state, rebuildTrayMenu) {
  ipcMain.handle(IPC.SET_RUN_IN_BACKGROUND, async (_event, enabled) => {
    state.runInBackground = !!enabled;
    if (!state.runInBackground && state.tray) {
      try { state.tray.destroy(); } catch { /* best effort */ }
      state.tray = null;
    }
    return { success: true, runInBackground: state.runInBackground };
  });

  ipcMain.handle(IPC.QUIT_APP, async () => {
    state.isQuittingForReal = true;
    app.quit();
    return { success: true };
  });

  ipcMain.handle(IPC.SET_AGENT_RUNNING_STATE, async (_event, running) => {
    state.agentRunning = !!running;
    if (state.tray) {
      rebuildTrayMenu();
      try {
        state.tray.setToolTip(state.agentRunning
          ? 'Ronbot — agent ON (running in background)'
          : 'Ronbot — agent OFF (idle)');
      } catch { /* best effort */ }
    }
    return { success: true };
  });
}

module.exports = {
  registerControlHandlers,
};
