import { useState } from "react";
import GlassCard from "@/components/ui/GlassCard";
import { Switch } from "@/components/ui/switch";
import { setDebugPromptDetection, isDebugPromptDetection } from "@/lib/approvalBridge";
import { toast } from "@/hooks/use-toast";

const DebugTogglesCard = () => {
  const [debugPrompts, setDebugPrompts] = useState<boolean>(isDebugPromptDetection());

  const toggle = (on: boolean) => {
    setDebugPrompts(on);
    setDebugPromptDetection(on);
    toast({
      title: on ? "Prompt detection logging ON" : "Prompt detection logging OFF",
      description: on
        ? "Every approval-prompt match will be recorded in the agent log."
        : "Stopped logging prompt detection events.",
    });
  };

  return (
    <GlassCard className="p-4 space-y-3">
      <h2 className="text-sm font-semibold">Debug toggles</h2>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-foreground">Log every prompt-detection event</p>
          <p className="text-[11px] text-muted-foreground">
            When ON, every approval-prompt match is recorded in the agent log. Use this to confirm
            the parser is firing on real prompts.
          </p>
        </div>
        <Switch checked={debugPrompts} onCheckedChange={toggle} />
      </div>
    </GlassCard>
  );
};

export default DebugTogglesCard;
