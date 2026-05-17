// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { useCallback, useEffect, useState } from 'react';
import { systemAPI } from '@/lib/systemAPI';
import { agentLogs, diagnostics, type AgentLogEntry, type DiagEntry } from '@/lib/diagnostics';
import { buildSupportBundle } from '@/lib/diagnosticsExport';

export type HealthSnapshot = {
  connected: boolean;
  location: string | null;
  hermesReady: boolean;
  hermesVersion?: string;
  storeKeyCount: number;
  envKeyCount: number;
  modelLine?: string;
  issueCount: number;
};

export function useDiagnosticsLogs(healthLines: string[]) {
  const [commandEntries, setCommandEntries] = useState<DiagEntry[]>([]);
  const [agentEntries, setAgentEntries] = useState<AgentLogEntry[]>([]);
  const [hermesLog, setHermesLog] = useState('');
  const [hermesLogDisabled, setHermesLogDisabled] = useState(false);
  const [hermesLogLoading, setHermesLogLoading] = useState(false);
  const [hermesLogError, setHermesLogError] = useState<string | null>(null);

  useEffect(() => {
    return diagnostics.subscribe((all) => setCommandEntries(all.slice().reverse()));
  }, []);

  useEffect(() => {
    return agentLogs.subscribe((all) => setAgentEntries(all.slice().reverse()));
  }, []);

  const refreshHermesLog = useCallback(async () => {
    setHermesLogLoading(true);
    setHermesLogError(null);
    try {
      const r = await systemAPI.tailAgentLog({ lines: 500 });
      if (r.loggingDisabled) {
        setHermesLogDisabled(true);
        setHermesLog('');
      } else if (!r.success) {
        setHermesLogError(r.error ?? 'Failed to read log');
        setHermesLog('');
      } else {
        setHermesLogDisabled(false);
        setHermesLog(r.content);
      }
    } catch (e) {
      setHermesLogError(e instanceof Error ? e.message : String(e));
    } finally {
      setHermesLogLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshHermesLog();
  }, [refreshHermesLog]);

  const buildBundle = useCallback(() => {
    return buildSupportBundle({
      healthLines,
      commandFailures: commandEntries.filter((e) => !e.success),
      agentActivity: agentEntries,
      hermesLogTail: hermesLog,
    });
  }, [healthLines, commandEntries, agentEntries, hermesLog]);

  return {
    commandEntries,
    agentEntries,
    hermesLog,
    hermesLogDisabled,
    hermesLogLoading,
    hermesLogError,
    refreshHermesLog,
    buildBundle,
  };
}

export function logDiagnosticAction(
  summary: string,
  detail: string,
  level: 'info' | 'warn' | 'error' = 'info',
) {
  agentLogs.push({ source: 'system', level, summary, detail });
}
