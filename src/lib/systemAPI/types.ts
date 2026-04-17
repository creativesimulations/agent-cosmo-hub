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
      runCommandStream: (cmd: string, options?: Record<string, unknown>) => { id: string; promise: Promise<{ success: boolean; code?: number }> };
      onCommandOutput: (callback: (data: { streamId: string; type: string; data?: string; code?: number }) => void) => () => void;
      getPlatform: () => Promise<PlatformInfo>;
      fileExists: (path: string) => Promise<boolean>;
      readFile: (path: string) => Promise<{ success: boolean; content?: string; error?: string }>;
      writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }>;
      mkdir: (path: string) => Promise<{ success: boolean; error?: string }>;
      getDiskSpace: () => Promise<DiskSpaceInfo>;
      isElectron: boolean;
    };
  }
}

export type { DiskSpaceInfo };

export const isElectron = (): boolean => {
  return !!window.electronAPI?.isElectron;
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
