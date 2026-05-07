import { useState } from "react";
import {
  Activity,
  Bot,
  CalendarClock,
  ChevronDown,
  Heart,
  Network,
  Power,
  PowerOff,
  Loader2,
  Cpu,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import GlassCard from "@/components/ui/GlassCard";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import { useChat } from "@/contexts/ChatContext";
import { useAgentLiveState } from "@/hooks/useAgentLiveState";

const formatElapsed = (ms: number): string => {
  if (ms < 0) return "—";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  if (m > 0) return `${m}m`;
  return `${total}s`;
};

const Section = ({
  title,
  icon: Icon,
  count,
  storageKey,
  children,
}: {
  title: string;
  icon: typeof Activity;
  count?: number;
  storageKey: string;
  children: React.ReactNode;
}) => {
  const [open, setOpen] = useState(() => {
    try {
      const v = window.localStorage.getItem(storageKey);
      return v === null ? true : v === "true";
    } catch {
      return true;
    }
  });
  const toggle = () => {
    setOpen((v) => {
      try {
        window.localStorage.setItem(storageKey, String(!v));
      } catch {
        /* ignore */
      }
      return !v;
    });
  };
  return (
    <div className="border-t border-white/5 first:border-t-0">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-white/5 transition-colors"
      >
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Icon className="w-3.5 h-3.5 text-primary/80" />
          {title}
          {typeof count === "number" && (
            <span className="text-[10px] font-medium text-muted-foreground/70">
              {count}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && <div className="px-3 pb-3 space-y-1.5">{children}</div>}
    </div>
  );
};

const EmptyRow = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[11px] text-muted-foreground/60 italic px-1 py-1">{children}</p>
);

const RightInfoPanel = () => {
  const { connected, agentRunning, setAgentRunning, connectedSince, frozenUptimeMs } =
    useAgentConnection();
  const { isStreaming } = useChat();
  const live = useAgentLiveState(5000);

  const uptimeText = connectedSince
    ? formatElapsed(Date.now() - connectedSince)
    : frozenUptimeMs !== null
      ? `${formatElapsed(frozenUptimeMs)} (paused)`
      : "—";

  const healthIcon =
    live.health === "healthy" ? (
      <CheckCircle2 className="w-3.5 h-3.5 text-success" />
    ) : live.health === "degraded" ? (
      <AlertTriangle className="w-3.5 h-3.5 text-warning" />
    ) : (
      <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
    );

  return (
    <GlassCard className="p-0 overflow-hidden flex flex-col h-full">
      {/* Identity / power */}
      <div className="p-4 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-foreground truncate">
              {live.agentName}
            </h2>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  agentRunning && connected
                    ? "bg-success animate-pulse"
                    : "bg-muted-foreground",
                )}
              />
              {!connected
                ? "Not connected"
                : agentRunning
                  ? isStreaming
                    ? "Responding…"
                    : "Online"
                  : "Off"}
              <span className="text-muted-foreground/60">·</span>
              <span>{uptimeText}</span>
            </p>
          </div>
          <Switch
            checked={agentRunning}
            onCheckedChange={setAgentRunning}
            disabled={!connected}
            aria-label="Agent power"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Health */}
        <Section title="Health" icon={Activity} storageKey="ronbot.right.health">
          <div className="space-y-1.5 text-[12px]">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1.5">
                {healthIcon} Status
              </span>
              <span className="text-foreground font-medium">{live.healthDetail}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Cpu className="w-3 h-3" /> Model
              </span>
              <span
                className="text-foreground font-medium truncate max-w-[140px]"
                title={live.model}
              >
                {live.model}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1.5">
                {agentRunning ? (
                  <Power className="w-3 h-3" />
                ) : (
                  <PowerOff className="w-3 h-3" />
                )}
                Power
              </span>
              <span className="text-foreground font-medium">
                {agentRunning ? "On" : "Off"}
              </span>
            </div>
          </div>
        </Section>

        {/* Sub-agents */}
        <Section
          title="Sub-agents"
          icon={Network}
          count={live.subAgents.length}
          storageKey="ronbot.right.subagents"
        >
          {live.loading ? (
            <Skeleton className="h-8 w-full" />
          ) : live.subAgents.length === 0 ? (
            <EmptyRow>None active right now.</EmptyRow>
          ) : (
            live.subAgents.map((s) => (
              <div
                key={s.id}
                className="text-[12px] glass-subtle rounded-md px-2 py-1.5"
              >
                <p className="text-foreground font-medium truncate" title={s.goal}>
                  {s.goal || s.id}
                </p>
                {s.lastEvent && (
                  <p className="text-[10px] text-muted-foreground truncate">
                    {s.lastEvent}
                  </p>
                )}
              </div>
            ))
          )}
        </Section>

        {/* Cron */}
        <Section
          title="Cron"
          icon={CalendarClock}
          count={live.cronJobs.length}
          storageKey="ronbot.right.cron"
        >
          {live.loading ? (
            <Skeleton className="h-8 w-full" />
          ) : live.cronJobs.length === 0 ? (
            <EmptyRow>No scheduled jobs. Ask Ron to create one.</EmptyRow>
          ) : (
            live.cronJobs.map((j) => (
              <div
                key={j.id}
                className="text-[12px] glass-subtle rounded-md px-2 py-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="font-mono text-[11px] text-primary/90 truncate"
                    title={j.schedule}
                  >
                    {j.schedule || "—"}
                  </span>
                  {j.nextRun && (
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      next {j.nextRun}
                    </span>
                  )}
                </div>
                <p
                  className="text-foreground truncate"
                  title={j.description}
                >
                  {j.description}
                </p>
              </div>
            ))
          )}
        </Section>

        {/* Recurring jobs */}
        <Section
          title="Recurring jobs"
          icon={Heart}
          count={live.recurringJobs.length}
          storageKey="ronbot.right.recurring"
        >
          {live.loading ? (
            <Skeleton className="h-8 w-full" />
          ) : live.recurringJobs.length === 0 ? (
            <EmptyRow>No recurring jobs. Ask Ron to create one.</EmptyRow>
          ) : (
            live.recurringJobs.map((j) => (
              <div
                key={j.id}
                className="text-[12px] glass-subtle rounded-md px-2 py-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="font-mono text-[11px] text-primary/90 truncate"
                    title={j.schedule}
                  >
                    {j.schedule || "—"}
                  </span>
                  {j.nextRun && (
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      next {j.nextRun}
                    </span>
                  )}
                </div>
                <p className="text-foreground truncate" title={j.description}>
                  {j.description}
                </p>
              </div>
            ))
          )}
        </Section>
      </div>
    </GlassCard>
  );
};

export default RightInfoPanel;
