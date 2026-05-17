import { CheckCircle2 } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/badge";
import ActionableError from "@/components/ui/ActionableError";
import { cn } from "@/lib/utils";
import type { DoctorReport } from "@/hooks/useDoctorReport";

const EnvConfigCards = ({ report }: { report: DoctorReport }) => {
  const { envSummary, cfgSummary, refreshSummaries } = report;
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <GlassCard className="p-4 space-y-2">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-primary" />
          ~/.hermes/.env (key names + lengths only)
        </h2>
        {envSummary.error ? (
          <ActionableError
            title="Could not read ~/.hermes/.env"
            summary={envSummary.error}
            details={envSummary.error}
            onFix={refreshSummaries}
            fixLabel="Refresh diagnostics"
          />
        ) : envSummary.entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">No keys present in .env (or file does not exist).</p>
        ) : (
          <ul className="text-xs font-mono space-y-1">
            {envSummary.entries.map((e) => (
              <li key={e.key} className="flex items-center gap-2">
                <span className={cn(e.valueLength > 0 ? "text-foreground" : "text-destructive")}>{e.key}</span>
                <span className="text-muted-foreground">= ({e.valueLength} chars)</span>
                {e.managed && <Badge variant="outline" className="text-[9px] py-0 px-1">secret</Badge>}
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      <GlassCard className="p-4 space-y-2">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-primary" />
          ~/.hermes/config.yaml
        </h2>
        {cfgSummary.error ? (
          <ActionableError
            title="Could not read ~/.hermes/config.yaml"
            summary={cfgSummary.error}
            details={cfgSummary.error}
            onFix={refreshSummaries}
            fixLabel="Refresh diagnostics"
          />
        ) : cfgSummary.modelLine ? (
          <p className="text-xs font-mono">model: <span className="text-primary">{cfgSummary.modelLine}</span></p>
        ) : (
          <p className="text-xs text-muted-foreground">No model configured.</p>
        )}
        {cfgSummary.raw && (
          <details className="text-[11px] text-muted-foreground">
            <summary className="cursor-pointer">Show full config</summary>
            <pre className="mt-1 p-2 rounded bg-background/40 border border-white/5 font-mono whitespace-pre-wrap">
              {cfgSummary.raw}
            </pre>
          </details>
        )}
      </GlassCard>
    </div>
  );
};

export default EnvConfigCards;
