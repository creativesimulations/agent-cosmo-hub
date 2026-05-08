import { ShieldCheck, RefreshCw } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DoctorReport } from "@/hooks/useDoctorReport";

const PermissionsCard = ({ report }: { report: DoctorReport }) => {
  const { permsBlock, syncingPerms, handleSyncPerms } = report;
  return (
    <GlassCard className="p-4 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-primary" />
          Permissions sent to agent
          <span className="text-[11px] font-normal text-muted-foreground">
            (managed block in ~/.hermes/config.yaml)
          </span>
        </h2>
        <Button onClick={handleSyncPerms} disabled={syncingPerms} variant="ghost" size="sm">
          <RefreshCw className={cn("w-3 h-3 mr-1", syncingPerms && "animate-spin")} />
          Re-read block
        </Button>
      </div>
      {permsBlock ? (
        <pre className="p-2 rounded bg-background/40 border border-white/5 text-[11px] font-mono whitespace-pre-wrap max-h-72 overflow-auto">
          {permsBlock}
        </pre>
      ) : (
        <p className="text-xs text-muted-foreground">
          No managed permissions block found. It's written automatically on the first chat message,
          or you can sync it manually from Settings → Permissions.
        </p>
      )}
    </GlassCard>
  );
};

export default PermissionsCard;
