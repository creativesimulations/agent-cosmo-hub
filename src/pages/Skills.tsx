import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Puzzle, AlertCircle, Loader2, RefreshCw, Search, Package, Wrench,
  KeyRound, Globe, Plus, Sparkles, ExternalLink, Box,
} from "lucide-react";
import InstallSkillDialog from "@/components/skills/InstallSkillDialog";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import { systemAPI, secretsStore } from "@/lib/systemAPI";
import { toast } from "sonner";
import BrowserSetupDialog from "@/components/skills/BrowserSetupDialog";
import BrowserBackendBadge from "@/components/skills/BrowserBackendBadge";
import ActionableError from "@/components/ui/ActionableError";
import { getUpgrade, isUpgradeUnlocked } from "@/lib/licenses";
import CapabilityGallery from "@/components/dashboard/CapabilityGallery";
import { cn } from "@/lib/utils";

type Skill = {
  name: string;
  category: string;
  source: "user" | "bundled";
  description?: string;
  requiredSecrets?: string[];
};

const openExternal = (url: string) => window.open(url, "_blank", "noopener,noreferrer");

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
  const [unlocks, setUnlocks] = useState<Record<string, boolean>>({});
  const [googleWorkspaceBusy, setGoogleWorkspaceBusy] = useState(false);
  const [plugins, setPlugins] = useState<Array<{ name: string; enabled?: boolean; description?: string; source?: string }>>([]);
  const [pluginsCliAvailable, setPluginsCliAvailable] = useState(true);

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
    const [result, cfg, sec, googleworkspace, pluginsR] = await Promise.all([
      systemAPI.listSkills(),
      systemAPI.getSkillsConfig(),
      secretsStore.list(),
      isUpgradeUnlocked("googleworkspace"),
      systemAPI.listPlugins(),
    ]);
    if (result.success) {
      setSkills(result.skills);
    } else {
      setError(result.error ?? "Failed to read skills.");
      setSkills([]);
    }
    setDisabledSet(new Set(cfg.disabled));
    setSecretKeys(new Set(sec.keys || []));
    setUnlocks({ googleworkspace });
    setPlugins(pluginsR.plugins);
    setPluginsCliAvailable(pluginsR.cliAvailable);
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

  const googleWorkspaceUpgrade = getUpgrade("googleworkspace");
  const googleWorkspaceUnlocked = !!unlocks.googleworkspace;
  const googleWorkspaceSkill = skills.find((s) => s.name.toLowerCase() === "google-workspace");
  const googleWorkspaceNeedsSecrets = (googleWorkspaceSkill?.requiredSecrets ?? []).filter(
    (k) => !secretKeys.has(k),
  );

  const handleGoogleWorkspaceSetup = async () => {
    if (!googleWorkspaceUnlocked) return;
    setGoogleWorkspaceBusy(true);
    try {
      const r = await systemAPI.setupGoogleWorkspace();
      if (r.success) {
        toast.success("Google Workspace is connected", {
          description: "Gmail/Calendar/Drive tools are now ready for the next agent restart.",
        });
        setActionError("");
        await load();
        return;
      }
      setActionError(r.error || "Google Workspace setup failed.");
      toast.error("Google Workspace setup failed", {
        description: r.error || "Check diagnostics output and retry.",
      });
    } finally {
      setGoogleWorkspaceBusy(false);
    }
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
            Everything your agent can do. Want a new tool, skill, or external integration —
            including MCP servers, new channels, or custom skills? Just ask the agent in chat.
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

      {pluginsCliAvailable && plugins.length > 0 && (
        <GlassCard className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-md bg-primary/15 text-primary flex items-center justify-center shrink-0">
                <Box className="w-4.5 h-4.5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">Plugins</h3>
                <p className="text-xs text-muted-foreground">
                  Extensions registered with the agent. Install or remove via chat —
                  e.g. "install the foo plugin".
                </p>
              </div>
            </div>
            <Badge variant="outline" className="border-white/10 text-muted-foreground text-[10px]">
              {plugins.length} installed
            </Badge>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {plugins.map((p) => (
              <div
                key={p.name}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-border bg-background/30"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                  {p.description && (
                    <p className="text-[11px] text-muted-foreground truncate">{p.description}</p>
                  )}
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] shrink-0",
                    p.enabled === false
                      ? "border-muted-foreground/20 text-muted-foreground"
                      : "border-success/30 text-success",
                  )}
                >
                  {p.enabled === false ? "Disabled" : "Enabled"}
                </Badge>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      <GlassCard className={`p-4 space-y-3 ${googleWorkspaceUnlocked ? "" : "border-primary/30 bg-primary/5"}`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-primary/15 text-primary flex items-center justify-center shrink-0">
              <Sparkles className="w-4.5 h-4.5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-semibold text-foreground">Google Workspace (paid add-on)</h3>
                <Badge variant="outline" className="border-white/10 text-muted-foreground text-[10px]">
                  {googleWorkspaceUpgrade?.priceLabel ?? "One-time · $1"}
                </Badge>
                {googleWorkspaceUnlocked && (
                  <Badge variant="outline" className="border-success/30 text-success text-[10px]">
                    Unlocked
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                One-click setup for Hermes <code>google-workspace</code> skill (Gmail, Calendar, Drive, Docs, Sheets).
              </p>
              {googleWorkspaceUnlocked && googleWorkspaceSkill && googleWorkspaceNeedsSecrets.length > 0 && (
                <p className="text-[11px] text-warning mt-1">
                  Missing secrets: {googleWorkspaceNeedsSecrets.join(", ")}
                </p>
              )}
            </div>
          </div>
          {googleWorkspaceUnlocked ? (
            <Button
              size="sm"
              onClick={() => void handleGoogleWorkspaceSetup()}
              className="gradient-primary text-primary-foreground shrink-0"
              disabled={googleWorkspaceBusy}
            >
              {googleWorkspaceBusy ? (
                <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Setting up…</>
              ) : (
                <>Set up Google Workspace</>
              )}
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => openExternal(googleWorkspaceUpgrade?.buyUrl ?? "https://ronbot.com/upgrades")}
              >
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Buy add-on
              </Button>
              <Button size="sm" variant="ghost" onClick={() => navigate("/upgrades")}>
                Enter key
              </Button>
            </div>
          )}
        </div>
      </GlassCard>

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

      <CapabilityGallery
        heading="What can your agent do?"
        subheading="Click any tile to ask the agent to set it up — it will guide you step by step in chat."
      />

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
