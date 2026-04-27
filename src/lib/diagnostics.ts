/**
 * Rolling in-memory diagnostics log shared across the app.
 *
 * Every shell command run via `coreAPI.runCommand` / `runCommandStream` is
 * appended here so the Diagnostics page can show the user exactly what was
 * executed, what came back, and how long it took. Capped at MAX entries.
 */

export interface DiagEntry {
  id: string;
  timestamp: number;
  label: string;
  command: string;
  exitCode: number | null;
  success: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}

const MAX = 200;
let buffer: DiagEntry[] = [];
const listeners = new Set<(entries: DiagEntry[]) => void>();

const notify = () => {
  const snapshot = buffer.slice();
  for (const l of listeners) l(snapshot);
};

export const diagnostics = {
  list(): DiagEntry[] {
    return buffer.slice().reverse(); // newest first
  },

  push(entry: Omit<DiagEntry, 'id' | 'timestamp'> & { timestamp?: number }): DiagEntry {
    const full: DiagEntry = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: entry.timestamp ?? Date.now(),
      ...entry,
    };
    buffer.push(full);
    if (buffer.length > MAX) buffer = buffer.slice(buffer.length - MAX);
    notify();
    return full;
  },

  clear() {
    buffer = [];
    notify();
  },

  subscribe(fn: (entries: DiagEntry[]) => void): () => void {
    listeners.add(fn);
    fn(buffer.slice());
    return () => { listeners.delete(fn); };
  },

  toText(): string {
    return diagnostics.list().map((e) => {
      const ts = new Date(e.timestamp).toISOString();
      return [
        `── [${ts}] ${e.label} (${e.durationMs}ms, exit=${e.exitCode}, ok=${e.success}) ──`,
        `$ ${e.command}`,
        e.stdout ? `--- stdout ---\n${e.stdout.trimEnd()}` : '',
        e.stderr ? `--- stderr ---\n${e.stderr.trimEnd()}` : '',
      ].filter(Boolean).join('\n');
    }).join('\n\n');
  },
};

/** Truncate a long string for the buffer to keep memory bounded. */
export const truncateForLog = (s: string, max = 4000): string => {
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]`;
};

// ─── Agent activity log ───────────────────────────────────────
// Higher-level than the shell-command audit trail above. This buffer
// captures agent-facing events: chat turns, doctor runs, installs,
// updates, lifecycle starts. It is what the "Logs" tab renders.

export type AgentLogSource = 'chat' | 'doctor' | 'install' | 'update' | 'start' | 'gateway' | 'system';
export type AgentLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AgentLogEntry {
  id: string;
  timestamp: number;
  source: AgentLogSource;
  level: AgentLogLevel;
  summary: string;
  detail?: string;
  durationMs?: number;
}

const AGENT_MAX = 500;
let agentBuffer: AgentLogEntry[] = [];
const agentListeners = new Set<(entries: AgentLogEntry[]) => void>();

const notifyAgent = () => {
  const snapshot = agentBuffer.slice();
  for (const l of agentListeners) l(snapshot);
};

export const agentLogs = {
  list(): AgentLogEntry[] {
    return agentBuffer.slice().reverse(); // newest first
  },

  push(entry: Omit<AgentLogEntry, 'id' | 'timestamp'> & { timestamp?: number }): AgentLogEntry {
    const full: AgentLogEntry = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: entry.timestamp ?? Date.now(),
      ...entry,
    };
    agentBuffer.push(full);
    if (agentBuffer.length > AGENT_MAX) agentBuffer = agentBuffer.slice(agentBuffer.length - AGENT_MAX);
    notifyAgent();
    return full;
  },

  clear() {
    agentBuffer = [];
    notifyAgent();
  },

  subscribe(fn: (entries: AgentLogEntry[]) => void): () => void {
    agentListeners.add(fn);
    fn(agentBuffer.slice());
    return () => { agentListeners.delete(fn); };
  },

  toText(): string {
    return agentLogs.list().map((e) => {
      const ts = new Date(e.timestamp).toISOString();
      const dur = e.durationMs != null ? ` (${e.durationMs}ms)` : '';
      return [
        `── [${ts}] ${e.source.toUpperCase()} · ${e.level}${dur} ──`,
        e.summary,
        e.detail ? e.detail.trimEnd() : '',
      ].filter(Boolean).join('\n');
    }).join('\n\n');
  },
};

