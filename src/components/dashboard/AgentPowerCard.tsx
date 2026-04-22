import { Power, PowerOff, Loader2, Moon } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import { useSettings } from "@/contexts/SettingsContext";
import { useChat } from "@/contexts/ChatContext";
import { cn } from "@/lib/utils";

/**
 * Dashboard power control: lets the user turn the agent ON/OFF without
 * touching the command line, and toggle whether it keeps running when the
 * app window is closed. The tray menu mirrors this state, so closing the
 * app + reopening it always reflects the same agent instance — we never
 * spawn a duplicate because `hermes` is a per-chat CLI, not a daemon.
 */
const AgentPowerCard = () => {
  const { agentRunning, setAgentRunning, connected } = useAgentConnection();
  const { settings, update } = useSettings();
  const { isStreaming, stop } = useChat();

  const handleToggle = async (next: boolean) => {
    if (!next && isStreaming) {
      // Cleanly cancel the in-flight reply before flipping off.
      await stop();
    }
    setAgentRunning(next);
  };

  return (
    <GlassCard className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={cn(
              "shrink-0 w-11 h-11 rounded-xl flex items-center justify-center transition-colors",
              agentRunning
                ? "bg-success/15 text-success"
                : "bg-muted/30 text-muted-foreground"
            )}
          >
            {isStreaming ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : agentRunning ? (
              <Power className="w-5 h-5" />
            ) : (
              <PowerOff className="w-5 h-5" />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">
              Agent Power
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {agentRunning
                ? isStreaming
                  ? "Agent is responding…"
                  : "Agent is on and ready to chat"
                : "Agent is off — chat is paused"}
            </p>
          </div>
        </div>
        <Switch
          checked={agentRunning}
          onCheckedChange={handleToggle}
          disabled={!connected}
          aria-label="Toggle agent on or off"
        />
      </div>

      <div className="border-t border-white/5 pt-3 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="shrink-0 w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Moon className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">
              Keep running when window is closed
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
              {settings.runInBackground
                ? "Closing the window hides Ronbot to the system tray. Use the tray icon or the toggle above to fully stop it."
                : "Closing the window quits Ronbot completely. Turn this on to keep the agent alive in the background."}
            </p>
          </div>
        </div>
        <Switch
          checked={settings.runInBackground}
          onCheckedChange={(v) => update({ runInBackground: v })}
          aria-label="Keep agent running in background"
        />
      </div>

      {settings.runInBackground && (
        <div className="border-t border-white/5 pt-3 flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted-foreground">
            Need to fully quit (e.g. before rebuilding)?
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => window.electronAPI?.quitApp?.()}
          >
            Quit Ronbot
          </Button>
        </div>
      )}
    </GlassCard>
  );
};

export default AgentPowerCard;
