import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { AlertCircle, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useChat } from "@/contexts/ChatContext";
import { systemAPI } from "@/lib/systemAPI";
import { useNavigate } from "react-router-dom";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PersonalityDialog = ({ open, onOpenChange }: Props) => {
  const { sendMessage } = useChat();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [stage, setStage] = useState<"edit" | "restart">("edit");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setText("");
    setStage("edit");
    setBusy(false);
  };

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed) {
      toast.error("Describe the personality you want first.");
      return;
    }
    setBusy(true);
    const prompt =
      `Please update your personality and base behavior to match this direction. ` +
      `Edit your own base files (e.g. SOUL.md / system prompt / config) accordingly, ` +
      `keeping core safety behaviors intact.\n\n--- USER DIRECTION ---\n${trimmed}`;
    try {
      await sendMessage(prompt);
      toast.success("Personality update sent", {
        description: "I've asked the agent to edit its own base files.",
      });
      setStage("restart");
      // Auto-navigate to chat so the user can see the agent's response.
      navigate("/chat");
    } catch (e) {
      toast.error("Couldn't send the request", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRestartNow = async () => {
    setBusy(true);
    try {
      const r = await systemAPI.restartAgent();
      if (r.success) {
        toast.success("Restarting the agent…", {
          description: "Chat will reconnect automatically.",
        });
      } else {
        toast.error("Restart failed", { description: r.error });
      }
    } finally {
      setBusy(false);
      onOpenChange(false);
      reset();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            {stage === "edit" ? "Change personality" : "Restart to apply"}
          </DialogTitle>
          <DialogDescription>
            {stage === "edit"
              ? "Describe how you want the agent to think, talk, and behave. The agent will edit its own base files based on your direction."
              : "Personality changes only take effect after the agent restarts. Restart now?"}
          </DialogDescription>
        </DialogHeader>

        {stage === "edit" ? (
          <>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder='e.g. "Be warmer and more playful. Use shorter sentences. Always ask one clarifying question before taking action."'
              className="min-h-[140px] bg-background/50 border-white/10"
              disabled={busy}
            />
            <div className="flex items-start gap-2 p-3 rounded-md border border-warning/30 bg-warning/5 text-xs">
              <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <p className="text-muted-foreground">
                Personality changes won't take effect until the agent is reset.
                You'll be prompted to restart it when you're done.
              </p>
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={busy || !text.trim()}
                className="gradient-primary text-primary-foreground"
              >
                {busy ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    Sending…
                  </>
                ) : (
                  "Send to agent"
                )}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                onOpenChange(false);
                reset();
              }}
              disabled={busy}
            >
              Later
            </Button>
            <Button
              onClick={handleRestartNow}
              disabled={busy}
              className="gradient-primary text-primary-foreground"
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  Restarting…
                </>
              ) : (
                "Restart now"
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default PersonalityDialog;
