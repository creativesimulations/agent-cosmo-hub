import { Network, AlertCircle } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";

const SubAgents = () => {
  const { connected: agentConnected } = useAgentConnection();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Network className="w-6 h-6 text-primary" />
          Sub-Agent Monitor
        </h1>
        <p className="text-sm text-muted-foreground">View the agent hierarchy and manage sub-agents</p>
      </div>

      <GlassCard className="text-center py-12 space-y-3">
        <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto opacity-40" />
        <p className="text-sm text-muted-foreground">
          {agentConnected
            ? "No sub-agents are currently running."
            : "Connect to an agent to view sub-agents."}
        </p>
      </GlassCard>
    </div>
  );
};

export default SubAgents;
