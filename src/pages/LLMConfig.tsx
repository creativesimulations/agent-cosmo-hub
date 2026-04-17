import { Cpu, AlertCircle } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";

const LLMConfig = () => {
  const { connected: agentConnected } = useAgentConnection();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Cpu className="w-6 h-6 text-primary" />
          LLM Configuration
        </h1>
        <p className="text-sm text-muted-foreground">Configure which models your agents can use</p>
      </div>

      <GlassCard className="flex items-center justify-center py-16">
        <div className="text-center space-y-3">
          <AlertCircle className="w-10 h-10 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground">No agent connected</p>
          <p className="text-xs text-muted-foreground/60">Install and start an agent to configure LLM providers and models</p>
        </div>
      </GlassCard>
    </div>
  );
};

export default LLMConfig;
