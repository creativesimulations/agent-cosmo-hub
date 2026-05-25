/**
 * System API bridge — calls Electron IPC when running in desktop,
 * falls back to simulated responses in browser for development.
 */

interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

interface PlatformInfo {
  platform: string;
  arch: string;
  release: string;
  isWSL: boolean;
  isWindows: boolean;
  isMac: boolean;
  isLinux: boolean;
  homeDir: string;
  totalMemory: number;
  freeMemory: number;
}

interface DiskSpaceInfo {
  success: boolean;
  drive?: string;
  freeBytes?: number;
  totalBytes?: number;
  error?: string;
}

declare global {
  interface Window {
    electronAPI?: {
      runCommand: (cmd: string, options?: Record<string, unknown>) => Promise<CommandResult>;
      runCommandStream: (
        cmd: string,
        options?: Record<string, unknown>,
      ) => {
        id: string;
        promise: Promise<{ success: boolean; code?: number; stdout?: string; stderr?: string }>;
      };
      onCommandOutput: (callback: (data: { streamId: string; type: string; data?: string; code?: number }) => void) => () => void;
      getPlatform: () => Promise<PlatformInfo>;
      fileExists: (path: string) => Promise<boolean>;
      readFile: (path: string) => Promise<{ success: boolean; content?: string; error?: string }>;
      writeFile: (path: string, content: string, options?: { mode?: number }) => Promise<{ success: boolean; error?: string }>;
      mkdir: (path: string) => Promise<{ success: boolean; error?: string }>;
      getDiskSpace: () => Promise<DiskSpaceInfo>;
      selectFolder: (options?: { title?: string; defaultPath?: string }) => Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }>;

      // Secure secrets storage
      secretsBackend: () => Promise<{ backend: string; label: string }>;
      secretsList: () => Promise<{ success: boolean; backend?: string; keys: string[]; error?: string }>;
      secretsGet: (key: string) => Promise<{ success: boolean; value?: string; error?: string }>;
      secretsSet: (key: string, value: string) => Promise<{ success: boolean; backend?: string; error?: string }>;
      secretsDelete: (key: string) => Promise<{ success: boolean; error?: string }>;

      // Process control + window lifecycle
      killStream: (streamId: string) => Promise<{ success: boolean; error?: string }>;
      writeStreamStdin: (streamId: string, data: string) => Promise<{ success: boolean; error?: string }>;
      setRunInBackground: (enabled: boolean) => Promise<{ success: boolean; runInBackground: boolean }>;
      setAgentRunningState: (running: boolean) => Promise<{ success: boolean }>;
      quitApp: () => Promise<{ success: boolean }>;
      onAgentRunningChanged: (callback: (running: boolean) => void) => () => void;

      isElectron?: boolean;
    };
  }
}

export type { DiskSpaceInfo };

export const isElectron = (): boolean => {
  const api = window.electronAPI;
  if (!api) return false;
  // New preload versions set an explicit marker.
  if (api.isElectron === true) return true;
  // Backward-compatible detection for older packaged preload builds:
  // if core IPC methods exist, we can treat this runtime as Electron.
  return (
    typeof api.runCommand === 'function' &&
    typeof api.runCommandStream === 'function' &&
    typeof api.getPlatform === 'function'
  );
};

// ─── Simulation helpers for browser dev mode ──────────────────

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const simulatedPlatform: PlatformInfo = {
  platform: 'win32',
  arch: 'x64',
  release: '10.0.22631',
  isWSL: false,
  isWindows: true,
  isMac: false,
  isLinux: false,
  homeDir: 'C:\\Users\\User',
  totalMemory: 17179869184,
  freeMemory: 8589934592,
};

export { type CommandResult, type PlatformInfo };
