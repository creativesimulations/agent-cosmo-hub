import { useCallback, useEffect, useRef, useState } from "react";
import { systemAPI } from "@/lib/systemAPI";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import { liveSubAgents, type LiveSubAgent } from "@/lib/liveSubAgents";

export type Health = "healthy" | "degraded" | "unknown";

export interface SubAgentLite {
  id: string;
  goal: string;
  startedAt: string;
  lastEvent?: string;
}

export interface CronJobLite {
  id: string;
  description: string;
  schedule?: string;
  nextRun?: string;
  recurring?: boolean;
}

export interface LiveState {
  agentName: string;
  model: string;
  health: Health;
  healthDetail: string;
  subAgents: SubAgentLite[];
  cronJobs: CronJobLite[];
  recurringJobs: CronJobLite[];
  loading: boolean;
}

const DEFAULT: LiveState = {
  agentName: "Agent",
  model: "—",
  health: "unknown",
  healthDetail: "Checking…",
  subAgents: [],
  cronJobs: [],
  recurringJobs: [],
  loading: true,
};

const readModel = (config: string) => {
  const m = config.match(/^\s*model:\s*(.+)\s*$/m);
  return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : null;
};

/** Heuristic: an entry is "recurring" if its schedule looks like a cron
 *  expression (contains a `*` or `/`) or names an interval. One-shot jobs
 *  typically have a concrete date/time. */
const isRecurring = (j: CronJobLite): boolean => {
  if (typeof j.recurring === "boolean") return j.recurring;
  const s = (j.schedule || "").trim();
  if (!s) return false;
  if (/[*/]/.test(s)) return true;
  if (/^@(hourly|daily|weekly|monthly|yearly|every)\b/i.test(s)) return true;
  if (/\b(every|each)\b/i.test(s)) return true;
  return false;
};

const toSubAgentLite = (s: LiveSubAgent): SubAgentLite => ({
  id: s.id,
  goal: s.goal,
  startedAt: s.startedAt,
  lastEvent: s.lastEvent,
});

export function useAgentLiveState(intervalMs = 5000): LiveState & { refresh: () => void } {
  const { connected } = useAgentConnection();
  const [state, setState] = useState<LiveState>(DEFAULT);
  const ticking = useRef(false);

  const refresh = useCallback(async () => {
    if (!connected || ticking.current) return;
    ticking.current = true;
    try {
      const [nameRes, cfgRes, cron, statusRes] = await Promise.all([
        systemAPI.getAgentName().catch(() => null),
        systemAPI.readConfig().catch(() => ({ success: false, content: "" })),
        systemAPI.listScheduledJobs().catch(() => ({ success: false, jobs: [] as CronJobLite[] })),
        systemAPI.hermesStatus().catch(() => ({ success: false, stdout: "", stderr: "" })),
      ]);

      const cfgText = (cfgRes as { content?: string }).content || "";
      const model = readModel(cfgText) || "—";

      const health: Health = statusRes.success ? "healthy" : "degraded";
      const healthDetail = statusRes.success
        ? "All systems nominal"
        : "Agent reachable but status check failed";

      const allJobs = ((cron as { jobs?: CronJobLite[] }).jobs || []);
      const recurring = allJobs.filter(isRecurring);
      const oneShots = allJobs.filter((j) => !isRecurring(j));

      setState({
        agentName: nameRes || "Agent",
        model,
        health,
        healthDetail,
        subAgents: liveSubAgents.list().slice(0, 6).map(toSubAgentLite),
        cronJobs: oneShots.slice(0, 8),
        recurringJobs: recurring.slice(0, 8),
        loading: false,
      });
    } finally {
      ticking.current = false;
    }
  }, [connected]);

  useEffect(() => {
    if (!connected) {
      setState({ ...DEFAULT, loading: false });
      return;
    }
    void refresh();
    const id = window.setInterval(() => void refresh(), intervalMs);
    // Live sub-agent updates are event-driven — react instantly without
    // waiting for the next poll.
    const unsub = liveSubAgents.subscribe((snap) => {
      setState((prev) => ({ ...prev, subAgents: snap.slice(0, 6).map(toSubAgentLite) }));
    });
    return () => { window.clearInterval(id); unsub(); };
  }, [connected, refresh, intervalMs]);

  return { ...state, refresh };
}
