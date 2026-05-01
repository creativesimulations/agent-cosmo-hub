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
import AgentPowerCard from "@/components/dashboard/AgentPowerCard";
import CapabilityGallery from "@/components/dashboard/CapabilityGallery";

/** Parse `hermes status` output into a flat key/value map. */
const parseStatusOutput = (stdout: string) => {
  return stdout.split("\n").reduce<Record<string, string>>((acc, line) => {
    const [label, ...rest] = line.split(":");
    if (!label || rest.length === 0) return acc;
    acc[label.trim().toLowerCase()] = rest.join(":").trim();
    return acc;
  }, {});
};

/**
 * Map raw `hermes status` output to a UI-friendly status string.
 *
 * Hermes is a CLI, not a long-running daemon. `hermes status` reports on the
 * optional *messaging gateway* (Telegram/Discord/etc.) which is almost never
 * running for a fresh install. So a literal "stopped" reading just means
 * "the gateway isn't up" — the agent itself is perfectly usable for chat.
 */
const deriveDisplayStatus = (
  raw: Record<string, string>,
  installed: boolean,
): string => {
  if (!installed) return "Not configured";
  const s = (raw.status || "").toLowerCase();
  if (/run|active|online|up|started/.test(s)) return "Gateway running";
  return "Ready";
};

const readConfiguredModel = (config: string) => {
  const match = config.match(/^\s*model:\s*(.+)\s*$/m);
  return match ? match[1].trim().replace(/^['"]|['"]$/g, "") : null;
};

/** Format ms as "1h 23m" / "12m 04s" / "45s". */
const formatElapsed = (ms: number): string => {
  if (ms < 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
};

const Dashboard = () => {
  const { connected: agentConnected, agentRunning, location, connectedSince, frozenUptimeMs } = useAgentConnection();
  const [metrics, setMetrics] = useState({ status: "—", uptime: "—", model: "—" });
  const [, forceTick] = useState(0);

  // Tick every second to keep the elapsed-time uptime fresh.
  // Only tick while the agent is actively running — once it's off the
  // displayed value should freeze at the last reading.
  useEffect(() => {
    if (!agentConnected || !agentRunning) return;
    const id = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [agentConnected, agentRunning]);

  const loadStatus = useCallback(async () => {
    if (!agentConnected) return;
    const [statusResult, configResult] = await Promise.all([
      systemAPI.hermesStatus(),
      systemAPI.readConfig(),
    ]);
    const configuredModel =
      configResult.success && configResult.content
        ? readConfiguredModel(configResult.content)
        : null;

    const raw = statusResult.success ? parseStatusOutput(statusResult.stdout) : {};
    const status = deriveDisplayStatus(raw, agentConnected);

    setMetrics((prev) => ({
      status,
      uptime: status === "Gateway running" && raw.uptime ? raw.uptime : prev.uptime,
      model: configuredModel || raw.model || "Configured",
    }));
  }, [agentConnected]);

  useEffect(() => {
    void loadStatus();
    if (!agentConnected) return;
    const interval = window.setInterval(() => void loadStatus(), 5000);
    const onFocus = () => void loadStatus();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadStatus, agentConnected]);

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

      <AgentPowerCard />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">

        {[
          { label: "Status", value: metrics.status, icon: Activity, accent: "text-foreground" },
          {
            label: "Uptime",
            value:
              metrics.status === "Gateway running" && metrics.uptime !== "—"
                ? metrics.uptime
                : connectedSince
                  ? formatElapsed(Date.now() - connectedSince)
                  : frozenUptimeMs !== null
                    ? formatElapsed(frozenUptimeMs)
                    : "—",
            icon: Clock,
            accent: "text-foreground",
          },
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

      <CapabilityGallery />
    </div>
  );
};

export default Dashboard;
