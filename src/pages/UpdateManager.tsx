import { RefreshCw, AlertCircle } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";

const UpdateManager = () => {
  const agentConnected = false;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <RefreshCw className="w-6 h-6 text-primary" />
          Update Manager
        </h1>
        <p className="text-sm text-muted-foreground">Keep your agent up to date</p>
      </div>

      <GlassCard className="flex items-center justify-center py-16">
        <div className="text-center space-y-3">
          <AlertCircle className="w-10 h-10 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground">No agent connected</p>
          <p className="text-xs text-muted-foreground/60">Install and start an agent to check for updates</p>
        </div>
      </GlassCard>
    </div>
  );
};

export default UpdateManager;
