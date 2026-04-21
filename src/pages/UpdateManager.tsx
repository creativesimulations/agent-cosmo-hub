import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, AlertCircle, Loader2, CheckCircle2, Info } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import { useSettings } from "@/contexts/SettingsContext";
import { systemAPI } from "@/lib/systemAPI";
import { toast } from "@/hooks/use-toast";

const LAST_CHECK_KEY = "ronbot-update-last-check-v1";
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 h

const UpdateManager = () => {
  const { connected: agentConnected } = useAgentConnection();
  const { settings } = useSettings();
  const [checking, setChecking] = useState(false);
  const [output, setOutput] = useState<string[]>([]);
  const [lastChecked, setLastChecked] = useState<Date | null>(() => {
    try {
      const raw = localStorage.getItem(LAST_CHECK_KEY);
      return raw ? new Date(raw) : null;
    } catch {
      return null;
    }
  });
  const autoFiredRef = useRef(false);

  const runUpdate = useCallback(async () => {
    if (!agentConnected) return;
    setChecking(true);
    setOutput([]);
    const r = await systemAPI.hermesUpdate();
    const lines = [r.stdout, r.stderr].filter(Boolean).join("\n").split("\n").filter(Boolean);
    setOutput(lines.slice(-200));
    const now = new Date();
    setLastChecked(now);
    try {
      localStorage.setItem(LAST_CHECK_KEY, now.toISOString());
    } catch {
      /* ignore */
    }
    setChecking(false);
    if (r.success) {
      toast({ title: "Update check complete", description: "Hermes is up to date." });
    } else {
      toast({
        title: "Update failed",
        description: r.stderr?.split("\n")[0] || "See output below for details.",
        variant: "destructive",
      });
    }
  }, [agentConnected]);

  // Auto-check once after mount if enabled and we haven't checked recently.
  useEffect(() => {
    if (!settings.autoCheckUpdates || !agentConnected || autoFiredRef.current) return;
    const fresh = lastChecked && Date.now() - lastChecked.getTime() < AUTO_CHECK_INTERVAL_MS;
    if (fresh) {
      autoFiredRef.current = true;
      return;
    }
    autoFiredRef.current = true;
    void runUpdate();
  }, [settings.autoCheckUpdates, agentConnected, lastChecked, runUpdate]);

  if (!agentConnected) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <RefreshCw className="w-6 h-6 text-primary" />
            Update Manager
          </h1>
          <p className="text-sm text-muted-foreground">Keep your agent up to date</p>
        </div>
        <GlassCard className="flex items-center justify-center py-16">
          <div className="text-center space-y-3">
            <AlertCircle className="w-10 h-10 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">No agent connected</p>
            <p className="text-xs text-muted-foreground/60">Install and start an agent to check for updates</p>
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <RefreshCw className="w-6 h-6 text-primary" />
            Update Manager
          </h1>
          <p className="text-sm text-muted-foreground">
            {settings.autoCheckUpdates
              ? "Auto-checking for updates every 6 hours."
              : "Auto-update is disabled in Settings."}
          </p>
        </div>
        <Button
          onClick={() => void runUpdate()}
          disabled={checking}
          className="gradient-primary text-primary-foreground"
        >
          {checking ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Checking…</>
          ) : (
            <><RefreshCw className="w-4 h-4 mr-2" /> Check for updates</>
          )}
        </Button>
      </div>

      <GlassCard className="space-y-3">
        <div className="flex items-center gap-2">
          {checking ? (
            <Loader2 className="w-4 h-4 text-primary animate-spin" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-success" />
          )}
          <p className="text-sm text-foreground">
            {checking
              ? "Running hermes update…"
              : lastChecked
                ? `Last checked ${lastChecked.toLocaleString()}`
                : "Not checked yet."}
          </p>
        </div>

        {output.length > 0 && (
          <pre className="font-mono text-xs bg-background/50 border border-border rounded-md p-3 max-h-72 overflow-auto whitespace-pre-wrap">
            {output.join("\n")}
          </pre>
        )}

        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <p>
            Updates are pulled with <code>hermes update</code> against the official upstream.
            Toggle auto-checking in Settings → Updates.
          </p>
        </div>
      </GlassCard>
    </div>
  );
};

export default UpdateManager;
