// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { useEffect, useMemo, useState } from 'react';
import { Activity, ChevronDown } from 'lucide-react';
import { useDoctorReport } from '@/hooks/useDoctorReport';
import { useDiagnosticsLogs } from '@/hooks/useDiagnosticsLogs';
import { useAgentConnection } from '@/contexts/AgentConnectionContext';
import { systemAPI } from '@/lib/systemAPI';
import { HealthSnapshotCard } from '@/components/diagnostics/HealthSnapshotCard';
import { IssuesAndActionsCard } from '@/components/diagnostics/IssuesAndActionsCard';
import { DiagnosticsLogsPanel } from '@/components/diagnostics/logs/DiagnosticsLogsPanel';
import BrowserChainCard from '@/components/diagnostics/BrowserChainCard';
import DebugTogglesCard from '@/components/diagnostics/DebugTogglesCard';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

const Diagnostics = () => {
  const report = useDoctorReport();
  const { connected, location } = useAgentConnection();
  const [hermesReady, setHermesReady] = useState(false);
  const [hermesVersion, setHermesVersion] = useState<string>();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      const ready = await systemAPI.isConfigured();
      setHermesReady(ready);
      if (ready) {
        const v = await systemAPI.getHermesCliVersionSummary().catch(() => null);
        if (v?.text) setHermesVersion(v.text);
      }
    })();
  }, []);

  const hasBrowserIssues = report.actionableIssues.some((i) =>
    /browser|cdp|internet permission/i.test(i),
  );

  useEffect(() => {
    if (hasBrowserIssues) setAdvancedOpen(true);
  }, [hasBrowserIssues]);

  const healthLines = useMemo(
    () => [
      `connected=${connected} location=${location ?? '—'}`,
      `hermesReady=${hermesReady} version=${hermesVersion?.split('\n')[0] ?? '—'}`,
      `secrets=${report.storeSummary.entries.length} envKeys=${report.envSummary.entries.length}`,
      `model=${report.cfgSummary.modelLine ?? 'not set'}`,
      `issues=${report.actionableIssues.length + report.startupIssues.length}`,
    ],
    [connected, location, hermesReady, hermesVersion, report],
  );

  const logs = useDiagnosticsLogs(healthLines);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <header>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Activity className="w-6 h-6 text-primary" />
          App Diagnostics
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Health, fixable issues, and copyable logs for troubleshooting. For API keys and models, use{' '}
          <a href="#/secrets" className="text-primary hover:underline">
            Secrets
          </a>{' '}
          and{' '}
          <a href="#/models" className="text-primary hover:underline">
            LLM Config
          </a>
          .
        </p>
      </header>

      <HealthSnapshotCard report={report} hermesReady={hermesReady} hermesVersion={hermesVersion} />
      <IssuesAndActionsCard report={report} />

      <DiagnosticsLogsPanel
        buildBundle={logs.buildBundle}
        hermesLog={logs.hermesLog}
        hermesLogLoading={logs.hermesLogLoading}
        hermesLogDisabled={logs.hermesLogDisabled}
        hermesLogError={logs.hermesLogError}
        onRefreshHermesLog={logs.refreshHermesLog}
      />

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground w-full">
          <ChevronDown className={cn('w-4 h-4 transition-transform', advancedOpen && 'rotate-180')} />
          Advanced tools
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-4 space-y-4">
          <BrowserChainCard report={report} />
          <DebugTogglesCard />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

export default Diagnostics;
