import { useCallback, useEffect, useMemo, useState } from "react";
import { Puzzle, AlertCircle, CheckCircle2, Loader2, RefreshCw, Search, Package, Wrench } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import { systemAPI } from "@/lib/systemAPI";

type Skill = {
  name: string;
  category: string;
  source: "user" | "bundled";
  description?: string;
};

const Skills = () => {
  const { connected: agentConnected } = useAgentConnection();
  const [loading, setLoading] = useState(true);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    if (!agentConnected) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const result = await systemAPI.listSkills();
    if (result.success) {
      setSkills(result.skills);
    } else {
      setError(result.error ?? "Failed to read skills.");
      setSkills([]);
    }
    setLoading(false);
  }, [agentConnected]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        (s.description?.toLowerCase().includes(q) ?? false),
    );
  }, [skills, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, Skill[]>();
    for (const s of filtered) {
      const arr = map.get(s.category) ?? [];
      arr.push(s);
      map.set(s.category, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const userCount = skills.filter((s) => s.source === "user").length;
  const bundledCount = skills.filter((s) => s.source === "bundled").length;

  if (!agentConnected) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Puzzle className="w-6 h-6 text-primary" />
            Skills
          </h1>
          <p className="text-sm text-muted-foreground">Capabilities the agent can use</p>
        </div>
        <GlassCard className="flex items-center justify-center py-16">
          <div className="text-center space-y-3 max-w-md">
            <AlertCircle className="w-10 h-10 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">No agent connected</p>
            <p className="text-xs text-muted-foreground/60">
              Install and start an agent to see its skills.
            </p>
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Puzzle className="w-6 h-6 text-primary" />
            Skills
          </h1>
          <p className="text-sm text-muted-foreground">
            Capabilities currently available to the agent. Skills bundled with the install
            ship out of the box; user skills come from <code className="text-foreground">~/.hermes/skills</code>.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          className="text-muted-foreground hover:text-foreground"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-1" />
          )}
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <GlassCard className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Puzzle className="w-3.5 h-3.5" /> Total skills
          </div>
          <p className="text-2xl font-bold text-foreground">{skills.length}</p>
        </GlassCard>
        <GlassCard className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Package className="w-3.5 h-3.5" /> Bundled
          </div>
          <p className="text-2xl font-bold text-foreground">{bundledCount}</p>
          <p className="text-[11px] text-muted-foreground/70">Shipped with the agent install</p>
        </GlassCard>
        <GlassCard className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Wrench className="w-3.5 h-3.5" /> User
          </div>
          <p className="text-2xl font-bold text-foreground">{userCount}</p>
          <p className="text-[11px] text-muted-foreground/70">From ~/.hermes/skills/</p>
        </GlassCard>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search skills by name, category, or description…"
          className="pl-9 bg-background/50 border-white/10"
        />
      </div>

      {loading ? (
        <GlassCard className="flex items-center justify-center py-16">
          <div className="text-center space-y-3">
            <Loader2 className="w-8 h-8 text-primary mx-auto animate-spin" />
            <p className="text-sm text-muted-foreground">Scanning ~/.hermes/skills…</p>
          </div>
        </GlassCard>
      ) : error ? (
        <GlassCard className="flex items-center justify-center py-12">
          <div className="text-center space-y-2 max-w-md">
            <AlertCircle className="w-8 h-8 text-destructive mx-auto" />
            <p className="text-sm text-foreground">Couldn't read skills</p>
            <p className="text-xs text-muted-foreground break-words">{error}</p>
          </div>
        </GlassCard>
      ) : skills.length === 0 ? (
        <GlassCard className="flex items-center justify-center py-16">
          <div className="text-center space-y-3 max-w-md">
            <CheckCircle2 className="w-10 h-10 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-foreground">No skills found</p>
            <p className="text-xs text-muted-foreground/60">
              Drop skill folders into <code className="text-foreground">~/.hermes/skills/</code> and click Refresh.
            </p>
          </div>
        </GlassCard>
      ) : filtered.length === 0 ? (
        <GlassCard className="flex items-center justify-center py-12">
          <p className="text-sm text-muted-foreground">No skills match "{query}".</p>
        </GlassCard>
      ) : (
        <div className="space-y-6">
          {grouped.map(([category, items]) => (
            <div key={category} className="space-y-2">
              <div className="flex items-baseline gap-2">
                <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                  {category}
                </h2>
                <span className="text-xs text-muted-foreground">{items.length}</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {items.map((skill) => (
                  <GlassCard
                    key={`${skill.category}/${skill.name}`}
                    variant="subtle"
                    className="space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-foreground font-mono break-all">
                        {skill.name}
                      </p>
                      <Badge
                        variant="outline"
                        className={
                          skill.source === "user"
                            ? "text-primary border-primary/30 bg-primary/5 shrink-0"
                            : "text-muted-foreground border-white/10 shrink-0"
                        }
                      >
                        {skill.source}
                      </Badge>
                    </div>
                    {skill.description && (
                      <p className="text-xs text-muted-foreground line-clamp-3">
                        {skill.description}
                      </p>
                    )}
                  </GlassCard>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Skills;
