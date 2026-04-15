import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { FileText, Search, Filter, Pause, Play, Trash2, Download } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  id: number;
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
}

const generateLogs = (): LogEntry[] => [
  { id: 1, timestamp: "2024-01-15 14:23:05.123", level: "info", source: "gateway", message: "Health check: all systems nominal" },
  { id: 2, timestamp: "2024-01-15 14:23:04.891", level: "info", source: "agent", message: "Sub-agent 'research-agent' spawned successfully" },
  { id: 3, timestamp: "2024-01-15 14:23:03.456", level: "warn", source: "provider", message: "Rate limit approaching for OpenAI (80% of quota used)" },
  { id: 4, timestamp: "2024-01-15 14:23:02.789", level: "debug", source: "agent", message: "Token usage: 12,432 prompt + 3,891 completion = 16,323 total" },
  { id: 5, timestamp: "2024-01-15 14:23:01.234", level: "info", source: "agent", message: "Task delegation: market analysis → research-agent" },
  { id: 6, timestamp: "2024-01-15 14:22:59.567", level: "error", source: "skill", message: "Failed to load skill 'web_scraper': timeout after 30s" },
  { id: 7, timestamp: "2024-01-15 14:22:58.901", level: "info", source: "gateway", message: "Incoming request from Telegram platform" },
  { id: 8, timestamp: "2024-01-15 14:22:57.345", level: "debug", source: "provider", message: "Model response latency: 1.23s (gpt-4o)" },
  { id: 9, timestamp: "2024-01-15 14:22:56.678", level: "info", source: "agent", message: "code-writer completed: database schema migration" },
  { id: 10, timestamp: "2024-01-15 14:22:55.012", level: "warn", source: "system", message: "Memory usage at 78% — consider increasing allocation" },
  { id: 11, timestamp: "2024-01-15 14:22:54.345", level: "info", source: "scheduler", message: "Cron job 'health_check' executed successfully" },
  { id: 12, timestamp: "2024-01-15 14:22:53.678", level: "debug", source: "agent", message: "Context window: 42,891 / 128,000 tokens used" },
];

const levelColors: Record<LogLevel, string> = {
  debug: "text-muted-foreground",
  info: "text-foreground/70",
  warn: "text-warning",
  error: "text-destructive",
};

const levelBadgeColors: Record<LogLevel, string> = {
  debug: "bg-white/5 text-muted-foreground",
  info: "bg-primary/10 text-primary",
  warn: "bg-warning/10 text-warning",
  error: "bg-destructive/10 text-destructive",
};

const LogViewer = () => {
  const [logs] = useState(generateLogs);
  const [search, setSearch] = useState("");
  const [activeFilters, setActiveFilters] = useState<LogLevel[]>(["debug", "info", "warn", "error"]);
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const toggleFilter = (level: LogLevel) => {
    setActiveFilters((prev) =>
      prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]
    );
  };

  const filtered = logs.filter(
    (log) =>
      activeFilters.includes(log.level) &&
      (search === "" || log.message.toLowerCase().includes(search.toLowerCase()) || log.source.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="p-6 space-y-4 h-[calc(100vh-2rem)] flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileText className="w-6 h-6 text-primary" />
            Log Viewer
          </h1>
          <p className="text-sm text-muted-foreground">Real-time agent logs with search & filtering</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setPaused(!paused)} className="text-muted-foreground hover:text-foreground">
            {paused ? <Play className="w-4 h-4 mr-1" /> : <Pause className="w-4 h-4 mr-1" />}
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
            <Download className="w-4 h-4 mr-1" /> Export
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
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
            placeholder="Search logs..."
            className="pl-9 bg-background/50 border-white/10"
          />
        </div>
        <div className="flex items-center gap-1">
          {(["debug", "info", "warn", "error"] as LogLevel[]).map((level) => (
            <button
              key={level}
              onClick={() => toggleFilter(level)}
              className={cn(
                "px-2.5 py-1 rounded-md text-xs font-medium transition-all",
                activeFilters.includes(level) ? levelBadgeColors[level] : "bg-white/5 text-muted-foreground/50"
              )}
            >
              {level.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <GlassCard className="flex-1 overflow-hidden p-0">
        <div ref={scrollRef} className="h-full overflow-y-auto font-mono text-xs">
          {filtered.map((log, i) => (
            <motion.div
              key={log.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-start gap-3 px-4 py-1.5 hover:bg-white/[0.02] border-b border-white/[0.03]"
            >
              <span className="text-muted-foreground/60 shrink-0 w-[180px]">{log.timestamp}</span>
              <span className={cn("w-12 shrink-0 uppercase font-semibold", levelColors[log.level])}>
                {log.level}
              </span>
              <span className="text-accent/60 shrink-0 w-20">[{log.source}]</span>
              <span className={cn("flex-1", levelColors[log.level])}>{log.message}</span>
            </motion.div>
          ))}
        </div>
      </GlassCard>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{filtered.length} entries shown</span>
        <span>{paused ? "⏸ Paused" : "● Live"}</span>
      </div>
    </div>
  );
};

export default LogViewer;
