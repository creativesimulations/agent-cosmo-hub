/**
 * Insights — agent activity & usage at a glance.
 *
 * Reads `hermes insights --json` (with `stats` / `usage` fallbacks) via
 * systemAPI.getInsights and renders a small dashboard: sessions, messages,
 * tokens in/out, estimated cost, and the busiest channels/skills.
 *
 * When the CLI doesn't expose insights yet, we show an explanation instead
 * of an error — Logs and Diagnostics already cover the "raw events" use
 * case, this page is the high-level usage view.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart3, RefreshCw, Loader2, AlertCircle, Sparkles, MessageSquare, Coins, DollarSign, Radio, Puzzle,
} from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import ActionableError from "@/components/ui/ActionableError";
import { systemAPI } from "@/lib/systemAPI";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import { useChat } from "@/contexts/ChatContext";

interface InsightsData {
  sessionsLast7d?: number;
  messagesLast7d?: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  topChannels?: Array<{ name: string; count: number }>;
  topSkills?: Array<{ name: string; count: number }>;
}

const fmtNum = (n?: number) => (typeof n === "number" ? n.toLocaleString() : "—");
const fmtUsd = (n?: number) =>
  typeof n === "number" ? n.toLocaleString(undefined, { style: "currency", currency: "USD" }) : "—";

const StatCard = ({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof BarChart3;
  label: string;
  value: string;
  hint?: string;
}) => (
  <GlassCard className="space-y-1">
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Icon className="w-3.5 h-3.5" /> {label}
    </div>
    <p className="text-2xl font-bold text-foreground">{value}</p>
    {hint && <p className="text-[11px] text-muted-foreground/70">{hint}</p>}
  </GlassCard>
);

const Insights = () => {
  const navigate = useNavigate();
  const { connected } = useAgentConnection();
  const { setDraft } = useChat();
  const [loading, setLoading] = useState(true);
  const [cliAvailable, setCliAvailable] = useState(true);
  const [data, setData] = useState<InsightsData | null>(null);
  const [error, setError] = useState<string>("");

  const load = useCallback(async () => {
    if (!connected) { setLoading(false); return; }
    setLoading(true);
    setError("");
    const r = await systemAPI.getInsights();
    if (r.success) {
      setCliAvailable(r.cliAvailable);
      setData(r.insights ?? null);
    } else {
      setError(r.error || "Could not load insights.");
      setData(null);
    }
    setLoading(false);
  }, [connected]);

  useEffect(() => { void load(); }, [load]);

  const handleAskAgent = () => {
    setDraft(
      "Give me a summary of what you've been doing — recent activity, busiest channels, anything I should know about.",
    );
    navigate("/chat");
  };

  if (!connected) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-primary" />
            Insights
          </h1>
          <p className="text-sm text-muted-foreground">Activity and usage at a glance</p>
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
    <div className="p-6 space-y-6 max-w-6xl">
      {error && (
        <ActionableError
          title="Couldn't load insights"
          summary={error}
          details={error}
          onFix={() => void load()}
          fixLabel="Retry"
        />
      )}

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-primary" />
            Insights
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            How much your agent has been working over the last seven days — sessions, messages,
            token usage, and where the time is going.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleAskAgent}
            className="gradient-primary text-primary-foreground"
          >
            <Sparkles className="w-4 h-4 mr-1" /> Ask the agent
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

      {loading ? (
        <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading insights…
        </div>
      ) : !cliAvailable ? (
        <GlassCard className="border-warning/30 bg-warning/5 p-5 space-y-2">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                Your agent doesn't expose a usage dashboard yet
              </p>
              <p className="text-xs text-muted-foreground">
                Newer Hermes builds add an <code className="text-foreground">insights</code> command
                that surfaces session, message, and token totals. Until that's available you can
                ask the agent for a recap and it'll generate one from its own session log.
              </p>
            </div>
          </div>
          <div className="pt-2">
            <Button size="sm" onClick={handleAskAgent} className="gradient-primary text-primary-foreground">
              <Sparkles className="w-4 h-4 mr-1" /> Ask the agent for a recap
            </Button>
          </div>
        </GlassCard>
      ) : data ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            <StatCard
              icon={MessageSquare}
              label="Sessions (7d)"
              value={fmtNum(data.sessionsLast7d)}
              hint="Distinct chat sessions started"
            />
            <StatCard
              icon={MessageSquare}
              label="Messages (7d)"
              value={fmtNum(data.messagesLast7d)}
              hint="User + agent turns"
            />
            <StatCard
              icon={Coins}
              label="Tokens in"
              value={fmtNum(data.tokensIn)}
              hint="Prompt tokens"
            />
            <StatCard
              icon={Coins}
              label="Tokens out"
              value={fmtNum(data.tokensOut)}
              hint="Generated tokens"
            />
            <StatCard
              icon={DollarSign}
              label="Estimated cost"
              value={fmtUsd(data.costUsd)}
              hint="Based on your model rates"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <GlassCard className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Radio className="w-4 h-4 text-primary" /> Top channels
              </div>
              {data.topChannels && data.topChannels.length > 0 ? (
                <ul className="space-y-1.5">
                  {data.topChannels.slice(0, 8).map((c) => (
                    <li key={c.name} className="flex items-center justify-between text-sm">
                      <span className="text-foreground truncate">{c.name}</span>
                      <span className="text-muted-foreground tabular-nums">{c.count.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">No channel activity recorded yet.</p>
              )}
            </GlassCard>
            <GlassCard className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Puzzle className="w-4 h-4 text-primary" /> Top skills
              </div>
              {data.topSkills && data.topSkills.length > 0 ? (
                <ul className="space-y-1.5">
                  {data.topSkills.slice(0, 8).map((s) => (
                    <li key={s.name} className="flex items-center justify-between text-sm">
                      <span className="text-foreground truncate">{s.name}</span>
                      <span className="text-muted-foreground tabular-nums">{s.count.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">No skill activity recorded yet.</p>
              )}
            </GlassCard>
          </div>
        </>
      ) : (
        <GlassCard className="text-center py-12 space-y-3">
          <BarChart3 className="w-10 h-10 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-foreground">No data yet.</p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            Once you've chatted with your agent for a few days the dashboard will fill in
            automatically.
          </p>
        </GlassCard>
      )}
    </div>
  );
};

export default Insights;
