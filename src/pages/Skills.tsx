// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Puzzle, AlertCircle, Loader2, RefreshCw, Search, Package, Wrench,
  KeyRound, Globe, Plus, Box,
} from "lucide-react";
import { useChat } from "@/contexts/ChatContext";
import { useCapabilities } from "@/contexts/CapabilitiesContext";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import { systemAPI, secretsStore } from "@/lib/systemAPI";
import BrowserBackendBadge from "@/components/skills/BrowserBackendBadge";
import ActionableError from "@/components/ui/ActionableError";
import CapabilityGallery from "@/components/dashboard/CapabilityGallery";
import { SkillsByCategory } from "@/components/skills/SkillsByCategory";
import { InstallSkillDialog } from "@/components/skills/InstallSkillDialog";
import { PageShell } from "@/components/layout/PageShell";
import { NotConnectedCard } from "@/components/layout/NotConnectedCard";
import { StatGrid } from "@/components/layout/StatGrid";
import { cn } from "@/lib/utils";
import {
  invalidateSkillCaches,
  skillRowKey,
  skillSetupPrompt,
  type ListedSkill,
} from "@/features/skills/skillModel";

/** Browser automation is the only skill-adjacent UI with a non-manifest backend picker. */
const Skills = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { setDraft } = useChat();
  const { rediscover } = useCapabilities();
  const { connected: agentConnected } = useAgentConnection();
  const [loading, setLoading] = useState(true);
  const [skills, setSkills] = useState<ListedSkill[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [disabledSet, setDisabledSet] = useState<Set<string>>(new Set());
  const [secretKeys, setSecretKeys] = useState<Set<string>>(new Set());
  const [focusCap, setFocusCap] = useState<string | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const browserRefreshKey = 0;
  const [actionError, setActionError] = useState<string>("");
  const [plugins, setPlugins] = useState<Array<{ name: string; enabled?: boolean; description?: string; source?: string }>>([]);
  const [pluginsCliAvailable, setPluginsCliAvailable] = useState(true);

  const delegateToAgent = useCallback((prompt: string) => {
    setDraft(prompt);
    navigate("/");
  }, [setDraft, navigate]);

  const load = useCallback(async () => {
    if (!agentConnected) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const [result, cfg, sec, pluginsR] = await Promise.all([
      systemAPI.listSkills(),
      systemAPI.getSkillsConfig(),
      secretsStore.list(),
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
    setPlugins(pluginsR.plugins);
    setPluginsCliAvailable(pluginsR.cliAvailable);
    setLoading(false);
  }, [agentConnected]);

  const refreshAll = useCallback(async () => {
    invalidateSkillCaches();
    await rediscover();
    await load();
  }, [rediscover, load]);

  useEffect(() => {
    const params = new URLSearchParams(location.search || (location.hash.split("?")[1] || ""));
    const f = params.get("focus");
    if (f) {
      setFocusCap(f);
      setQuery(f.replace(/^skill:/, "").replace(/-/g, " "));
      const t = window.setTimeout(() => setFocusCap(null), 4000);
      return () => window.clearTimeout(t);
    }
  }, [location.search, location.hash]);

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
    const map = new Map<string, ListedSkill[]>();
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

  const handleSetup = (skill: ListedSkill) => {
    delegateToAgent(skillSetupPrompt(skill));
  };

  const handleToggled = () => {
    void refreshAll();
  };

  const bulkSetEnabled = async (enabled: boolean, onlyCategory?: string) => {
    if (skills.length === 0) return;
    setBulkBusy(true);
    setActionError("");
    try {
      for (const skill of skills) {
        const shouldEnable = onlyCategory ? skill.category === onlyCategory : enabled;
        const r = await systemAPI.setSkillEnabled(skill.name, shouldEnable);
        if (!r.success) {
          setActionError(r.error ?? `Failed to update ${skill.name}`);
          return;
        }
      }
      invalidateSkillCaches();
      await rediscover();
      await load();
    } finally {
      setBulkBusy(false);
    }
  };

  if (!agentConnected) {
    return (
      <PageShell title="Skills & Tools" description="Capabilities the agent can use" icon={Puzzle}>
        <NotConnectedCard
          title="No agent connected"
          description="Install and start an agent to see its skills."
          ctaLabel="Go to Install"
          ctaTo="/install"
        />
      </PageShell>
    );
  }

  const categoryNames = Array.from(new Set(skills.map((s) => s.category))).sort();

  return (
    <PageShell
      title="Skills & Tools"
      description="Everything your agent can do. Want a new tool, skill, or external integration — including MCP servers, new channels, or custom skills? Just ask the agent in chat."
      icon={Puzzle}
      actions={
        <>
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
            onClick={() => void refreshAll()}
            disabled={loading || bulkBusy}
            className="text-muted-foreground hover:text-foreground"
          >
            {loading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
            Refresh
          </Button>
        </>
      }
    >
      <InstallSkillDialog
        open={installOpen}
        onOpenChange={setInstallOpen}
        onInstalled={() => void refreshAll()}
        onSetupInChat={delegateToAgent}
        onAskAgentInstall={() =>
          delegateToAgent(
            "Please install a new skill for me. Ask me for the path or git URL, then handle the install and any required secrets.",
          )
        }
      />

      {actionError && (
        <ActionableError
          title="Skill update failed"
          summary={actionError}
          details={actionError}
          onFix={() => setActionError("")}
          fixLabel="Dismiss"
        />
      )}

      {error && (
        <GlassCard className="border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </GlassCard>
      )}

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
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {needsSetup.slice(0, 8).map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => {
                      setExpanded((prev) => new Set(prev).add(skillRowKey(s)));
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

      <StatGrid
        stats={[
          { label: "Total skills", value: skills.length, icon: Puzzle },
          { label: "Bundled", value: bundledCount, icon: Package, hint: "Shipped with the agent install" },
          { label: "User", value: userCount, icon: Wrench, hint: "From ~/.hermes/skills/" },
          {
            label: "Need setup",
            value: needsSetup.length,
            icon: KeyRound,
            hint: "Missing required secrets",
            valueClassName: needsSetup.length > 0 ? "text-warning" : "text-foreground",
          },
        ]}
        className="md:grid-cols-2 lg:grid-cols-4"
      />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search skills by name, category, or description…"
          className="pl-9 bg-background/50 border-white/10"
        />
      </div>

      {skills.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={bulkBusy}
            onClick={() => void bulkSetEnabled(true)}
          >
            Enable all
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={bulkBusy}
            onClick={() => void bulkSetEnabled(false)}
          >
            Disable all
          </Button>
          {categoryNames.map((cat) => (
            <Button
              key={cat}
              size="sm"
              variant="ghost"
              className="text-xs"
              disabled={bulkBusy}
              onClick={() => void bulkSetEnabled(true, cat)}
            >
              Only {cat}
            </Button>
          ))}
        </div>
      )}

      <GlassCard className="p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading skills…
          </div>
        ) : (
          <SkillsByCategory
            categories={grouped}
            disabledSet={disabledSet}
            secretKeys={secretKeys}
            expanded={expanded}
            highlightName={focusCap}
            onToggleExpand={toggleExpand}
            onSetup={handleSetup}
            onToggled={handleToggled}
          />
        )}
      </GlassCard>

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
                  Extensions registered with the agent. Install or remove via chat.
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
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Basic web search does not require browser automation. Configure this only for interactive browser actions.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() =>
              delegateToAgent(
                "Please set up browser automation for me. Ask what backend I want, install or configure what is needed, and guide me through any login or key steps.",
              )
            }
            className="gradient-primary text-primary-foreground shrink-0"
          >
            <Globe className="w-3.5 h-3.5 mr-1.5" /> Ask agent to set up
          </Button>
        </div>
        <BrowserBackendBadge
          refreshKey={browserRefreshKey}
          onSwitch={() =>
            delegateToAgent(
              "Please help me switch browser automation backends and apply any required config changes.",
            )
          }
        />
      </GlassCard>

      <CapabilityGallery
        heading="What can your agent do?"
        subheading="Click any tile to ask the agent to set it up — it will guide you step by step in chat."
      />

    </PageShell>
  );
};

export default Skills;
