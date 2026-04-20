import { useCallback, useEffect, useMemo, useState } from "react";
import { Network, AlertCircle, RefreshCw, Loader2, CheckCircle2, Activity, FileText } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import StatusBadge from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/button";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import { systemAPI } from "@/lib/systemAPI";
import { toast } from "@/hooks/use-toast";

type ActiveSubAgent = {
  id: string;
  goal: string;
  startedAt: string;
  lastActivity?: string;
  lastEvent?: string;
};

type RecentSubAgent = {
  id: string;
  goal: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  summary?: string;
};

const formatDuration = (ms: number) => {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
};

const formatRelative = (iso: string) => {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 0) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleString();
};

const SubAgents = () => {
  const { connected: agentConnected } = useAgentConnection();
  const [active, setActive] = useState<ActiveSubAgent[]>([]);
  const [recent, setRecent] = useState<RecentSubAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logPath, setLogPath] = useState<string>("~/.hermes/logs/agent.log");
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const refresh = useCallback(
    async (showToast = false) => {
      if (!agentConnected) return;
      setLoading(true);
      setError(null);
      try {
        const res = await systemAPI.listSubAgents();
        setLogPath(res.logPath);
        if (!res.success) {
          setError(res.error || "Failed to read agent log");
          if (showToast) {
            toast({
              title: "Couldn't load sub-agents",
              description: res.error || "Failed to read agent log",
              variant: "destructive",
            });
          }
        } else {
          setActive(res.active);
          setRecent(res.recent);
        }
        setLastFetched(new Date());
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [agentConnected],
  );

  // Initial load + 3s polling while connected.
  useEffect(() => {
    if (!agentConnected) return;
    void refresh();
    const id = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(id);
  }, [agentConnected, refresh]);

  const totalCount = useMemo(() => active.length + recent.length, [active, recent]);

  if (!agentConnected) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Network className="w-6 h-6 text-primary" />
            Sub-Agent Monitor
          </h1>
          <p className="text-sm text-muted-foreground">
            View the agent hierarchy and manage sub-agents
          </p>
        </div>
        <GlassCard className="text-center py-12 space-y-3">
          <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto opacity-40" />
          <p className="text-sm text-muted-foreground">
            Connect to an agent to view sub-agents.
          </p>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Network className="w-6 h-6 text-primary" />
            Sub-Agent Monitor
          </h1>
          <p className="text-sm text-muted-foreground">
            Live view of delegated sub-agents spawned by the main agent
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastFetched && (
            <span className="text-xs text-muted-foreground">
              Updated {formatRelative(lastFetched.toISOString())}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh(true)}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <GlassCard className="border-destructive/40 bg-destructive/5">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">Couldn't read sub-agent activity</p>
              <p className="text-xs text-muted-foreground">{error}</p>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Active */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            Active
            <StatusBadge status={active.length > 0 ? "active" : "neutral"}>
              {active.length}
            </StatusBadge>
          </h2>
        </div>
        {active.length === 0 ? (
          <GlassCard className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No sub-agents are running right now.
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              The main agent spawns sub-agents when it uses the <code>delegate_task</code> tool.
            </p>
          </GlassCard>
        ) : (
          <div className="grid gap-3">
            {active.map((sa) => (
              <GlassCard key={sa.id} className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <Loader2 className="w-4 h-4 text-primary animate-spin mt-1 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground break-words">{sa.goal}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                        <span>Started {formatRelative(sa.startedAt)}</span>
                        {sa.lastActivity && sa.lastActivity !== sa.startedAt && (
                          <span>Last activity {formatRelative(sa.lastActivity)}</span>
                        )}
                        {sa.lastEvent && (
                          <span className="text-primary/80">{sa.lastEvent}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <StatusBadge status="active">running</StatusBadge>
                </div>
              </GlassCard>
            ))}
          </div>
        )}
      </section>

      {/* Recent */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            Recently completed
            <StatusBadge status="neutral">{recent.length}</StatusBadge>
          </h2>
        </div>
        {recent.length === 0 ? (
          <GlassCard className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No completed sub-agents in the last 24 hours.
            </p>
          </GlassCard>
        ) : (
          <div className="grid gap-3">
            {recent.map((sa) => (
              <GlassCard key={sa.id} className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <CheckCircle2 className="w-4 h-4 text-primary mt-1 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground break-words">{sa.goal}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                        <span>Finished {formatRelative(sa.completedAt)}</span>
                        <span>Duration {formatDuration(sa.durationMs)}</span>
                      </div>
                    </div>
                  </div>
                  <StatusBadge status="success">done</StatusBadge>
                </div>
              </GlassCard>
            ))}
          </div>
        )}
      </section>

      {totalCount === 0 && !error && (
        <GlassCard className="bg-muted/10 border-muted/20">
          <div className="flex items-start gap-3">
            <FileText className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="text-xs text-muted-foreground space-y-1">
              <p>
                Sub-agent activity is parsed from <code>{logPath}</code>. If the agent has never
                delegated a task, this view will be empty.
              </p>
              <p className="opacity-70">
                Auto-refreshing every 3 seconds.
              </p>
            </div>
          </div>
        </GlassCard>
      )}
    </div>
  );
};

export default SubAgents;
