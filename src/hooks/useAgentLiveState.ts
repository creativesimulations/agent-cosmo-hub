import { useCallback, useEffect, useRef, useState } from "react";
import { systemAPI } from "@/lib/systemAPI";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";

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
}

export interface HeartbeatLite {
  id: string;
  description: string;
  interval: string;
}

export interface LiveState {
  agentName: string;
  model: string;
  health: Health;
  healthDetail: string;
  subAgents: SubAgentLite[];
  cronJobs: CronJobLite[];
  heartbeats: HeartbeatLite[];
  loading: boolean;
}

const DEFAULT: LiveState = {
  agentName: "Agent",
  model: "—",
  health: "unknown",
  healthDetail: "Checking…",
  subAgents: [],
  cronJobs: [],
  heartbeats: [],
  loading: true,
};

const readModel = (config: string) => {
  const m = config.match(/^\s*model:\s*(.+)\s*$/m);
  return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : null;
};

/**
 * Heartbeat tasks live in config.yaml under `heartbeats:` with entries like
 * `- name: presence\n    interval: 30s\n    description: ...`.
 * Best-effort YAML scan; never throws.
 */
const parseHeartbeats = (config: string): HeartbeatLite[] => {
  const out: HeartbeatLite[] = [];
  const block = config.match(/^heartbeats:\s*\n((?:[ \t]+.*\n?)+)/m);
  if (!block) return out;
  const body = block[1];
  // Split on lines starting with "- " (item separators)
  const items = body.split(/^\s*-\s+/m).filter((s) => s.trim());
  items.forEach((item, i) => {
    const name = item.match(/name:\s*([^\n]+)/)?.[1]?.trim();
    const interval = item.match(/interval:\s*([^\n]+)/)?.[1]?.trim();
    const description = item.match(/description:\s*([^\n]+)/)?.[1]?.trim();
    if (interval || name) {
      out.push({
        id: name || `hb-${i}`,
        description: description || name || "(no description)",
        interval: interval || "—",
      });
    }
  });
  return out;
};

export function useAgentLiveState(intervalMs = 5000): LiveState & { refresh: () => void } {
  const { connected } = useAgentConnection();
  const [state, setState] = useState<LiveState>(DEFAULT);
  const ticking = useRef(false);

  const refresh = useCallback(async () => {
    if (!connected || ticking.current) return;
    ticking.current = true;
    try {
      const [nameRes, cfgRes, subs, cron, ping] = await Promise.all([
        systemAPI.getAgentName().catch(() => null),
        systemAPI.readConfig().catch(() => ({ success: false, content: "" })),
        systemAPI.listSubAgents().catch(() => ({ success: false, active: [] as SubAgentLite[] })),
        systemAPI.listScheduledJobs().catch(() => ({ success: false, jobs: [] as CronJobLite[] })),
        systemAPI.chatPing().catch(() => ({ success: false })),
      ]);

      const cfgText = (cfgRes as { content?: string }).content || "";
      const model = readModel(cfgText) || "—";
      const heartbeats = parseHeartbeats(cfgText);

      const health: Health = ping.success ? "healthy" : "degraded";
      const healthDetail = ping.success
        ? "All systems nominal"
        : "Agent reachable but not responding to ping";

      setState({
        agentName: nameRes || "Agent",
        model,
        health,
        healthDetail,
        subAgents: ((subs as { active?: SubAgentLite[] }).active || []).slice(0, 6),
        cronJobs: ((cron as { jobs?: CronJobLite[] }).jobs || []).slice(0, 8),
        heartbeats,
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
    return () => window.clearInterval(id);
  }, [connected, refresh, intervalMs]);

  return { ...state, refresh };
}
