import { motion } from "framer-motion";
import {
  Activity, Cpu, HardDrive, Clock, RefreshCw, Pause, Terminal,
  Network, ArrowUpRight, DollarSign, BarChart3, AlertCircle,
} from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import StatusBadge from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

const Dashboard = () => {
  // TODO: Replace with real agent status from systemAPI
  const agentConnected = false;

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

      {/* Metrics Row */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Status", value: "—", icon: Activity, accent: "text-muted-foreground" },
          { label: "Uptime", value: "—", icon: Clock, accent: "text-muted-foreground" },
          { label: "CPU Usage", value: "—", icon: Cpu, accent: "text-muted-foreground" },
          { label: "Memory", value: "—", icon: HardDrive, accent: "text-muted-foreground" },
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
              <span className="text-xs text-muted-foreground">0 running</span>
            </div>
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">No active sub-agents</p>
            </div>
          </GlassCard>
        </div>

        {/* Activity Log */}
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
