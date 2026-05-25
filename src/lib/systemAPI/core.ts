import { isElectron } from './types';
import type { CommandResult, PlatformInfo, DiskSpaceInfo } from './types';
import { diagnostics, truncateForLog } from '@/lib/diagnostics';
import { redactLogText } from '@/lib/logRedaction';

const labelForCommand = (cmd: string): string => {
  const trimmed = cmd.trim();
  if (trimmed.startsWith('wsl ')) return 'wsl';
  if (trimmed.startsWith('bash ')) return 'bash';
  if (trimmed.startsWith('powershell') || trimmed.startsWith('pwsh')) return 'powershell';
  if (trimmed.startsWith('cmd ')) return 'cmd';
  return trimmed.split(/\s+/)[0] || 'cmd';
};

type CommandOutputEvent = {
  streamId: string;
  type: string;
  data?: string;
  code?: number;
};

export type DesktopBridgeHealth = {
  ok: boolean;
  reason: string;
  details: string[];
};

const reconcileStreamOutput = (collected: string, reported?: string): string => {
  if (!reported) return collected;
  if (!collected) return reported;
  if (reported.length > collected.length && reported.includes(collected)) return reported;
  return collected;
};

const NON_ELECTRON_ERROR = 'Desktop bridge unavailable (non-Electron runtime).';

/** Core platform & command execution */
export const coreAPI = {
  async getPlatform(): Promise<PlatformInfo> {
    if (isElectron()) return window.electronAPI!.getPlatform();
    return {
      platform: 'browser',
      arch: 'unknown',
      release: '',
      isWSL: false,
      isWindows: false,
      isMac: false,
      isLinux: false,
      homeDir: '',
      totalMemory: 0,
      freeMemory: 0,
    };
  },

  async checkDesktopBridge(): Promise<DesktopBridgeHealth> {
    const api = window.electronAPI;
    if (!api) {
      return {
        ok: false,
        reason: 'Electron preload bridge is missing (window.electronAPI unavailable).',
        details: [],
      };
    }

    const required = ['runCommand', 'runCommandStream', 'getPlatform', 'readFile', 'writeFile', 'mkdir'] as const;
    const missing = required.filter((name) => typeof api[name] !== 'function');
    if (missing.length > 0) {
      return {
        ok: false,
        reason: `Electron bridge is incomplete (missing: ${missing.join(', ')}).`,
        details: ['A stale preload/main bundle may be running.'],
      };
    }

    try {
      const probe = await api.runCommand('echo RONBOT_BRIDGE_OK', { timeout: 5000 });
      if (!probe.success || !(probe.stdout || '').includes('RONBOT_BRIDGE_OK')) {
        return {
          ok: false,
          reason: 'Electron command bridge failed round-trip.',
          details: [
            `stdout=${(probe.stdout || '').trim()}`,
            `stderr=${(probe.stderr || '').trim()}`,
            `code=${probe.code ?? 'n/a'}`,
          ],
        };
      }
      const platform = await api.getPlatform();
      return {
        ok: true,
        reason: 'Desktop bridge healthy',
        details: [`platform=${platform.platform}`, `arch=${platform.arch}`],
      };
    } catch (error) {
      return {
        ok: false,
        reason: 'Electron bridge health check threw an exception.',
        details: [error instanceof Error ? error.message : String(error)],
      };
    }
  },

  async runCommand(cmd: string, options?: Record<string, unknown>): Promise<CommandResult> {
    const start = Date.now();
    const cwd = typeof options?.cwd === 'string' ? options.cwd : undefined;
    const displayCommand = typeof options?.displayCommand === 'string' ? options.displayCommand : cmd;
    const result = isElectron()
      ? await window.electronAPI!.runCommand(cmd, options)
      : { success: false, stdout: '', stderr: NON_ELECTRON_ERROR, code: 2 };
    diagnostics.push({
      label: labelForCommand(cmd),
      command: truncateForLog(redactLogText(displayCommand), 2000),
      cwd,
      phase: 'exec',
      status: result.success ? 'ok' : 'error',
      exitCode: typeof result.code === 'number' ? result.code : null,
      success: result.success,
      stdout: truncateForLog(redactLogText(result.stdout || '')),
      stderr: truncateForLog(redactLogText(result.stderr || '')),
      durationMs: Date.now() - start,
      redacted: true,
    });
    return result;
  },

  async runCommandStream(
    cmd: string,
    options?: Record<string, unknown> & { onStreamId?: (id: string) => void },
    onOutput?: (event: Omit<CommandOutputEvent, 'streamId'>) => void,
  ): Promise<CommandResult> {
    const start = Date.now();
    const cwd = typeof options?.cwd === 'string' ? options.cwd : undefined;
    const displayCommand = typeof options?.displayCommand === 'string' ? options.displayCommand : cmd;
    const finalize = (result: CommandResult) => {
      diagnostics.push({
        label: labelForCommand(cmd),
        command: truncateForLog(redactLogText(displayCommand), 2000),
        cwd,
        phase: 'stream',
        status: result.success ? 'ok' : 'error',
        exitCode: typeof result.code === 'number' ? result.code : null,
        success: result.success,
        stdout: truncateForLog(redactLogText(result.stdout || '')),
        stderr: truncateForLog(redactLogText(result.stderr || '')),
        durationMs: Date.now() - start,
        redacted: true,
      });
      return result;
    };

    if (isElectron()) {
      return new Promise<CommandResult>((resolve) => {
      // Strip non-serializable keys (functions) before sending across IPC —
      // Electron's structured-clone will throw "An object could not be cloned"
      // if any value is a function.
      const { onStreamId: _stripped, ...ipcOptions } = options ?? {};
      const { id, promise } = window.electronAPI!.runCommandStream(cmd, ipcOptions);
        // Surface the streamId so the caller (e.g. ChatContext) can hold it
        // and use it to call killStream() if the user clicks Stop.
        try { options?.onStreamId?.(id); } catch { /* swallow */ }
        let stdout = '';
        let stderr = '';
        let code = 0;

        const unsubscribe = window.electronAPI!.onCommandOutput((event) => {
          if (event.streamId !== id) return;

          if (event.type === 'stdout' && event.data) stdout += event.data;
          if (event.type === 'stderr' && event.data) stderr += event.data;
          if (event.type === 'exit') code = event.code ?? code;

          onOutput?.({ type: event.type, data: event.data, code: event.code });
        });

        promise
          .then((result) => {
            unsubscribe();
            const mergedStdout = reconcileStreamOutput(stdout, result.stdout);
            const mergedStderr = reconcileStreamOutput(stderr, result.stderr);
            resolve(finalize({
              success: result.success,
              stdout: mergedStdout,
              stderr: mergedStderr,
              code: typeof result.code === 'number' ? result.code : code,
            }));
          })
          .catch((error) => {
            unsubscribe();
            const message = error instanceof Error ? error.message : String(error);
            const normalized = message.endsWith('\n') ? message : `${message}\n`;
            onOutput?.({ type: 'stderr', data: normalized, code: 1 });
            resolve(finalize({
              success: false,
              stdout,
              stderr: `${stderr}${normalized}`,
              code: code || 1,
            }));
          });
      });
    }

    const result: CommandResult = { success: false, stdout: '', stderr: NON_ELECTRON_ERROR, code: 2 };
    onOutput?.({ type: 'stderr', data: result.stderr, code: result.code });
    onOutput?.({ type: 'exit', code: result.code });
    return finalize(result);
  },

  async killStream(streamId: string): Promise<{ success: boolean; error?: string }> {
    if (isElectron() && window.electronAPI?.killStream) {
      return window.electronAPI.killStream(streamId);
    }
    return { success: false, error: 'not in electron' };
  },

  async writeStreamStdin(streamId: string, data: string): Promise<{ success: boolean; error?: string }> {
    if (isElectron() && window.electronAPI?.writeStreamStdin) {
      return window.electronAPI.writeStreamStdin(streamId, data);
    }
    return { success: false, error: 'not in electron' };
  },

  async setRunInBackground(enabled: boolean): Promise<{ success: boolean }> {
    if (isElectron() && window.electronAPI?.setRunInBackground) {
      const r = await window.electronAPI.setRunInBackground(enabled);
      return { success: r.success };
    }
    return { success: false };
  },

  async setAgentRunningState(running: boolean): Promise<{ success: boolean }> {
    if (isElectron() && window.electronAPI?.setAgentRunningState) {
      return window.electronAPI.setAgentRunningState(running);
    }
    return { success: false };
  },

  async quitApp(): Promise<void> {
    if (isElectron() && window.electronAPI?.quitApp) {
      await window.electronAPI.quitApp();
    }
  },

  async selectFolder(options?: { title?: string; defaultPath?: string }): Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }> {
    if (isElectron()) {
      if (typeof window.electronAPI?.selectFolder !== 'function') {
        return {
          success: false,
          error:
            'Folder picker is not available (preload bridge missing selectFolder). Rebuild or reinstall the Ronbot desktop app.',
        };
      }
      return window.electronAPI.selectFolder(options);
    }
    return { success: false, error: NON_ELECTRON_ERROR };
  },

  async fileExists(path: string): Promise<boolean> {
    if (isElectron()) return window.electronAPI!.fileExists(path);
    return false;
  },

  async readFile(path: string): Promise<{ success: boolean; content?: string; error?: string }> {
    if (isElectron()) return window.electronAPI!.readFile(path);
    return { success: false, error: 'Not running in Electron' };
  },

  async writeFile(path: string, content: string): Promise<{ success: boolean; error?: string }> {
    if (isElectron()) return window.electronAPI!.writeFile(path, content);
    return { success: false, error: NON_ELECTRON_ERROR };
  },

  async mkdir(path: string): Promise<{ success: boolean; error?: string }> {
    if (isElectron()) return window.electronAPI!.mkdir(path);
    return { success: false, error: NON_ELECTRON_ERROR };
  },

  async getDiskSpace(): Promise<DiskSpaceInfo> {
    if (isElectron()) return window.electronAPI!.getDiskSpace();
    return { success: false, error: NON_ELECTRON_ERROR };
  },
};
