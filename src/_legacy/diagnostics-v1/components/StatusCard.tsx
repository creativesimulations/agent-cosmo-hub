import GlassCard from "@/components/ui/GlassCard";
import { cn } from "@/lib/utils";
import type { DoctorReport } from "@/hooks/useDoctorReport";

const StatusCard = ({ report }: { report: DoctorReport }) => {
  const { storeSummary, envSummary, cfgSummary, permsBlock, browserDiag } = report;
  return (
    <GlassCard className="p-4 space-y-3">
      <h2 className="text-sm font-semibold">Current status</h2>
      <ul className="space-y-2 text-xs">
        <li className="flex items-center gap-2">
          <span className={cn("w-2 h-2 rounded-full", storeSummary.error ? "bg-destructive" : "bg-success")} />
          Secrets store: {storeSummary.error ? "error" : `${storeSummary.entries.length} key(s) saved`}
        </li>
        <li className="flex items-center gap-2">
          <span className={cn("w-2 h-2 rounded-full", envSummary.error ? "bg-destructive" : "bg-success")} />
          Env sync: {envSummary.error ? "error reading .env" : `${envSummary.entries.length} key(s) in ~/.hermes/.env`}
        </li>
        <li className="flex items-center gap-2">
          <span className={cn("w-2 h-2 rounded-full", cfgSummary.error || !cfgSummary.modelLine ? "bg-warning" : "bg-success")} />
          Model config: {cfgSummary.modelLine ? cfgSummary.modelLine : "not configured"}
        </li>
        <li className="flex items-center gap-2">
          <span className={cn("w-2 h-2 rounded-full", permsBlock ? "bg-success" : "bg-warning")} />
          Permissions block: {permsBlock ? "present" : "not synced yet"}
        </li>
        <li className="flex items-center gap-2">
          <span
            className={cn(
              "w-2 h-2 rounded-full",
              browserDiag && browserDiag.cdpReachable && browserDiag.browserEnabledInConfig && browserDiag.hermesWebToolsetLoaded
                ? "bg-success"
                : "bg-warning",
            )}
          />
          Browser chain: {browserDiag ? (browserDiag.cdpReachable ? "ready" : "needs attention") : "checking"}
        </li>
      </ul>
    </GlassCard>
  );
};

export default StatusCard;
