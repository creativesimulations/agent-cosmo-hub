import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Copy, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { diagnostics, type DiagEntry } from '@/lib/diagnostics';
import {
  copyText,
  downloadTextFile,
  formatCommandEntry,
  formatCommandFailures,
  timestampedFilename,
} from '@/lib/diagnosticsExport';
import { toast } from '@/hooks/use-toast';
import { LogSectionShell } from './LogSectionShell';
import { LogToolbar } from './LogToolbar';

export function CommandErrorsSection() {
  const [entries, setEntries] = useState<DiagEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'gateway' | 'whatsapp' | 'hermes' | 'system'>('all');

  useEffect(() => {
    return diagnostics.subscribe((all) => setEntries(all.slice().reverse()));
  }, []);

  const visible = entries
    .filter((e) => showAll || !e.success)
    .filter((e) => {
      if (scope === 'all') return true;
      const hay = `${e.command} ${e.stdout} ${e.stderr}`;
      if (scope === 'gateway') return /gateway/i.test(hay);
      if (scope === 'whatsapp') return /whatsapp|baileys/i.test(hay);
      if (scope === 'hermes') return /hermes/i.test(hay);
      return !/hermes|gateway|whatsapp|baileys/i.test(e.command);
    })
    .filter((e) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return [e.command, e.stdout, e.stderr, e.cwd ?? '', e.label].join('\n').toLowerCase().includes(q);
    });

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copyEntry = async (e: DiagEntry) => {
    await copyText(formatCommandEntry(e));
    toast({ title: 'Copied entry' });
  };

  return (
    <LogSectionShell
      title="Recent command errors"
      description="Shell commands Ronbot ran via Electron (newest first). Failures shown by default."
      toolbar={
        <LogToolbar
          copyLabel="Copy failures"
          onCopy={async () => {
            await copyText(formatCommandFailures(entries));
            toast({ title: 'Copied failures' });
          }}
          onDownload={() =>
            downloadTextFile(
              formatCommandFailures(visible),
              timestampedFilename('ronbot-command-errors'),
            )
          }
          onClear={() => diagnostics.clear()}
          extra={
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Failures only' : 'Show all'}
            </Button>
          }
        />
      }
    >
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search command or output…"
          className="h-8 flex-1 min-w-[200px] px-2 rounded-md border border-border/60 bg-background/50 text-xs"
        />
        {(['all', 'gateway', 'whatsapp', 'hermes', 'system'] as const).map((s) => (
          <Button
            key={s}
            type="button"
            size="sm"
            variant={scope === s ? 'default' : 'ghost'}
            onClick={() => setScope(s)}
          >
            {s}
          </Button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">
          {entries.length === 0
            ? 'No commands recorded yet. Run sync, doctor, or chat to populate.'
            : 'No matching failures in the current filter.'}
        </p>
      ) : (
        <ul className="space-y-1.5 max-h-[50vh] overflow-y-auto">
          {visible.map((e) => {
            const open = expanded.has(e.id);
            return (
              <li key={e.id} className="border border-border/50 rounded-lg overflow-hidden">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggle(e.id)}
                    className="flex-1 flex items-center gap-2 px-3 py-2 hover:bg-muted/30 text-left min-w-0"
                  >
                    {e.success ? (
                      <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-destructive shrink-0" />
                    )}
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                      {new Date(e.timestamp).toLocaleTimeString()}
                    </span>
                    <Badge variant="outline" className="text-[9px] py-0 px-1 shrink-0">
                      {e.label}
                    </Badge>
                    <span className="text-xs font-mono truncate text-muted-foreground">{e.command}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {e.durationMs}ms
                    </span>
                  </button>
                  {!e.success && (
                    <Button type="button" size="sm" variant="ghost" className="shrink-0 mr-1" onClick={() => void copyEntry(e)}>
                      <Copy className="w-3 h-3" />
                    </Button>
                  )}
                </div>
                {open && (
                  <div className="px-3 pb-3 space-y-2 text-[11px] font-mono border-t border-border/40">
                    {e.stderr && (
                      <div>
                        <p className="text-destructive/80 mb-1">stderr</p>
                        <pre className="p-2 rounded bg-background/40 whitespace-pre-wrap max-h-48 overflow-auto select-text">
                          {e.stderr}
                        </pre>
                      </div>
                    )}
                    {e.stdout && (
                      <div>
                        <p className="text-muted-foreground mb-1">stdout</p>
                        <pre className="p-2 rounded bg-background/40 whitespace-pre-wrap max-h-48 overflow-auto select-text">
                          {e.stdout}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </LogSectionShell>
  );
}
