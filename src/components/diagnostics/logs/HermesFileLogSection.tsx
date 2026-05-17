import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { systemAPI } from '@/lib/systemAPI';
import { HERMES_AGENT_LOG_PATH } from '@/lib/systemAPI/hermes/tailAgentLog';
import { cn } from '@/lib/utils';
import {
  copyText,
  downloadTextFile,
  timestampedFilename,
} from '@/lib/diagnosticsExport';
import { toast } from '@/hooks/use-toast';
import { LogSectionShell } from './LogSectionShell';
import { LogToolbar } from './LogToolbar';
import { LogTextPanel } from './LogTextPanel';

type Props = {
  content: string;
  loading: boolean;
  loggingDisabled: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
};

export function HermesFileLogSection({
  content,
  loading,
  loggingDisabled,
  error,
  onRefresh,
}: Props) {
  const [autoRefresh, setAutoRefresh] = useState(false);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => void onRefresh(), 10_000);
    return () => window.clearInterval(id);
  }, [autoRefresh, onRefresh]);

  const enableLogging = async () => {
    await systemAPI.enableHermesFileLogging();
    toast({ title: 'File logging enabled', description: HERMES_AGENT_LOG_PATH });
    await onRefresh();
  };

  return (
    <LogSectionShell
      title="Hermes agent.log"
      description={`On-disk log at ${HERMES_AGENT_LOG_PATH} (last ~500 lines).`}
      toolbar={
        <LogToolbar
          copyLabel="Copy tail"
          onCopy={async () => {
            await copyText(content || '(empty)');
            toast({ title: 'Copied Hermes log' });
          }}
          onDownload={() =>
            downloadTextFile(content, timestampedFilename('hermes-agent-log'))
          }
          extra={
            <>
              <label className="flex items-center gap-2 text-xs text-muted-foreground mr-2">
                <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
                Auto-refresh
              </label>
              <Button type="button" size="sm" variant="ghost" onClick={() => void onRefresh()} disabled={loading}>
                <RefreshCw className={cn('w-3 h-3 mr-1', loading && 'animate-spin')} />
                Refresh
              </Button>
            </>
          }
        />
      }
    >
      {loggingDisabled ? (
        <div className="space-y-3 text-center py-4">
          <p className="text-xs text-muted-foreground">
            File logging is off or the log file does not exist yet. Enable it to capture agent output on disk.
          </p>
          <Button type="button" size="sm" onClick={() => void enableLogging()}>
            Enable file logging
          </Button>
        </div>
      ) : error ? (
        <p className="text-xs text-destructive py-4 text-center">{error}</p>
      ) : loading && !content ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <LogTextPanel text={content} maxHeight="max-h-[50vh]" emptyMessage="Log file is empty." />
      )}
    </LogSectionShell>
  );
}
