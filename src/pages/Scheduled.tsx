/**
 * Scheduled tasks — natural-language cron jobs the agent runs on its own.
 *
 * Hermes ships a built-in scheduler. The user describes a job in plain
 * English ("every weekday at 9am summarize my unread email") and the
 * agent translates it into a cron schedule + prompt.
 *
 * This page is a thin window into that scheduler: list / disable / delete.
 * Creation is agent-driven via chat so the agent can ask follow-ups
 * (channel? frequency? what to send back?).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarClock, Clock, Plus, RefreshCw, Loader2, AlertCircle, Trash2,
} from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import ActionableError from "@/components/ui/ActionableError";
import { systemAPI } from "@/lib/systemAPI";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import { useChat } from "@/contexts/ChatContext";
import { toast } from "sonner";

interface ScheduledJob {
  id: string;
  description: string;
  schedule?: string;
  nextRun?: string;
  enabled?: boolean;
}

const Scheduled = () => {
  const navigate = useNavigate();
  const { connected } = useAgentConnection();
  const { setDraft } = useChat();
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [cliAvailable, setCliAvailable] = useState(true);
  const [error, setError] = useState<string>("");
  const [query, setQuery] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!connected) { setLoading(false); return; }
    setLoading(true);
    setError("");
    const r = await systemAPI.listScheduledJobs();
    if (r.success) {
      setJobs(r.jobs);
      setCliAvailable(r.cliAvailable);
    } else {
      setError(r.error || "Could not list scheduled jobs.");
      setJobs([]);
    }
    setLoading(false);
  }, [connected]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter((j) =>
      j.description.toLowerCase().includes(q) ||
      (j.schedule?.toLowerCase().includes(q) ?? false),
    );
  }, [jobs, query]);

  const handleCreateViaChat = () => {
    setDraft("Schedule a recurring task for me. Help me describe what should run and when.");
    navigate("/chat");
  };

  const handleDelete = async (job: ScheduledJob) => {
    if (!confirm(`Delete scheduled job "${job.description}"?`)) return;
    setDeletingId(job.id);
    const r = await systemAPI.deleteScheduledJob(job.id);
    setDeletingId(null);
    if (r.success) {
      toast.success("Scheduled job deleted");
      void load();
    } else {
      toast.error("Could not delete job", { description: r.error });
      setDraft(`Delete the scheduled job with id "${job.id}" — the CLI rejected it directly.`);
      navigate("/chat");
    }
  };

  if (!connected) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <CalendarClock className="w-6 h-6 text-primary" />
            Scheduled tasks
          </h1>
          <p className="text-sm text-muted-foreground">Recurring jobs your agent runs on its own</p>
        </div>
        <GlassCard className="flex items-center justify-center py-16">
          <div className="text-center space-y-3 max-w-md">
            <AlertCircle className="w-10 h-10 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">No agent connected</p>
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {error && (
        <ActionableError
          title="Couldn't load scheduled jobs"
          summary={error}
          details={error}
          onFix={() => void load()}
          fixLabel="Retry"
        />
      )}

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <CalendarClock className="w-6 h-6 text-primary" />
            Scheduled tasks
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Tell the agent to do something on a schedule — "every weekday at 9am summarize my
            unread email" or "Sunday nights write me a recap of the week" — and it'll run on its
            own. Creation lives in chat so the agent can ask follow-ups.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleCreateViaChat}
            className="gradient-primary text-primary-foreground"
          >
            <Plus className="w-4 h-4 mr-1" /> Schedule task
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            className="text-muted-foreground hover:text-foreground"
          >
            {loading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
            Refresh
          </Button>
        </div>
      </div>

      {!cliAvailable && jobs.length === 0 && !loading && (
        <GlassCard className="border-warning/30 bg-warning/5 p-4 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              Your agent's scheduler CLI isn't responding
            </p>
            <p className="text-xs text-muted-foreground">
              You can still create scheduled tasks in chat — the agent will store them through
              its own scheduler. They'll show up here once the CLI surface is available.
            </p>
          </div>
        </GlassCard>
      )}

      <div className="relative">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search scheduled tasks…"
          className="bg-background/50 border-white/10"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading scheduled tasks…
        </div>
      ) : filtered.length === 0 ? (
        <GlassCard className="text-center py-12 space-y-3">
          <Clock className="w-10 h-10 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-foreground">
            {jobs.length === 0 ? "No scheduled tasks yet." : "No tasks match your search."}
          </p>
          {jobs.length === 0 && (
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Click "Schedule task" and tell your agent what should run, when, and where the
              result should go.
            </p>
          )}
        </GlassCard>
      ) : (
        <div className="space-y-2">
          {filtered.map((j) => (
            <GlassCard key={j.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-md bg-primary/15 text-primary flex items-center justify-center shrink-0 mt-0.5">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-medium text-foreground line-clamp-2">{j.description}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      {j.schedule && (
                        <Badge variant="outline" className="border-white/10 font-mono text-[10px]">{j.schedule}</Badge>
                      )}
                      {j.nextRun && (
                        <span className="text-[11px] text-muted-foreground">Next: {j.nextRun}</span>
                      )}
                      {j.enabled === false && (
                        <Badge variant="outline" className="border-muted-foreground/20 text-muted-foreground text-[10px]">
                          Disabled
                        </Badge>
                      )}
                      <span className="text-[10px] font-mono text-muted-foreground/60">id: {j.id}</span>
                    </div>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void handleDelete(j)}
                  disabled={deletingId === j.id}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                >
                  {deletingId === j.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </Button>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
};

export default Scheduled;
