import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Cpu,
  HardDrive,
  Clock,
  RefreshCw,
  Pause,
  Terminal,
  Network,
  AlertCircle,
} from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { systemAPI } from "@/lib/systemAPI";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";

const parseStatusOutput = (stdout: string) => {
  const values = stdout.split("\n").reduce<Record<string, string>>((acc, line) => {
    const [label, ...rest] = line.split(":");
    if (!label || rest.length === 0) return acc;
    acc[label.trim().toLowerCase()] = rest.join(":").trim();
    return acc;
  }, {});

  return {
    status: values.status || "Detected",
    uptime: values.uptime || "—",
    model: values.model || "Configured",
  };
};

const Dashboard = () => {
  const { connected: agentConnected, location } = useAgentConnection();
  const [metrics, setMetrics] = useState({ status: "—", uptime: "—", model: "—" });

  const loadStatus = useCallback(async () => {
    if (!agentConnected) return;
    const result = await systemAPI.hermesStatus();
    if (result.success) {
      setMetrics(parseStatusOutput(result.stdout));
      return;
    }
    setMetrics({ status: "Detected", uptime: "—", model: "Configured" });
  }, [agentConnected]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  if (!agentConnected) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <GlassCard className="max-w-md w-full text-center space-y-4 py-12">
          <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto opacity-40" />
          <h2 className="text-xl font-semibold text-foreground">No Agent Connected</h2>
          <p className="text-sm text-muted-foreground">
            Install or connect to an agent to see live metrics, sub-agents, and activity.
          </p>
          <Button
            variant="ghost"
            className="text-primary hover:text-primary"
            onClick={() => window.location.hash = "#/"}
          >
            Go to Setup
          </Button>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Monitor your agent in real-time</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={() => void loadStatus()}>
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
            <Pause className="w-4 h-4 mr-1" /> Pause
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
            <Terminal className="w-4 h-4 mr-1" /> Terminal
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Status", value: metrics.status, icon: Activity, accent: "text-foreground" },
          { label: "Uptime", value: metrics.uptime, icon: Clock, accent: "text-foreground" },
          { label: "Model", value: metrics.model, icon: Cpu, accent: "text-foreground" },
          { label: "Install Path", value: location ?? "~/.hermes", icon: HardDrive, accent: "text-foreground" },
        ].map((metric, i) => (
          <GlassCard key={i} variant="subtle">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <p className="text-xs text-muted-foreground">{metric.label}</p>
                <p className={`text-xl font-bold ${metric.accent} break-all`}>{metric.value}</p>
              </div>
              <metric.icon className={`w-5 h-5 ${metric.accent} opacity-60 shrink-0`} />
            </div>
          </GlassCard>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <GlassCard className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Network className="w-4 h-4 text-primary" />
                Active Sub-Agents
              </h2>
              <span className="text-xs text-muted-foreground">0 running</span>
            </div>
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">No active sub-agents</p>
            </div>
          </GlassCard>
        </div>

        <GlassCard className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Activity className="w-4 h-4 text-accent" />
            Activity Feed
          </h2>
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">No recent activity</p>
          </div>
        </GlassCard>
      </div>
    </div>
  );
};

export default Dashboard;
