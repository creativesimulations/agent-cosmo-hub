import { RefreshCw, Send, Stethoscope, Wrench } from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { DoctorReport } from '@/hooks/useDoctorReport';

type Props = {
  report: DoctorReport;
};

export function IssuesAndActionsCard({ report }: Props) {
  const {
    actionableIssues,
    startupIssues,
    fixingStartup,
    syncing,
    running,
    handleSyncSecrets,
    handleDoctor,
    handlePing,
    handleFixStartupIssues,
    refreshSummaries,
  } = report;

  const hasIssues = actionableIssues.length > 0 || startupIssues.length > 0;

  return (
    <GlassCard className="p-4 space-y-4">
      <h2 className="text-sm font-semibold">Issues &amp; quick fixes</h2>

      {!hasIssues ? (
        <p className="text-xs text-muted-foreground">No obvious configuration issues detected.</p>
      ) : (
        <div className="space-y-3">
          {startupIssues.map((issue) => (
            <div
              key={issue.id}
              className="text-xs rounded-md border border-border/60 bg-background/30 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{issue.title}</span>
                <Badge variant={issue.severity === 'error' ? 'destructive' : 'outline'} className="text-[10px]">
                  {issue.severity}
                </Badge>
              </div>
              <p className="text-muted-foreground mt-1">{issue.detail}</p>
            </div>
          ))}
          {startupIssues.length > 0 && (
            <Button onClick={handleFixStartupIssues} disabled={fixingStartup} variant="secondary" size="sm">
              <Wrench className={cn('w-3.5 h-3.5 mr-1.5', fixingStartup && 'animate-spin')} />
              {fixingStartup ? 'Fixing…' : 'Fix startup issues'}
            </Button>
          )}
          <ul className="space-y-1.5">
            {actionableIssues.map((issue) => (
              <li
                key={issue}
                className="text-xs rounded-md border border-border/60 bg-background/30 px-3 py-2"
              >
                {issue}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-2 border-t border-border/50">
        <Button onClick={handleSyncSecrets} disabled={syncing} className="gradient-primary text-primary-foreground">
          <RefreshCw className={cn('w-4 h-4 mr-2', syncing && 'animate-spin')} />
          Sync secrets
        </Button>
        <Button onClick={handleDoctor} disabled={running !== null} variant="secondary">
          <Stethoscope className={cn('w-4 h-4 mr-2', running === 'doctor' && 'animate-pulse')} />
          Run doctor
        </Button>
        <Button onClick={handlePing} disabled={running !== null} variant="secondary">
          <Send className={cn('w-4 h-4 mr-2', running === 'ping' && 'animate-pulse')} />
          Test chat
        </Button>
        <Button onClick={refreshSummaries} variant="ghost" size="sm" className="ml-auto">
          <RefreshCw className="w-3 h-3 mr-1" /> Refresh
        </Button>
      </div>
    </GlassCard>
  );
}
