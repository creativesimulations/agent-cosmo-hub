/* Hermes v0.13.0 sync — May 2026 (Ronbot) */
const path = require('path');
const { contextBridge, ipcRenderer } = require('electron');

const IPC = require(path.join(__dirname, 'ipc', 'channels.cjs'));

contextBridge.exposeInMainWorld('electronAPI', {
  runCommand: (cmd, options) => ipcRenderer.invoke(IPC.RUN_COMMAND, cmd, options),

  runCommandStream: (cmd, options) => {
    const id = Date.now().toString();
    const promise = ipcRenderer.invoke(IPC.RUN_COMMAND_STREAM, cmd, { ...options, streamId: id });
    return { id, promise };
  },

  onCommandOutput: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(IPC.COMMAND_OUTPUT, handler);
    return () => ipcRenderer.removeListener(IPC.COMMAND_OUTPUT, handler);
  },

  killStream: (streamId) => ipcRenderer.invoke(IPC.KILL_STREAM, streamId),

  writeStreamStdin: (streamId, data) => ipcRenderer.invoke(IPC.WRITE_STREAM_STDIN, streamId, data),

  setRunInBackground: (enabled) => ipcRenderer.invoke(IPC.SET_RUN_IN_BACKGROUND, enabled),
  setAgentRunningState: (running) => ipcRenderer.invoke(IPC.SET_AGENT_RUNNING_STATE, running),
  quitApp: () => ipcRenderer.invoke(IPC.QUIT_APP),

  getPlatform: () => ipcRenderer.invoke(IPC.GET_PLATFORM),

  fileExists: (filePath) => ipcRenderer.invoke(IPC.FILE_EXISTS, filePath),
  readFile: (filePath) => ipcRenderer.invoke(IPC.READ_FILE, filePath),
  writeFile: (filePath, content, options) => ipcRenderer.invoke(IPC.WRITE_FILE, filePath, content, options),
  mkdir: (dirPath) => ipcRenderer.invoke(IPC.MKDIR, dirPath),

  getDiskSpace: () => ipcRenderer.invoke(IPC.GET_DISK_SPACE),

  selectFolder: (options) => ipcRenderer.invoke(IPC.SELECT_FOLDER, options),

  secretsBackend: () => ipcRenderer.invoke(IPC.SECRETS_BACKEND),
  secretsList: () => ipcRenderer.invoke(IPC.SECRETS_LIST),
  secretsGet: (key) => ipcRenderer.invoke(IPC.SECRETS_GET, key),
  secretsSet: (key, value) => ipcRenderer.invoke(IPC.SECRETS_SET, key, value),
  secretsDelete: (key) => ipcRenderer.invoke(IPC.SECRETS_DELETE, key),

  onAgentRunningChanged: (callback) => {
    const handler = (_event, running) => callback(running);
    ipcRenderer.on(IPC.AGENT_RUNNING_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.AGENT_RUNNING_CHANGED, handler);
  },

  isElectron: true,
});
