// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { HermesProbeSummary } from "@/features/setup/components/HermesProbeSummary";
import { classifyHermesInstallProbe } from "@/lib/systemAPI/hermes/installProbe";
import { systemAPI } from "@/lib/systemAPI";

export function HermesInstallProbeCard() {
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState<string>("");
  const [state, setState] = useState<Awaited<ReturnType<typeof systemAPI.inspectHermesInstall>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const probe = await systemAPI.inspectHermesInstall();
        if (cancelled) return;
        setState(probe);
        setReason(classifyHermesInstallProbe(probe));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <GlassCard className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Hermes install probe</h3>
      {loading ? (
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" /> Running shell probe…
        </p>
      ) : state ? (
        <>
          <p className="text-xs text-muted-foreground">
            Classification: <span className="font-mono text-foreground">{reason}</span>
          </p>
          <HermesProbeSummary state={state} />
        </>
      ) : (
        <p className="text-xs text-destructive">Probe failed</p>
      )}
    </GlassCard>
  );
}
