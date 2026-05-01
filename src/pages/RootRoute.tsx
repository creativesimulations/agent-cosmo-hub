import { useEffect, useState } from "react";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import { Loader2 } from "lucide-react";
import Home from "./Home";
import Index from "./Index";

/**
 * Smart root route. When an agent is already configured/connected, we show
 * the agent overview (Home). Otherwise we fall through to the install
 * wizard. This way the Home tab stops being the "install" screen and
 * becomes the agent's actual dashboard once setup is done. Users can
 * still reach the wizard explicitly at /install.
 */
const RootRoute = () => {
  const { connected, status } = useAgentConnection();
  const [settled, setSettled] = useState(false);

  // Avoid a flash of the wizard before the initial detection completes.
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

  return connected ? <Home /> : <Index />;
};

export default RootRoute;
