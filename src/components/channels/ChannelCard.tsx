import { CheckCircle2, Lock, Loader2, AlertCircle } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Channel } from "@/lib/channels";

export type ChannelStatus =
  | { state: "loading" }
  | { state: "locked" }
  | { state: "not-configured" }
  | { state: "configured"; running: boolean; starting?: boolean; attentionReason?: string };

interface ChannelCardProps {
  channel: Channel;
  status: ChannelStatus;
  onSetUp: () => void;
}

const ChannelCard = ({ channel, status, onSetUp }: ChannelCardProps) => {
  const Icon = channel.icon;

  const statusBadge = () => {
    if (status.state === "loading") {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" /> Checking…
        </span>
      );
    }
    if (status.state === "locked") {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Lock className="w-3 h-3" /> Locked
        </span>
      );
    }
    if (status.state === "not-configured") {
      return <span className="text-[11px] text-muted-foreground">Not configured</span>;
    }
    if (status.running) {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-success">
          <span className="w-2 h-2 rounded-full bg-success animate-pulse-glow" />
          Active
        </span>
      );
    }
    if (status.starting) {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-foreground/70">
          <Loader2 className="w-3 h-3 animate-spin" /> Starting…
        </span>
      );
    }
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] text-warning"
        title={status.attentionReason || "Configured but not connected. Reconfigure to relink."}
      >
        <AlertCircle className="w-3 h-3" /> Attention
      </span>
    );
  };

  return (
    <GlassCard className="p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div
          className={cn(
            "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
            status.state === "locked" ? "bg-muted/30 text-muted-foreground" : "bg-primary/15 text-primary",
          )}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div className="text-right">{statusBadge()}</div>
      </div>

      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">{channel.name}</h3>
        <p className="text-xs text-muted-foreground leading-relaxed">{channel.tagline}</p>
        <p className="text-[11px] text-muted-foreground/70">Setup difficulty: {channel.difficulty}</p>
      </div>

      <div className="flex flex-col gap-2 mt-auto">
        {status.state === "locked" ? (
          <Button variant="outline" size="sm" onClick={onSetUp} className="w-full">
            <Lock className="w-3.5 h-3.5 mr-1.5" /> Unlock
          </Button>
        ) : (
          <Button
            variant={status.state === "not-configured" ? "default" : "outline"}
            size="sm"
            onClick={onSetUp}
            className={cn("w-full", status.state === "not-configured" && "gradient-primary text-primary-foreground")}
            disabled={status.state === "loading"}
          >
            {status.state === "configured" ? "Reconfigure" : "Set up"}
          </Button>
        )}
      </div>
    </GlassCard>
  );
};

export default ChannelCard;
