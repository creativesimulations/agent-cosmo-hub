// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { runHermesShell } from './shell';

export const HERMES_AGENT_LOG_PATH = '~/.hermes/logs/agent.log';

export type TailAgentLogResult = {
  success: boolean;
  content: string;
  logPath: string;
  loggingDisabled?: boolean;
  error?: string;
};

/** Tail the Hermes agent log file for diagnostics (raw text, not parsed). */
export async function tailAgentLog(options?: { lines?: number }): Promise<TailAgentLogResult> {
  const lines = Math.min(Math.max(options?.lines ?? 500, 50), 8000);
  const logPath = '$HOME/.hermes/logs/agent.log';

  const result = await runHermesShell(
    [
      `LOG="${logPath}"`,
      'if [ ! -f "$LOG" ]; then exit 3; fi',
      `tail -n ${lines} "$LOG"`,
    ].join('\n'),
    { timeout: 15_000 },
  );

  if (!result.success) {
    if (result.code === 3) {
      return {
        success: true,
        content: '',
        logPath: HERMES_AGENT_LOG_PATH,
        loggingDisabled: true,
      };
    }
    return {
      success: false,
      content: '',
      logPath: HERMES_AGENT_LOG_PATH,
      error: result.stderr || result.stdout || 'Failed to read agent log',
    };
  }

  return {
    success: true,
    content: (result.stdout || '').trimEnd(),
    logPath: HERMES_AGENT_LOG_PATH,
  };
}
