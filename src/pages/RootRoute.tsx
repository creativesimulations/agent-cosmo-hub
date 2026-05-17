import { useEffect, useState } from "react";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import { Loader2 } from "lucide-react";
import Home from "./Home";
import SetupInstallPage from "./SetupInstallPage";

/**
 * Smart root route: Home when connected, setup hub otherwise.
 * Full wizard remains at /install.
 */
const RootRoute = () => {
  const { connected, status } = useAgentConnection();
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (status !== "checking" && status !== "unknown") setSettled(true);
  }, [status]);

  if (!settled) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-screen">
        <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
      </div>
    );
  }

  return connected ? <Home /> : <SetupInstallPage />;
};

export default RootRoute;
