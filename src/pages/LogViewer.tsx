import { useEffect, useMemo, useRef, useState } from "react";
import {
  FileText,
  Search,
  Pause,
  Play,
  Trash2,
  Download,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Activity,
} from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { agentLogs, type AgentLogEntry, type AgentLogLevel, type AgentLogSource } from "@/lib/diagnostics";
import { cn } from "@/lib/utils";

const levelStyles: Record<AgentLogLevel, string> = {
  debug: "bg-white/5 text-muted-foreground border-white/10",
  info: "bg-primary/10 text-primary border-primary/20",
  warn: "bg-warning/10 text-warning border-warning/20",
  error: "bg-destructive/10 text-destructive border-destructive/20",
};

const sourceLabels: Record<AgentLogSource, string> = {
  chat: "Chat",
  doctor: "Doctor",
  install: "Install",
  update: "Update",
  start: "Start",
  gateway: "Gateway",
  system: "System",
};

const ALL_LEVELS: AgentLogLevel[] = ["debug", "info", "warn", "error"];

const LogViewer = () => {
  const [search, setSearch] = useState("");
  const [activeLevels, setActiveLevels] = useState<AgentLogLevel[]>(ALL_LEVELS);
  const [paused, setPaused] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [entries, setEntries] = useState<AgentLogEntry[]>([]);
  const frozenRef = useRef<AgentLogEntry[] | null>(null);

  useEffect(() => {
    return agentLogs.subscribe((all) => {
      if (paused) {
        // freeze the current view; new entries still accumulate in the buffer
        return;
      }
      setEntries(all.slice().reverse()); // newest first
    });
  }, [paused]);

  // When toggling pause, snapshot/restore properly
  useEffect(() => {
    if (paused) {
      frozenRef.current = entries;
    } else {
      frozenRef.current = null;
      setEntries(agentLogs.list());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  const toggleLevel = (level: AgentLogLevel) => {
    setActiveLevels((prev) =>
      prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]
    );
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (!activeLevels.includes(e.level)) return false;
      if (!q) return true;
      return (
        e.summary.toLowerCase().includes(q) ||
        e.source.toLowerCase().includes(q) ||
        (e.detail?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [entries, search, activeLevels]);

  const handleExport = () => {
    const blob = new Blob([agentLogs.toText()], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ainoval-agent-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-4 h-[calc(100vh-2rem)] flex flex-col">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileText className="w-6 h-6 text-primary" />
            Logs
          </h1>
          <p className="text-sm text-muted-foreground">
            Agent activity feed — chat turns, doctor runs, updates, and lifecycle events.{" "}
            <Link to="/diagnostics" className="text-primary hover:underline inline-flex items-center gap-1">
              <Activity className="w-3 h-3" /> Need raw shell commands? Open Diagnostics
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPaused((p) => !p)}
            className="text-muted-foreground hover:text-foreground"
          >
            {paused ? <Play className="w-4 h-4 mr-1" /> : <Pause className="w-4 h-4 mr-1" />}
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleExport}
            className="text-muted-foreground hover:text-foreground"
          >
            <Download className="w-4 h-4 mr-1" /> Export
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => agentLogs.clear()}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="w-4 h-4 mr-1" /> Clear
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search summary, source, or detail…"
            className="pl-9 bg-background/50 border-white/10"
          />
        </div>
        <div className="flex items-center gap-1">
          {ALL_LEVELS.map((level) => (
            <button
              key={level}
              onClick={() => toggleLevel(level)}
              className={cn(
                "px-2.5 py-1 rounded-md text-xs font-medium transition-all border",
                activeLevels.includes(level)
                  ? levelStyles[level]
                  : "bg-white/5 text-muted-foreground/40 border-transparent"
              )}
            >
              {level.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <GlassCard className="flex-1 overflow-hidden p-0">
        {filtered.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center space-y-3 px-6">
              <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto opacity-40" />
              <p className="text-sm text-muted-foreground">
                {entries.length === 0
                  ? "No logs yet. Send a chat message, run hermes doctor, or update the agent to populate this feed."
                  : "No entries match the current filters."}
              </p>
            </div>
          </div>
        ) : (
          <div className="h-full overflow-y-auto divide-y divide-white/5">
            {filtered.map((e) => {
              const isOpen = expanded.has(e.id);
              const hasDetail = !!e.detail;
              return (
                <motion.div
                  key={e.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="hover:bg-white/[0.02] transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => hasDetail && toggleExpand(e.id)}
                    disabled={!hasDetail}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-2.5 text-left",
                      hasDetail && "cursor-pointer",
                      !hasDetail && "cursor-default"
                    )}
                  >
                    <div className="w-4 shrink-0">
                      {hasDetail &&
                        (isOpen ? (
                          <ChevronDown className="w-4 h-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        ))}
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground w-16 shrink-0">
                      {new Date(e.timestamp).toLocaleTimeString()}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn("text-[9px] py-0 px-1.5 border", levelStyles[e.level])}
                    >
                      {e.level.toUpperCase()}
                    </Badge>
                    <Badge variant="outline" className="text-[9px] py-0 px-1.5 shrink-0">
                      {sourceLabels[e.source]}
                    </Badge>
                    <span className="text-xs flex-1 truncate text-foreground">{e.summary}</span>
                    {e.durationMs != null && (
                      <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                        {e.durationMs}ms
                      </span>
                    )}
                  </button>
                  {isOpen && hasDetail && (
                    <div className="px-4 pb-3 pl-[5.5rem]">
                      <pre className="p-3 rounded bg-background/40 border border-white/5 text-[11px] font-mono whitespace-pre-wrap max-h-80 overflow-auto">
                        {e.detail}
                      </pre>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </GlassCard>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {filtered.length} of {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </span>
        <span>
          {paused ? "⏸ Paused — new entries still being recorded" : "● Live"}
        </span>
      </div>
    </div>
  );
};

export default LogViewer;
