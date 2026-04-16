import { useState } from "react";
import { FileText, Search, Filter, Pause, Play, Trash2, Download, AlertCircle } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type LogLevel = "debug" | "info" | "warn" | "error";

const levelBadgeColors: Record<LogLevel, string> = {
  debug: "bg-white/5 text-muted-foreground",
  info: "bg-primary/10 text-primary",
  warn: "bg-warning/10 text-warning",
  error: "bg-destructive/10 text-destructive",
};

const LogViewer = () => {
  const [search, setSearch] = useState("");
  const [activeFilters, setActiveFilters] = useState<LogLevel[]>(["debug", "info", "warn", "error"]);
  const [paused, setPaused] = useState(false);

  // TODO: Replace with real logs from agent
  const logs: never[] = [];

  const toggleFilter = (level: LogLevel) => {
    setActiveFilters((prev) =>
      prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]
    );
  };

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

      <GlassCard className="flex-1 overflow-hidden flex items-center justify-center">
        <div className="text-center space-y-3">
          <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto opacity-40" />
          <p className="text-sm text-muted-foreground">No logs yet. Logs will appear here when the agent is running.</p>
        </div>
      </GlassCard>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>0 entries</span>
        <span>{paused ? "⏸ Paused" : "● Waiting for agent"}</span>
      </div>
    </div>
  );
};

export default LogViewer;
