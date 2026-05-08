import { CheckCircle2 } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/badge";
import ActionableError from "@/components/ui/ActionableError";
import { cn } from "@/lib/utils";
import type { DoctorReport } from "@/hooks/useDoctorReport";

const CredentialStoreCard = ({ report }: { report: DoctorReport }) => {
  const { storeSummary, refreshSummaries } = report;
  return (
    <GlassCard className="p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-primary" />
          OS credential store
          {storeSummary.backend && (
            <Badge variant="outline" className="text-[9px] py-0 px-1.5 ml-1">
              {storeSummary.backend.label}
            </Badge>
          )}
        </h2>
        <span className="text-[11px] text-muted-foreground">What's actually saved (before materialize)</span>
      </div>
      {storeSummary.error ? (
        <ActionableError
          title="Could not read credential store"
          summary={storeSummary.error}
          details={storeSummary.error}
          onFix={refreshSummaries}
          fixLabel="Refresh diagnostics"
        />
      ) : storeSummary.entries.length === 0 ? (
        <p className="text-xs text-destructive">
          ⚠ No keys in the credential store. Add them in the Secrets tab. If keys disappear after re-adding,
          the OS backend ({storeSummary.backend?.backend ?? "unknown"}) isn't persisting them — check Logs for errors.
        </p>
      ) : (
        <ul className="text-xs font-mono space-y-1">
          {storeSummary.entries.map((e) => (
            <li key={e.key} className="flex items-center gap-2">
              <span className={cn(e.valueLength > 0 ? "text-foreground" : "text-destructive")}>{e.key}</span>
              <span className="text-muted-foreground">= ({e.valueLength} chars)</span>
              {e.valueLength === 0 && <Badge variant="destructive" className="text-[9px] py-0 px-1">empty</Badge>}
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
};

export default CredentialStoreCard;
