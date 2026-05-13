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
  displayName?: string;
  model?: string;
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
  displayName: s.displayName,
  model: s.model,
});

const logRowToLite = (a: {
  id: string;
  goal: string;
  startedAt: string;
  lastEvent?: string;
}): SubAgentLite => ({
  id: a.id,
  goal: a.goal,
  startedAt: a.startedAt,
  lastEvent: a.lastEvent,
});

export function useAgentLiveState(intervalMs = 5000): LiveState & { refresh: () => void } {
  const { connected } = useAgentConnection();
  const [state, setState] = useState<LiveState>(DEFAULT);
  const ticking = useRef(false);

  const refresh = useCallback(async () => {
    if (!connected || ticking.current) return;
    ticking.current = true;
    try {
      const [nameRes, cfgRes, cron, statusRes, subAgentsRes] = await Promise.all([
        systemAPI.getAgentName().catch(() => null),
        systemAPI.readConfig().catch(() => ({ success: false, content: "" })),
        systemAPI.listScheduledJobs().catch(() => ({ success: false, jobs: [] as CronJobLite[] })),
        systemAPI.hermesStatus().catch(() => ({ success: false, stdout: "", stderr: "" })),
        systemAPI.listSubAgents().catch(() => ({ success: false, active: [] as SubAgentLite[] })),
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

      const subRes = subAgentsRes as {
        success?: boolean;
        active?: Array<{ id: string; goal: string; startedAt: string; lastEvent?: string }>;
      };
      const logActive = subRes?.success && Array.isArray(subRes.active) ? subRes.active : [];

      const streamRunning = liveSubAgents
        .list()
        .filter((s) => s.status === "running")
        .slice(0, 6)
        .map(toSubAgentLite);
      let subAgents = streamRunning;
      if (subAgents.length === 0 && logActive.length > 0) {
        subAgents = logActive.slice(0, 6).map(logRowToLite);
      } else if (subAgents.length > 0 && logActive.length > 0) {
        for (const row of logActive) {
          const g = row.goal.slice(0, 48);
          const match = subAgents.find(
            (s) =>
              s.goal.slice(0, 48) === g ||
              s.goal.includes(g) ||
              row.goal.includes(s.goal.slice(0, 48)),
          );
          if (match && !match.lastEvent && row.lastEvent) match.lastEvent = row.lastEvent;
        }
      }

      setState({
        agentName: nameRes || "Agent",
        model,
        health,
        healthDetail,
        subAgents,
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
      setState((prev) => ({
        ...prev,
        subAgents: snap.filter((s) => s.status === "running").slice(0, 6).map(toSubAgentLite),
      }));
    });
    return () => { window.clearInterval(id); unsub(); };
  }, [connected, refresh, intervalMs]);

  return { ...state, refresh };
}
