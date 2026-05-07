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
import { useChat } from "@/contexts/ChatContext";
import { useNavigate } from "react-router-dom";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Personality entrypoint. We don't auto-send anything — the user must
 * complete the unfinished sentence themselves and hit Enter. After they
 * send it, AgentChat shows a "restart now to apply" reminder banner.
 */
const PersonalityDialog = ({ open, onOpenChange }: Props) => {
  const { setDraft } = useChat();
  const navigate = useNavigate();

  const handleStart = () => {
    setDraft(
      "I'd like to adjust your personality. Please update your SOUL.md / base behavior so that you ",
    );
    onOpenChange(false);
    navigate("/chat");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Change personality
          </DialogTitle>
          <DialogDescription>
            We'll open the chat with a half-written request. Finish the sentence
            in your own words — describe how you'd like the agent to think, talk,
            or behave — then send it. Personality changes apply on the next
            agent restart.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleStart}
            className="gradient-primary text-primary-foreground"
          >
            Open chat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PersonalityDialog;
