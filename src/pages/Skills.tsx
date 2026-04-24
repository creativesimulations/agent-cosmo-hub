import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Puzzle, AlertCircle, CheckCircle2, Loader2, RefreshCw, Search, Package, Wrench,
  ChevronDown, ChevronRight, KeyRound, Power, MoreHorizontal, Globe, Plus,
} from "lucide-react";
import InstallSkillDialog from "@/components/skills/InstallSkillDialog";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import { systemAPI, secretsStore } from "@/lib/systemAPI";
import { toast } from "sonner";
import BrowserSetupDialog from "@/components/skills/BrowserSetupDialog";
import BrowserBackendBadge from "@/components/skills/BrowserBackendBadge";
import ActionableError from "@/components/ui/ActionableError";

type Skill = {
  name: string;
  category: string;
  source: "user" | "bundled";
  description?: string;
  requiredSecrets?: string[];
};

const Skills = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { connected: agentConnected } = useAgentConnection();
  const [loading, setLoading] = useState(true);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [disabledSet, setDisabledSet] = useState<Set<string>>(new Set());
  const [secretKeys, setSecretKeys] = useState<Set<string>>(new Set());
  const [savingToggle, setSavingToggle] = useState<string | null>(null);
  const [focusCap, setFocusCap] = useState<string | null>(null);
  const [browserSetupOpen, setBrowserSetupOpen] = useState(false);
  const [browserRefreshKey, setBrowserRefreshKey] = useState(0);
  const [installOpen, setInstallOpen] = useState(false);
  const [actionError, setActionError] = useState<string>("");

  // Read ?focus=<capId> from the URL — drives a scroll + highlight of any
  // skill rows whose names match the capability's candidate skill list.
  useEffect(() => {
    const params = new URLSearchParams(location.search || (location.hash.split("?")[1] || ""));
    const f = params.get("focus");
    if (f) {
      setFocusCap(f);
      // Pre-fill search to surface matching rows immediately.
      setQuery(f.replace(/^skill:/, ""));
      const t = window.setTimeout(() => setFocusCap(null), 4000);
      return () => window.clearTimeout(t);
    }
  }, [location.search, location.hash]);

  const load = useCallback(async () => {
    if (!agentConnected) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const [result, cfg, sec] = await Promise.all([
      systemAPI.listSkills(),
      systemAPI.getSkillsConfig(),
      secretsStore.list(),
    ]);
    if (result.success) {
      setSkills(result.skills);
    } else {
      setError(result.error ?? "Failed to read skills.");
      setSkills([]);
    }
    setDisabledSet(new Set(cfg.disabled));
    setSecretKeys(new Set(sec.keys || []));
    setLoading(false);
  }, [agentConnected]);

  useEffect(() => { void load(); }, [load]);

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
  const needsSetup = useMemo(
    () => skills.filter((s) => {
      if (disabledSet.has(s.name)) return false;
      const missing = (s.requiredSecrets ?? []).filter((k) => !secretKeys.has(k));
      return missing.length > 0;
    }),
    [skills, disabledSet, secretKeys],
  );

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleToggle = async (skill: Skill, nextEnabled: boolean) => {
    const key = `${skill.category}/${skill.name}`;
    setSavingToggle(key);
    // Optimistic
    setDisabledSet((prev) => {
      const n = new Set(prev);
      if (nextEnabled) n.delete(skill.name); else n.add(skill.name);
      return n;
    });
    const r = await systemAPI.setSkillEnabled(skill.name, nextEnabled);
    setSavingToggle(null);
    if (!r.success) {
      setActionError(r.error || "Failed to update skill state.");
      toast.error("Couldn't save", { description: r.error || "Failed to update config" });
      // Revert
      setDisabledSet((prev) => {
        const n = new Set(prev);
        if (nextEnabled) n.add(skill.name); else n.delete(skill.name);
        return n;
      });
      return;
    }
    setActionError("");
    toast.success(`${nextEnabled ? "Enabled" : "Disabled"} ${skill.name}`, {
      description: "Takes effect the next time the agent restarts.",
    });
  };

  const bulkAction = async (action: "enableAll" | "disableAll" | { enableOnly: string }) => {
    const targets = action === "enableAll" || action === "disableAll"
      ? skills
      : skills.filter((s) => s.category === action.enableOnly);
    if (action === "enableAll") {
      for (const s of targets) await systemAPI.setSkillEnabled(s.name, true);
    } else if (action === "disableAll") {
      for (const s of targets) await systemAPI.setSkillEnabled(s.name, false);
    } else {
      // Enable only this category — disable everything else
      for (const s of skills) {
        const inCat = s.category === action.enableOnly;
        await systemAPI.setSkillEnabled(s.name, inCat);
      }
    }
    toast.success("Bulk update saved", {
      description: "Takes effect the next time the agent restarts.",
    });
    void load();
  };

  const statusFor = (skill: Skill): { label: string; tone: "ready" | "needs" | "disabled" } => {
    if (disabledSet.has(skill.name)) return { label: "Disabled", tone: "disabled" };
    const missing = (skill.requiredSecrets ?? []).filter((k) => !secretKeys.has(k));
    if (missing.length > 0) return { label: "Needs setup", tone: "needs" };
    return { label: "Ready", tone: "ready" };
  };

  if (!agentConnected) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Puzzle className="w-6 h-6 text-primary" />
            Skills & Tools
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

  const categoryNames = Array.from(new Set(skills.map((s) => s.category))).sort();

  return (
    <div className="p-6 space-y-6">
      {actionError && (
        <ActionableError
          title="Skill update failed"
          summary={actionError}
          details={actionError}
          onFix={() => setActionError("")}
          fixLabel="Dismiss"
        />
      )}

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Puzzle className="w-6 h-6 text-primary" />
            Skills & Tools
          </h1>
          <p className="text-sm text-muted-foreground">
            Everything the agent can do. Toggle a skill off to stop the agent from using it.
            Changes save to <code className="text-foreground">~/.hermes/config.yaml</code> and
            take effect on the next agent restart.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setInstallOpen(true)}
            className="gradient-primary text-primary-foreground"
          >
            <Plus className="w-4 h-4 mr-1" /> Install skill
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="border-white/10">
                <MoreHorizontal className="w-4 h-4 mr-1" /> Bulk
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Bulk actions</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => void bulkAction("enableAll")}>
                Enable all
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void bulkAction("disableAll")}>
                Disable all
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[11px] text-muted-foreground">
                Enable only category
              </DropdownMenuLabel>
              {categoryNames.map((c) => (
                <DropdownMenuItem key={c} onClick={() => void bulkAction({ enableOnly: c })}>
                  {c}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
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

      {needsSetup.length > 0 && (
        <GlassCard className="border-warning/30 bg-warning/5">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <p className="text-sm font-medium text-foreground">
                {needsSetup.length} skill{needsSetup.length === 1 ? "" : "s"} need
                {needsSetup.length === 1 ? "s" : ""} an API key before {needsSetup.length === 1 ? "it" : "they"} can run
              </p>
              <p className="text-xs text-muted-foreground">
                These skills are enabled but the secrets they require haven't been added yet.
                The agent will fail or skip the skill until the missing keys are filled in.
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {needsSetup.slice(0, 8).map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => {
                      setExpanded((prev) => new Set(prev).add(`${s.category}/${s.name}`));
                      setQuery(s.name);
                    }}
                    className="text-[11px] font-mono px-2 py-0.5 rounded border border-warning/30 bg-warning/10 text-warning hover:bg-warning/20 transition-colors"
                  >
                    {s.name}
                  </button>
                ))}
                {needsSetup.length > 8 && (
                  <span className="text-[11px] text-muted-foreground self-center">
                    +{needsSetup.length - 8} more
                  </span>
                )}
              </div>
            </div>
          </div>
        </GlassCard>
      )}

      <div className="grid gap-4 md:grid-cols-4">
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
        <GlassCard className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <KeyRound className="w-3.5 h-3.5" /> Need setup
          </div>
          <p className={`text-2xl font-bold ${needsSetup.length > 0 ? "text-warning" : "text-foreground"}`}>
            {needsSetup.length}
          </p>
          <p className="text-[11px] text-muted-foreground/70">Missing required secrets</p>
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

      <GlassCard className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-primary/15 text-primary flex items-center justify-center shrink-0">
              <Globe className="w-4.5 h-4.5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-semibold text-foreground">Browser automation (optional)</h3>
                <Badge variant="outline" className="border-white/10 text-muted-foreground text-[10px]">
                  Capability
                </Badge>
                <Badge variant="outline" className="border-success/30 text-success text-[10px]">
                  Web search included
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Basic web information retrieval uses <code>web_search</code>/<code>web_extract</code> and does not require browser automation.
                Configure this only if you want interactive browser actions (click, type, navigate).
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => setBrowserSetupOpen(true)}
            className="gradient-primary text-primary-foreground shrink-0"
          >
            <Globe className="w-3.5 h-3.5 mr-1.5" /> Set up browser
          </Button>
        </div>
        <BrowserBackendBadge
          refreshKey={browserRefreshKey}
          onSwitch={() => setBrowserSetupOpen(true)}
        />
      </GlassCard>

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
                {items.map((skill) => {
                  const key = `${skill.category}/${skill.name}`;
                  const isOpen = expanded.has(key);
                  const isEnabled = !disabledSet.has(skill.name);
                  const status = statusFor(skill);
                  const missing = (skill.requiredSecrets ?? []).filter((k) => !secretKeys.has(k));
                  const present = (skill.requiredSecrets ?? []).filter((k) => secretKeys.has(k));
                  const toneClass =
                    status.tone === "ready"
                      ? "text-success border-success/30 bg-success/5"
                      : status.tone === "needs"
                      ? "text-warning border-warning/30 bg-warning/5"
                      : "text-muted-foreground border-white/10 bg-white/5";

                  return (
                    <GlassCard
                      key={key}
                      variant="subtle"
                      className="space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => toggleExpand(key)}
                          className="flex items-center gap-1.5 text-left flex-1 min-w-0 hover:text-primary transition-colors"
                        >
                          {isOpen ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
                          <span className="text-sm font-medium text-foreground font-mono break-all">
                            {skill.name}
                          </span>
                        </button>
                        <Switch
                          checked={isEnabled}
                          disabled={savingToggle === key}
                          onCheckedChange={(v) => void handleToggle(skill, v)}
                          aria-label={`${isEnabled ? "Disable" : "Enable"} ${skill.name}`}
                        />
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline" className={toneClass}>
                          {status.label}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={
                            skill.source === "user"
                              ? "text-primary border-primary/30 bg-primary/5"
                              : "text-muted-foreground border-white/10"
                          }
                        >
                          {skill.source}
                        </Badge>
                        {(skill.requiredSecrets?.length ?? 0) > 0 && (
                          <Badge variant="outline" className="text-muted-foreground border-white/10">
                            <KeyRound className="w-3 h-3 mr-1" />
                            {skill.requiredSecrets!.length} secret{skill.requiredSecrets!.length === 1 ? "" : "s"}
                          </Badge>
                        )}
                      </div>
                      {skill.description && !isOpen && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {skill.description}
                        </p>
                      )}
                      {isOpen && (
                        <div className="space-y-3 pt-2 border-t border-white/5">
                          {skill.description && (
                            <p className="text-xs text-muted-foreground">{skill.description}</p>
                          )}
                          {(skill.requiredSecrets?.length ?? 0) === 0 ? (
                            <p className="text-[11px] text-muted-foreground/70 italic">
                              No secrets required.
                            </p>
                          ) : (
                            <div className="space-y-1.5">
                              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/70">
                                Required secrets
                              </p>
                              {present.map((envVar) => (
                                <div key={envVar} className="flex items-center justify-between gap-2 text-xs">
                                  <span className="font-mono text-foreground">{envVar}</span>
                                  <span className="flex items-center gap-1 text-success">
                                    <CheckCircle2 className="w-3 h-3" /> Configured
                                  </span>
                                </div>
                              ))}
                              {missing.map((envVar) => (
                                <div key={envVar} className="flex items-center justify-between gap-2 text-xs">
                                  <span className="font-mono text-foreground">{envVar}</span>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-2 text-warning hover:text-warning hover:bg-warning/10"
                                    onClick={() => navigate(`/secrets?addKey=${envVar}`)}
                                  >
                                    <KeyRound className="w-3 h-3 mr-1" /> Add
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}
                          {!isEnabled && (
                            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                              <Power className="w-3 h-3" /> Disabled — agent will not call this skill.
                            </p>
                          )}
                        </div>
                      )}
                    </GlassCard>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <BrowserSetupDialog
        open={browserSetupOpen}
        onOpenChange={setBrowserSetupOpen}
        onConfigured={() => {
          setBrowserRefreshKey((k) => k + 1);
          void load();
        }}
      />

      <InstallSkillDialog
        open={installOpen}
        onOpenChange={setInstallOpen}
        kind="skill"
        onInstalled={({ missingSecrets }) => {
          void load();
          if (missingSecrets.length > 0) {
            navigate(`/secrets?addKey=${missingSecrets[0]}`);
          }
        }}
      />
    </div>
  );
};

export default Skills;
