import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Activity,
  Cpu,
  HardDrive,
  Clock,
  RefreshCw,
  MessageSquare,
  Radio,
  Sparkles,
  BarChart3,
  Settings as SettingsIcon,
  ExternalLink,
  Bot,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Terminal,
  Wrench,
} from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { systemAPI } from "@/lib/systemAPI";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import { useChat } from "@/contexts/ChatContext";
import AgentPowerCard from "@/components/dashboard/AgentPowerCard";
import CapabilityGallery from "@/components/dashboard/CapabilityGallery";
import ronbotLogo from "@/assets/ronbot-logo.png";

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

const readConfiguredModel = (config: string) => {
  const match = config.match(/^\s*model:\s*(.+)\s*$/m);
  return match ? match[1].trim().replace(/^['"]|['"]$/g, "") : null;
};

type HealthLevel = "healthy" | "degraded" | "unknown";

const Home = () => {
  const navigate = useNavigate();
  const {
    connected,
    agentRunning,
    location,
    connectedSince,
    frozenUptimeMs,
  } = useAgentConnection();
  const { isStreaming } = useChat();

  const [agentName, setAgentName] = useState<string>("Agent");
  const [model, setModel] = useState<string>("—");
  const [health, setHealth] = useState<HealthLevel>("unknown");
  const [healthDetail, setHealthDetail] = useState<string>("Checking…");
  const [, forceTick] = useState(0);
  const [launchingDash, setLaunchingDash] = useState(false);

  // Tick uptime
  useEffect(() => {
    if (!connected || !agentRunning) return;
    const id = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [connected, agentRunning]);

  const refreshOverview = useCallback(async () => {
    if (!connected) return;
    const [nameRes, configRes] = await Promise.all([
      systemAPI.getAgentName().catch(() => null),
      systemAPI.readConfig().catch(() => ({ success: false, content: "" } as { success: boolean; content?: string })),
    ]);
    if (nameRes) setAgentName(nameRes);
    if (configRes.success && configRes.content) {
      const m = readConfiguredModel(configRes.content);
      if (m) setModel(m);
    }

    // Lightweight health probe: doctor would be heavy; use chatPing.
    try {
      const r = await systemAPI.chatPing();
      if (r.success) {
        setHealth("healthy");
        setHealthDetail("All systems nominal");
      } else {
        setHealth("degraded");
        setHealthDetail("Agent reachable but reporting issues — open Diagnostics");
      }
    } catch {
      setHealth("degraded");
      setHealthDetail("Could not reach agent — check connection");
    }
  }, [connected]);

  useEffect(() => {
    void refreshOverview();
    if (!connected) return;
    const id = window.setInterval(() => void refreshOverview(), 15000);
    const onFocus = () => void refreshOverview();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshOverview, connected]);

  const uptimeText = connectedSince
    ? formatElapsed(Date.now() - connectedSince)
    : frozenUptimeMs !== null
      ? `${formatElapsed(frozenUptimeMs)} (paused)`
      : "—";

  const handleOpenHermesDashboard = async () => {
    setLaunchingDash(true);
    try {
      const r = await systemAPI.launchHermesDashboard();
      if (!r.success) {
        toast.error("Couldn't launch Hermes Dashboard", {
          description: r.error || "The `hermes dashboard` command isn't available on your install.",
        });
        return;
      }
      if (r.url) {
        window.open(r.url, "_blank", "noopener,noreferrer");
        toast.success("Hermes Dashboard launched", { description: r.url });
      } else {
        toast.success("Hermes Dashboard launched", {
          description: "Check your browser — Hermes opened it for you.",
        });
      }
    } finally {
      setLaunchingDash(false);
    }
  };

  const healthIcon =
    health === "healthy" ? (
      <CheckCircle2 className="w-5 h-5 text-success" />
    ) : health === "degraded" ? (
      <AlertTriangle className="w-5 h-5 text-warning" />
    ) : (
      <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
    );

  const quickActions = [
    { label: "Chat", icon: MessageSquare, path: "/chat", accent: "primary" },
    { label: "Channels", icon: Radio, path: "/channels", accent: "accent" },
    { label: "Skills & Tools", icon: Sparkles, path: "/skills", accent: "primary" },
    { label: "Insights", icon: BarChart3, path: "/insights", accent: "accent" },
    { label: "Diagnostics", icon: Wrench, path: "/diagnostics", accent: "primary" },
    { label: "Settings", icon: SettingsIcon, path: "/settings", accent: "accent" },
  ] as const;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <img src={ronbotLogo} alt="" className="w-10 h-10 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-foreground truncate">
              {agentName}
            </h1>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              {healthIcon}
              <span>{healthDetail}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => void refreshOverview()}
          >
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => navigate("/terminal")}
          >
            <Terminal className="w-4 h-4 mr-1" /> Terminal
          </Button>
        </div>
      </div>

      {/* Power + key stats row */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AgentPowerCard />
        </div>
        <GlassCard className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            Health
          </h2>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <span className="text-foreground font-medium flex items-center gap-1.5">
                {agentRunning ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                    {isStreaming ? "Responding" : "On"}
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full bg-muted-foreground" />
                    Off
                  </>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" /> Uptime
              </span>
              <span className="text-foreground font-medium">{uptimeText}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5" /> Model
              </span>
              <span className="text-foreground font-medium truncate max-w-[140px]" title={model}>
                {model}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5" /> Path
              </span>
              <span className="text-foreground font-medium truncate max-w-[140px]" title={location ?? "~/.hermes"}>
                {location ?? "~/.hermes"}
              </span>
            </div>
          </div>
        </GlassCard>
      </div>

      {/* Quick actions */}
      <GlassCard className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Bot className="w-4 h-4 text-primary" />
            Quick actions
          </h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {quickActions.map((a) => (
            <motion.button
              key={a.path}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => navigate(a.path)}
              className="glass-subtle rounded-lg p-3 flex flex-col items-start gap-2 text-left hover:border-primary/30 border border-transparent transition-colors"
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                  a.accent === "primary" ? "bg-primary/15 text-primary" : "bg-accent/15 text-accent"
                }`}
              >
                <a.icon className="w-4 h-4" />
              </div>
              <span className="text-sm font-medium text-foreground">{a.label}</span>
            </motion.button>
          ))}
        </div>

        {/* Hermes Dashboard delegation */}
        <div className="border-t border-white/5 pt-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Hermes Dashboard</p>
            <p className="text-xs text-muted-foreground">
              The agent ships its own web dashboard for deep config, sessions, and gateway internals.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={launchingDash || !connected}
            onClick={handleOpenHermesDashboard}
          >
            {launchingDash ? (
              <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Launching…</>
            ) : (
              <><ExternalLink className="w-4 h-4 mr-1" /> Open</>
            )}
          </Button>
        </div>
      </GlassCard>

      {/* Capability gallery (auto-discovered) */}
      <CapabilityGallery />
    </div>
  );
};

export default Home;
