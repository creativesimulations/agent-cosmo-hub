// Hermes v0.13.0 sync — May 2026 (Ronbot)
import type { AgentLogEntry, DiagEntry } from './diagnostics';

export function formatCommandEntry(e: DiagEntry): string {
  return [
    `time=${new Date(e.timestamp).toISOString()} label=${e.label} phase=${e.phase} exit=${e.exitCode ?? '—'} ok=${e.success}`,
    e.cwd ? `cwd=${e.cwd}` : '',
    `$ ${e.command}`,
    e.stdout ? `--- stdout ---\n${e.stdout.trimEnd()}` : '',
    e.stderr ? `--- stderr ---\n${e.stderr.trimEnd()}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatAgentEntry(e: AgentLogEntry): string {
  const dur = e.durationMs != null ? ` (${e.durationMs}ms)` : '';
  return [
    `time=${new Date(e.timestamp).toISOString()} source=${e.source} level=${e.level}${dur}`,
    e.summary,
    e.detail ? e.detail.trimEnd() : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatCommandFailures(entries: DiagEntry[]): string {
  return entries
    .filter((e) => !e.success)
    .map(formatCommandEntry)
    .join('\n\n');
}

export function formatAgentLogs(entries: AgentLogEntry[], limit = 50): string {
  return entries.slice(0, limit).map(formatAgentEntry).join('\n\n');
}

export type SupportBundleInput = {
  healthLines: string[];
  commandFailures: DiagEntry[];
  agentActivity: AgentLogEntry[];
  hermesLogTail: string;
};

export function buildSupportBundle(input: SupportBundleInput): string {
  const sections = [
    '=== Ronbot Diagnostics ===',
    `Generated: ${new Date().toISOString()}`,
    '',
    '=== Health ===',
    ...input.healthLines,
    '',
    '=== Recent command failures ===',
    input.commandFailures.length > 0
      ? formatCommandFailures(input.commandFailures)
      : '(none recorded)',
    '',
    '=== App activity (newest first, up to 50) ===',
    input.agentActivity.length > 0
      ? formatAgentLogs(input.agentActivity, 50)
      : '(none recorded)',
    '',
    '=== Hermes agent.log (tail) ===',
    input.hermesLogTail.trim() || '(empty or file logging disabled)',
  ];
  return sections.join('\n');
}

export function downloadTextFile(body: string, filename: string) {
  const blob = new Blob([body], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export function timestampedFilename(prefix: string): string {
  return `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
}
