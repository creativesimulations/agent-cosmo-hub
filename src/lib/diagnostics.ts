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
