import { motion } from "framer-motion";
import {
  Activity,
  Cpu,
  HardDrive,
  Clock,
  RefreshCw,
  Pause,
  Terminal,
  Network,
  ArrowUpRight,
} from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import StatusBadge from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/button";

const mockSubAgents = [
  { id: 1, name: "research-agent", task: "Analyzing market trends for Q4", model: "gpt-4o", tokens: "12.4k" },
  { id: 2, name: "code-writer", task: "Implementing REST API endpoints", model: "claude-3.5-sonnet", tokens: "8.2k" },
  { id: 3, name: "data-parser", task: "Processing CSV dataset (2.3GB)", model: "gpt-4o-mini", tokens: "3.1k" },
];

const mockLogs = [
  { time: "14:23:05", level: "info", msg: "Sub-agent 'research-agent' spawned successfully" },
  { time: "14:22:58", level: "info", msg: "Task delegation: market analysis → research-agent" },
  { time: "14:22:41", level: "warn", msg: "Rate limit approaching for OpenAI provider (80%)" },
  { time: "14:22:30", level: "info", msg: "code-writer completed: database schema migration" },
  { time: "14:21:15", level: "info", msg: "Gateway health check: all systems nominal" },
];

const Dashboard = () => {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Monitor your Hermes agent in real-time</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
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

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Status", value: "Online", icon: Activity, accent: "text-success" },
          { label: "Uptime", value: "4h 23m", icon: Clock, accent: "text-accent" },
          { label: "CPU Usage", value: "34%", icon: Cpu, accent: "text-primary" },
          { label: "Memory", value: "1.2 GB", icon: HardDrive, accent: "text-warning" },
        ].map((metric, i) => (
          <GlassCard key={i} variant="subtle">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{metric.label}</p>
                <p className={`text-xl font-bold ${metric.accent}`}>{metric.value}</p>
              </div>
              <metric.icon className={`w-5 h-5 ${metric.accent} opacity-60`} />
            </div>
          </GlassCard>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Sub-agents */}
        <div className="col-span-2">
          <GlassCard className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Network className="w-4 h-4 text-primary" />
                Active Sub-Agents
              </h2>
              <span className="text-xs text-muted-foreground">{mockSubAgents.length} running</span>
            </div>
            <div className="space-y-2">
              {mockSubAgents.map((agent) => (
                <div
                  key={agent.id}
                  className="glass-subtle rounded-lg p-3 flex items-center justify-between group hover:border-primary/20 transition-all"
                >
                  <div className="flex items-center gap-3">
                    <StatusBadge status="busy" />
                    <div>
                      <p className="text-sm font-medium text-foreground">{agent.name}</p>
                      <p className="text-xs text-muted-foreground">{agent.task}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs font-mono text-accent">{agent.model}</span>
                    <span className="text-xs text-muted-foreground">{agent.tokens} tokens</span>
                    <ArrowUpRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>

        {/* Activity Log */}
        <GlassCard className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Activity className="w-4 h-4 text-accent" />
            Activity Feed
          </h2>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {mockLogs.map((log, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex gap-2 text-xs"
              >
                <span className="text-muted-foreground font-mono shrink-0">{log.time}</span>
                <span
                  className={
                    log.level === "warn"
                      ? "text-warning"
                      : log.level === "error"
                      ? "text-destructive"
                      : "text-foreground/70"
                  }
                >
                  {log.msg}
                </span>
              </motion.div>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
};

export default Dashboard;
