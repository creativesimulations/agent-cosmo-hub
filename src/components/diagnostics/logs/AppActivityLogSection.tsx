import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  agentLogs,
  type AgentLogEntry,
  type AgentLogLevel,
  type AgentLogSource,
} from '@/lib/diagnostics';
import {
  copyText,
  downloadTextFile,
  formatAgentLogs,
  timestampedFilename,
} from '@/lib/diagnosticsExport';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { LogSectionShell } from './LogSectionShell';
import { LogToolbar } from './LogToolbar';

const SOURCES: Array<AgentLogSource | 'all'> = [
  'all',
  'chat',
  'doctor',
  'install',
  'system',
  'gateway',
  'update',
  'start',
];

export function AppActivityLogSection() {
  const [entries, setEntries] = useState<AgentLogEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [minLevel, setMinLevel] = useState<AgentLogLevel | 'all'>('all');
  const [source, setSource] = useState<AgentLogSource | 'all'>('all');

  useEffect(() => {
    return agentLogs.subscribe((all) => setEntries(all.slice().reverse()));
  }, []);

  const levelRank: Record<AgentLogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

  const visible = entries.filter((e) => {
    if (source !== 'all' && e.source !== source) return false;
    if (minLevel !== 'all' && levelRank[e.level] < levelRank[minLevel]) return false;
    return true;
  });

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <LogSectionShell
      title="App activity"
      description="High-level events from Ronbot (doctor, chat, install, secrets sync)."
      toolbar={
        <LogToolbar
          copyLabel="Copy all"
          onCopy={async () => {
            await copyText(formatAgentLogs(visible));
            toast({ title: 'Copied activity log' });
          }}
          onDownload={() =>
            downloadTextFile(formatAgentLogs(visible), timestampedFilename('ronbot-activity'))
          }
          onClear={() => agentLogs.clear()}
        />
      }
    >
      <div className="flex flex-wrap gap-2 mb-3">
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as AgentLogSource | 'all')}
          className="h-8 text-xs rounded-md border border-border/60 bg-background/50 px-2"
        >
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={minLevel}
          onChange={(e) => setMinLevel(e.target.value as AgentLogLevel | 'all')}
          className="h-8 text-xs rounded-md border border-border/60 bg-background/50 px-2"
        >
          <option value="all">All levels</option>
          <option value="warn">Warn+</option>
          <option value="error">Errors only</option>
        </select>
      </div>

      {visible.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">No activity recorded yet.</p>
      ) : (
        <ul className="space-y-1 max-h-[40vh] overflow-y-auto">
          {visible.map((e) => {
            const open = expanded.has(e.id);
            return (
              <li key={e.id} className="border border-border/50 rounded-lg">
                <button
                  type="button"
                  onClick={() => e.detail && toggle(e.id)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-left text-xs',
                    e.detail && 'hover:bg-muted/30 cursor-pointer',
                  )}
                >
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                    {new Date(e.timestamp).toLocaleTimeString()}
                  </span>
                  <Badge variant="outline" className="text-[9px] py-0 px-1">
                    {e.source}
                  </Badge>
                  <Badge
                    variant={e.level === 'error' ? 'destructive' : 'outline'}
                    className="text-[9px] py-0 px-1"
                  >
                    {e.level}
                  </Badge>
                  <span className="truncate flex-1">{e.summary}</span>
                </button>
                {open && e.detail && (
                  <pre className="px-3 pb-3 text-[11px] font-mono whitespace-pre-wrap border-t border-border/40 select-text max-h-48 overflow-auto">
                    {e.detail}
                  </pre>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </LogSectionShell>
  );
}
