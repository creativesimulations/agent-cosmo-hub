const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Run a shell command and get stdout/stderr
  runCommand: (cmd, options) => ipcRenderer.invoke('run-command', cmd, options),

  // Run a command with streaming output via callback
  runCommandStream: (cmd, options) => {
    const id = Date.now().toString();
    const promise = ipcRenderer.invoke('run-command-stream', cmd, { ...options, streamId: id });
    return { id, promise };
  },

  // Listen for streaming output
  onCommandOutput: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('command-output', handler);
    return () => ipcRenderer.removeListener('command-output', handler);
  },

  // Kill an in-flight streamed command (used by chat "Stop")
  killStream: (streamId) => ipcRenderer.invoke('kill-stream', streamId),

  // Write a chunk of data to the stdin of a running streamed command.
  // Used by the Permissions approval dialog to answer Hermes' interactive
  // [o]nce / [s]ession / [a]lways / [d]eny prompts.
  writeStreamStdin: (streamId, data) => ipcRenderer.invoke('write-stream-stdin', streamId, data),

  // Background mode + tray
  setRunInBackground: (enabled) => ipcRenderer.invoke('set-run-in-background', enabled),
  setAgentRunningState: (running) => ipcRenderer.invoke('set-agent-running-state', running),
  quitApp: () => ipcRenderer.invoke('quit-app'),

  // Platform detection
  getPlatform: () => ipcRenderer.invoke('get-platform'),

  // File system operations
  fileExists: (filePath) => ipcRenderer.invoke('file-exists', filePath),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, content, options) => ipcRenderer.invoke('write-file', filePath, content, options),
  mkdir: (dirPath) => ipcRenderer.invoke('mkdir', dirPath),

  // Disk space on the drive holding the user's home directory
  getDiskSpace: () => ipcRenderer.invoke('get-disk-space'),

  // Open or highlight a path in the OS file manager (Finder/Explorer/Nautilus)
  revealInFolder: (targetPath) => ipcRenderer.invoke('reveal-in-folder', targetPath),

  // Secure secrets storage (OS keychain → safeStorage → plaintext fallback)
  secretsBackend: () => ipcRenderer.invoke('secrets-backend'),
  secretsList: () => ipcRenderer.invoke('secrets-list'),
  secretsGet: (key) => ipcRenderer.invoke('secrets-get', key),
  secretsSet: (key, value) => ipcRenderer.invoke('secrets-set', key, value),
  secretsDelete: (key) => ipcRenderer.invoke('secrets-delete', key),
  secretsMaterializeEnv: (envPath) => ipcRenderer.invoke('secrets-materialize-env', envPath),
  secretsMigrateFromEnv: (envPath) => ipcRenderer.invoke('secrets-migrate-from-env', envPath),

  // Listen for agent running state changes from tray menu
  onAgentRunningChanged: (callback) => {
    const handler = (_event, running) => callback(running);
    ipcRenderer.on('agent-running-changed', handler);
    return () => ipcRenderer.removeListener('agent-running-changed', handler);
  },

  // Check if running in Electron
  isElectron: true,
});
