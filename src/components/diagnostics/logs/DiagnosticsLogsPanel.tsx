import { ClipboardList } from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/button';
import { copyText } from '@/lib/diagnosticsExport';
import { toast } from '@/hooks/use-toast';
import { CommandErrorsSection } from './CommandErrorsSection';
import { AppActivityLogSection } from './AppActivityLogSection';
import { HermesFileLogSection } from './HermesFileLogSection';

type Props = {
  buildBundle: () => string;
  hermesLog: string;
  hermesLogLoading: boolean;
  hermesLogDisabled: boolean;
  hermesLogError: string | null;
  onRefreshHermesLog: () => Promise<void>;
};

export function DiagnosticsLogsPanel({
  buildBundle,
  hermesLog,
  hermesLogLoading,
  hermesLogDisabled,
  hermesLogError,
  onRefreshHermesLog,
}: Props) {
  return (
    <GlassCard className="p-5 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Logs</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Copy errors and activity to share with support or your assistant.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={async () => {
            await copyText(buildBundle());
            toast({ title: 'Support bundle copied', description: 'Paste into chat or a ticket.' });
          }}
        >
          <ClipboardList className="w-4 h-4 mr-2" />
          Copy support bundle
        </Button>
      </div>

      <CommandErrorsSection />
      <AppActivityLogSection />
      <HermesFileLogSection
        content={hermesLog}
        loading={hermesLogLoading}
        loggingDisabled={hermesLogDisabled}
        error={hermesLogError}
        onRefresh={onRefreshHermesLog}
      />
    </GlassCard>
  );
}
