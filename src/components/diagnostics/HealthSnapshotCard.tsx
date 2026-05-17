import { Link } from 'react-router-dom';
import GlassCard from '@/components/ui/GlassCard';
import { cn } from '@/lib/utils';
import type { DoctorReport } from '@/hooks/useDoctorReport';
import { useAgentConnection } from '@/contexts/AgentConnectionContext';

type Props = {
  report: DoctorReport;
  hermesReady: boolean;
  hermesVersion?: string;
};

function StatusDot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  return (
    <span
      className={cn(
        'w-2 h-2 rounded-full shrink-0',
        ok ? 'bg-success' : warn ? 'bg-warning' : 'bg-destructive',
      )}
    />
  );
}

export function HealthSnapshotCard({ report, hermesReady, hermesVersion }: Props) {
  const { connected, location } = useAgentConnection();
  const { storeSummary, envSummary, cfgSummary, actionableIssues, startupIssues } = report;
  const issueCount = actionableIssues.length + startupIssues.length;

  const rows = [
    {
      label: 'Agent connection',
      value: connected ? `Connected (${location ?? '~/.hermes'})` : 'Not connected',
      ok: connected,
    },
    {
      label: 'Hermes install',
      value: hermesReady
        ? `Ready${hermesVersion ? ` — ${hermesVersion.split('\n')[0]}` : ''}`
        : 'Not detected',
      ok: hermesReady,
      warn: !hermesReady && connected,
    },
    {
      label: 'Secrets store',
      value: storeSummary.error
        ? 'Error reading store'
        : `${storeSummary.entries.length} key(s) saved`,
      ok: !storeSummary.error && storeSummary.entries.length > 0,
      warn: !storeSummary.error && storeSummary.entries.length === 0,
    },
    {
      label: 'Materialized .env',
      value: envSummary.error
        ? 'Error reading .env'
        : `${envSummary.entries.length} key(s) in ~/.hermes/.env`,
      ok: !envSummary.error && envSummary.entries.length > 0,
      warn: !envSummary.error && envSummary.entries.length === 0,
    },
    {
      label: 'Model',
      value: cfgSummary.modelLine ?? 'Not set — configure in LLM Config',
      ok: !!cfgSummary.modelLine,
      warn: !cfgSummary.modelLine,
    },
    {
      label: 'Open issues',
      value: issueCount === 0 ? 'None detected' : `${issueCount} item(s) need attention`,
      ok: issueCount === 0,
      warn: issueCount > 0,
    },
  ];

  return (
    <GlassCard className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Health snapshot</h2>
        <p className="text-[11px] text-muted-foreground">
          <Link to="/secrets" className="text-primary hover:underline">
            Secrets
          </Link>
          {' · '}
          <Link to="/models" className="text-primary hover:underline">
            LLM Config
          </Link>
        </p>
      </div>
      <ul className="space-y-2 text-xs">
        {rows.map((row) => (
          <li key={row.label} className="flex items-start gap-2">
            <StatusDot ok={row.ok} warn={row.warn} />
            <span className="text-muted-foreground w-32 shrink-0">{row.label}</span>
            <span className="text-foreground">{row.value}</span>
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}
