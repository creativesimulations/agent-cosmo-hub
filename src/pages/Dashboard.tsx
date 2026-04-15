import { motion } from "framer-motion";
import {
  Activity, Cpu, HardDrive, Clock, RefreshCw, Pause, Terminal,
  Network, ArrowUpRight, Gpu, DollarSign, BarChart3,
} from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import StatusBadge from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

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
          <p className="text-sm text-muted-foreground">Monitor your agent in real-time</p>
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

      {/* Metrics Row 1 */}
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

      {/* Resource Monitor */}
      <div className="grid grid-cols-3 gap-4">
        <GlassCard variant="subtle" className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <BarChart3 className="w-3 h-3 text-primary" /> GPU Utilization
            </h3>
            <span className="text-xs text-muted-foreground">Ollama</span>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">VRAM</span>
              <span className="text-foreground">6.2 / 8.0 GB</span>
            </div>
            <Progress value={78} className="h-1.5" />
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Compute</span>
              <span className="text-foreground">42%</span>
            </div>
            <Progress value={42} className="h-1.5" />
          </div>
        </GlassCard>

        <GlassCard variant="subtle" className="space-y-3">
          <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <Activity className="w-3 h-3 text-accent" /> Token Usage (Today)
          </h3>
          <div className="space-y-2">
            {[
              { provider: "OpenAI", tokens: "84.2k", cost: "$1.26" },
              { provider: "Anthropic", tokens: "23.1k", cost: "$0.69" },
              { provider: "Ollama", tokens: "142.0k", cost: "Free" },
            ].map((p) => (
              <div key={p.provider} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{p.provider}</span>
                <div className="flex items-center gap-3">
                  <span className="text-foreground font-mono">{p.tokens}</span>
                  <span className="text-accent">{p.cost}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="pt-2 border-t border-white/5 flex justify-between text-xs">
            <span className="text-muted-foreground font-medium">Total Cost</span>
            <span className="text-primary font-semibold">$1.95</span>
          </div>
        </GlassCard>

        <GlassCard variant="subtle" className="space-y-3">
          <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <DollarSign className="w-3 h-3 text-warning" /> Cost History (7d)
          </h3>
          <div className="flex items-end gap-1 h-16">
            {[0.8, 1.2, 0.5, 2.1, 1.8, 1.5, 1.95].map((v, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full rounded-sm gradient-primary opacity-70"
                  style={{ height: `${(v / 2.5) * 100}%` }}
                />
                <span className="text-[8px] text-muted-foreground">
                  {["M", "T", "W", "T", "F", "S", "S"][i]}
                </span>
              </div>
            ))}
          </div>
        </GlassCard>
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
