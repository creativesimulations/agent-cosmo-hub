import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import { systemAPI } from "@/lib/systemAPI";

const SHOWN_KEY = "ronbot.welcomeShown.v1";

const WelcomeDialog = () => {
  const { connected } = useAgentConnection();
  const [open, setOpen] = useState(false);
  const [agentName, setAgentName] = useState("Ron");

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    (async () => {
      try {
        if (window.localStorage.getItem(SHOWN_KEY) === "true") return;
      } catch {
        return;
      }
      const name = await systemAPI.getAgentName().catch(() => null);
      if (cancelled) return;
      if (name) setAgentName(name);
      setOpen(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [connected]);

  const dismiss = () => {
    try {
      window.localStorage.setItem(SHOWN_KEY, "true");
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : dismiss())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Hi, I'm {agentName}
          </DialogTitle>
          <DialogDescription className="pt-2 text-sm leading-relaxed text-muted-foreground">
            Chat with me to do anything — connect WhatsApp, add skills,
            schedule tasks, connect external tools, or change my personality.
            <br />
            <br />
            The panel on the right shows what I'm doing right now: my health,
            active sub-agents, scheduled jobs, and heartbeat tasks.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={dismiss} className="gradient-primary text-primary-foreground">
            Let's go
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default WelcomeDialog;
