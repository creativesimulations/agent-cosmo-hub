// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { useEffect, useState } from "react";
import {
  Activity,
  Archive,
  Bot,
  CalendarClock,
  ChevronDown,
  Heart,
  MessageSquare,
  Network,
  Power,
  PowerOff,
  Loader2,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import GlassCard from "@/components/ui/GlassCard";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import { useChat } from "@/contexts/ChatContext";
import { useAgentLiveState } from "@/hooks/useAgentLiveState";
import { subscribeDashboardRefresh } from "@/lib/chat/hermesMarkers";
import { getConversationPreview } from "@/lib/chat/persistence";

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

const formatConversationTime = (date: Date): string => {
  const ageMs = Date.now() - date.getTime();
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const RightInfoPanel = () => {
  const { connected, agentRunning, setAgentRunning, connectedSince, frozenUptimeMs } =
    useAgentConnection();
  const {
    conversations,
    activeConversationId,
    personaMismatch,
    isStreaming,
    startNewConversation,
    switchConversation,
    archiveConversation,
    continueWithCurrentPersona,
    dismissPersonaMismatch,
  } = useChat();
  const live = useAgentLiveState(5000);

  useEffect(() => subscribeDashboardRefresh(() => live.refresh()), [live.refresh]);

  const activeConversations = conversations
    .filter((conversation) => !conversation.archivedAt)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

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
            <EmptyRow>No active sub-agents.</EmptyRow>
          ) : (
            live.subAgents.map((s) => {
              const title = (s.displayName && s.displayName !== s.goal ? s.displayName : s.goal) || s.id;
              return (
              <div
                key={s.id}
                className="text-[12px] glass-subtle rounded-md px-2 py-1.5"
              >
                <p className="text-foreground font-medium truncate" title={title}>
                  {title}
                </p>
                {s.displayName && s.displayName !== s.goal && (
                  <p className="text-[10px] text-muted-foreground truncate" title={s.goal}>
                    {s.goal}
                  </p>
                )}
                {s.model && (
                  <p className="text-[10px] text-muted-foreground/90 font-mono truncate" title={s.model}>
                    {s.model}
                  </p>
                )}
                {s.lastEvent && (
                  <p className="text-[10px] text-muted-foreground truncate">
                    {s.lastEvent}
                  </p>
                )}
              </div>
            );
            })
          )}
        </Section>

        {/* Cron */}
        <Section
          title="Scheduled jobs"
          icon={CalendarClock}
          count={live.cronJobs.length}
          storageKey="ronbot.right.cron"
        >
          {live.loading ? (
            <Skeleton className="h-8 w-full" />
          ) : live.cronJobs.length === 0 ? (
            <EmptyRow>No one-shot or calendar triggers. Ask Ron to schedule something.</EmptyRow>
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
          title="Recurring schedules"
          icon={Heart}
          count={live.recurringJobs.length}
          storageKey="ronbot.right.recurring"
        >
          {live.loading ? (
            <Skeleton className="h-8 w-full" />
          ) : live.recurringJobs.length === 0 ? (
            <EmptyRow>No cron-style recurring jobs (from hermes cron list).</EmptyRow>
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

        {/* Conversations */}
        <Section
          title="Conversations"
          icon={MessageSquare}
          count={activeConversations.length}
          storageKey="ronbot.right.conversations"
        >
          <button
            type="button"
            onClick={() => { void startNewConversation(); }}
            disabled={isStreaming}
            className="w-full flex items-center justify-center gap-1.5 rounded-md border border-white/10 px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="w-3 h-3" />
            New conversation
          </button>

          {personaMismatch && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px] space-y-2">
              <div className="flex gap-1.5 text-warning">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <p>
                  This conversation used different personality or core files.
                </p>
              </div>
              <p className="text-muted-foreground">
                Continue with the current files, or start a new conversation.
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => { void continueWithCurrentPersona(); }}
                  className="rounded-sm bg-warning/20 px-2 py-0.5 text-warning hover:bg-warning/30"
                >
                  Continue
                </button>
                <button
                  type="button"
                  onClick={() => { void startNewConversation(); }}
                  className="rounded-sm bg-white/5 px-2 py-0.5 text-muted-foreground hover:text-foreground"
                >
                  Start new
                </button>
                <button
                  type="button"
                  onClick={dismissPersonaMismatch}
                  className="ml-auto rounded-sm px-1.5 py-0.5 text-muted-foreground hover:text-foreground"
                  aria-label="Dismiss personality warning"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {activeConversations.length === 0 ? (
            <EmptyRow>No active conversations yet.</EmptyRow>
          ) : (
            activeConversations.map((conversation) => {
              const active = conversation.id === activeConversationId;
              return (
                <div
                  key={conversation.id}
                  className={cn(
                    "group text-[12px] rounded-md px-2 py-1.5 border transition-colors",
                    active
                      ? "bg-primary/10 border-primary/30"
                      : "glass-subtle border-transparent hover:border-white/10",
                  )}
                >
                  <div className="flex items-start gap-1.5">
                    <button
                      type="button"
                      onClick={() => { void switchConversation(conversation.id); }}
                      disabled={active || isStreaming}
                      className="min-w-0 flex-1 text-left disabled:cursor-default"
                      title={conversation.title}
                    >
                      <p className={cn("font-medium truncate", active ? "text-primary" : "text-foreground")}>
                        {conversation.title}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {getConversationPreview(conversation)}
                      </p>
                    </button>
                    <span className="text-[10px] text-muted-foreground/70 shrink-0">
                      {formatConversationTime(conversation.updatedAt)}
                    </span>
                    <button
                      type="button"
                      onClick={() => archiveConversation(conversation.id)}
                      disabled={isStreaming}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive disabled:opacity-40 transition-opacity"
                      aria-label={`Archive ${conversation.title}`}
                      title="Archive conversation"
                    >
                      <Archive className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </Section>
      </div>
    </GlassCard>
  );
};

export default RightInfoPanel;
