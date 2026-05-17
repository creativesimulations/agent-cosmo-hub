import { RefreshCw, Stethoscope, Send } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DoctorReport } from "@/hooks/useDoctorReport";

interface Props {
  report: DoctorReport;
}

const ActionRowCard = ({ report }: Props) => {
  const { syncing, running, lastResult, handleSyncSecrets, handleDoctor, handlePing, refreshSummaries } = report;
  return (
    <GlassCard className="p-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={handleSyncSecrets} disabled={syncing} className="gradient-primary text-primary-foreground">
          <RefreshCw className={cn("w-4 h-4 mr-2", syncing && "animate-spin")} />
          Sync secrets now
        </Button>
        <Button onClick={handleDoctor} disabled={running !== null} variant="secondary">
          <Stethoscope className={cn("w-4 h-4 mr-2", running === "doctor" && "animate-pulse")} />
          Run agent doctor
        </Button>
        <Button onClick={handlePing} disabled={running !== null} variant="secondary">
          <Send className={cn("w-4 h-4 mr-2", running === "ping" && "animate-pulse")} />
          Test chat round-trip
        </Button>
        <Button onClick={refreshSummaries} variant="ghost" size="sm" className="ml-auto">
          <RefreshCw className="w-3 h-3 mr-1" /> Refresh state
        </Button>
      </div>
      {lastResult && (
        <pre className="mt-3 p-3 rounded bg-background/40 border border-white/5 text-[11px] font-mono whitespace-pre-wrap max-h-64 overflow-auto">
          {lastResult}
        </pre>
      )}
    </GlassCard>
  );
};

export default ActionRowCard;
