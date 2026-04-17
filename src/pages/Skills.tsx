import { Puzzle, AlertCircle } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";

const Skills = () => {
  const { connected: agentConnected } = useAgentConnection();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Puzzle className="w-6 h-6 text-primary" />
          Skills Manager
        </h1>
        <p className="text-sm text-muted-foreground">Enable and manage agent capabilities</p>
      </div>

      <GlassCard className="flex items-center justify-center py-16">
        <div className="text-center space-y-3">
          <AlertCircle className="w-10 h-10 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground">No agent connected</p>
          <p className="text-xs text-muted-foreground/60">Install and start an agent to manage skills</p>
        </div>
      </GlassCard>
    </div>
  );
};

export default Skills;
