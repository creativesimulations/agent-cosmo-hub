import { useEffect, useMemo, useRef, useState } from "react";
import { Cpu, AlertCircle, CheckCircle2, KeyRound, Loader2, Save, RefreshCw, Server } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import { systemAPI } from "@/lib/systemAPI";
import { LLM_PROVIDERS, MODEL_OPTIONS, findProviderForModel } from "@/lib/llmCatalog";
import { toast } from "sonner";

const CUSTOM_MODEL_VALUE = "__custom__";

const readConfiguredModel = (config: string) => {
  const match = config.match(/^\s*model:\s*(.+)\s*$/m);
  return match ? match[1].trim().replace(/^['"]|['"]$/g, "") : null;
};

const LLMConfig = () => {
  const { connected: agentConnected, refresh: refreshConnection } = useAgentConnection();
  const [loading, setLoading] = useState(true);
  const [model, setModel] = useState<string | null>(null);
  const [savedKeys, setSavedKeys] = useState<string[]>([]);
  const [providerId, setProviderId] = useState<string>("openrouter");
  const [draftModel, setDraftModel] = useState<string>("");
  const [isCustom, setIsCustom] = useState(false);
  const [customModel, setCustomModel] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Track whether the user has dirty edits — if so, skip live syncs so we
  // don't overwrite their work.
  const dirtyRef = useRef(false);

  const applyLoadedModel = (current: string | null, savedKeyList: string[], force = false) => {
    setSavedKeys(savedKeyList);
    setModel(current);
    if (force || !dirtyRef.current) {
      const provider = findProviderForModel(current) ?? LLM_PROVIDERS[0];
      setProviderId(provider.id);
      const known = (MODEL_OPTIONS[provider.id] ?? []).some((m) => m.id === current);
      if (current && !known) {
        setIsCustom(true);
        setCustomModel(current);
        setDraftModel(current);
      } else {
        setIsCustom(false);
        setCustomModel("");
        setDraftModel(current ?? provider.defaultModel);
      }
      dirtyRef.current = false;
    }
  };

  const loadAll = async (force = false) => {
    if (force) setRefreshing(true);
    const [config, secrets] = await Promise.all([
      systemAPI.readConfig(),
      systemAPI.secrets.list(),
    ]);
    const current = config.success && config.content ? readConfiguredModel(config.content) : null;
    applyLoadedModel(current, secrets.keys, force);
    if (force) setRefreshing(false);
    setLoading(false);
  };

  // Initial load + refresh when connection state flips
  useEffect(() => {
    setLoading(true);
    void loadAll(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentConnected]);

  // Live sync — poll the config file every 5s and on window focus so changes
  // made by the agent itself (e.g. /model command) show up here.
  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadAll(false);
    }, 5000);
    const onFocus = () => void loadAll(false);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeProvider = useMemo(() => findProviderForModel(model), [model]);
  const providerForDraft = useMemo(
    () => LLM_PROVIDERS.find((p) => p.id === providerId) ?? LLM_PROVIDERS[0],
    [providerId]
  );
  const draftProviderHasKey =
    !providerForDraft.envVar || savedKeys.includes(providerForDraft.envVar);

  const markDirty = () => {
    dirtyRef.current = true;
  };

  const handleProviderChange = (id: string) => {
    markDirty();
    setProviderId(id);
    const opts = MODEL_OPTIONS[id] ?? [];
    const provider = LLM_PROVIDERS.find((p) => p.id === id);
    const fallback = opts[0]?.id ?? provider?.defaultModel ?? "";
    setIsCustom(false);
    setCustomModel("");
    setDraftModel(fallback);
  };

  const handleModelSelect = (value: string) => {
    markDirty();
    if (value === CUSTOM_MODEL_VALUE) {
      setIsCustom(true);
      setDraftModel(customModel || "");
    } else {
      setIsCustom(false);
      setDraftModel(value);
    }
  };

  const handleCustomChange = (value: string) => {
    markDirty();
    setCustomModel(value);
    setDraftModel(value.trim());
  };

  const handleSave = async () => {
    if (!draftModel) return;
    setSaving(true);
    const result = await systemAPI.setModel(draftModel);
    setSaving(false);
    if (result.success) {
      toast.success("Model updated", { description: draftModel });
      setModel(draftModel);
      dirtyRef.current = false;
      void refreshConnection();
    } else {
      toast.error("Failed to update model", {
        description: result.stderr || "Could not write config.yaml",
      });
    }
  };

  const handleManualRefresh = () => {
    dirtyRef.current = false;
    void loadAll(true);
  };

  const modelOptions = MODEL_OPTIONS[providerId] ?? [];
  const isDirty = draftModel !== model;
  const selectValue = isCustom ? CUSTOM_MODEL_VALUE : draftModel;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Cpu className="w-6 h-6 text-primary" />
            LLM Configuration
          </h1>
          <p className="text-sm text-muted-foreground">
            Choose which agentic model your agent should use. Includes hosted providers,
            OpenRouter's auto-router, and local runtimes.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleManualRefresh}
          disabled={refreshing}
          className="text-muted-foreground hover:text-foreground"
          title="Reload from config.yaml"
        >
          {refreshing ? (
            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-1" />
          )}
          Refresh
        </Button>
      </div>

      {loading ? (
        <GlassCard className="flex items-center justify-center py-16">
          <div className="text-center space-y-3">
            <Loader2 className="w-10 h-10 text-primary mx-auto animate-spin" />
            <p className="text-sm text-muted-foreground">Loading configured LLMs…</p>
          </div>
        </GlassCard>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <GlassCard className="space-y-2">
              <p className="text-xs text-muted-foreground">Current model</p>
              <p className="text-sm font-medium text-foreground break-all">
                {model ?? "Not configured"}
              </p>
              <p className="text-[11px] text-muted-foreground/80">
                Live — synced from config.yaml every few seconds.
              </p>
            </GlassCard>

            <GlassCard className="space-y-2">
              <p className="text-xs text-muted-foreground">Active provider</p>
              <div className="flex items-center gap-2 text-sm text-foreground">
                {activeProvider ? (
                  <>
                    {activeProvider.local ? (
                      <Server className="w-4 h-4 text-success" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-success" />
                    )}
                    <span>{activeProvider.label}</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-4 h-4 text-muted-foreground" />
                    <span>Unknown</span>
                  </>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {agentConnected
                  ? "Agent connection is active."
                  : "Reconnect the local agent to enable chat and live status."}
              </p>
            </GlassCard>

            <GlassCard className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <KeyRound className="w-4 h-4 text-primary" /> Saved credentials
              </div>
              <div className="space-y-2">
                {LLM_PROVIDERS.map((provider) => {
                  if (provider.local) {
                    return (
                      <div
                        key={provider.id}
                        className="flex items-center justify-between text-xs text-muted-foreground"
                      >
                        <span>{provider.label}</span>
                        <span className="text-muted-foreground/60">No key needed</span>
                      </div>
                    );
                  }
                  const has = savedKeys.includes(provider.envVar);
                  return (
                    <div
                      key={provider.id}
                      className="flex items-center justify-between text-xs text-muted-foreground"
                    >
                      <span>{provider.label}</span>
                      <span className={has ? "text-success" : "text-muted-foreground/60"}>
                        {has ? "Configured" : "Missing key"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </GlassCard>
          </div>

          <GlassCard className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Change model</h2>
              <p className="text-xs text-muted-foreground">
                Pick a provider and model. The change is written to your agent's config.yaml.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Provider</label>
                <Select value={providerId} onValueChange={handleProviderChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LLM_PROVIDERS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground/80">{providerForDraft.hint}</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Model</label>
                <Select value={selectValue} onValueChange={handleModelSelect}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {modelOptions.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                      </SelectItem>
                    ))}
                    {providerForDraft.allowCustomModel && (
                      <SelectItem value={CUSTOM_MODEL_VALUE}>
                        Custom model id…
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {isCustom && (
                  <Input
                    value={customModel}
                    onChange={(e) => handleCustomChange(e.target.value)}
                    placeholder={
                      providerForDraft.local
                        ? `${providerForDraft.id}/your-model:tag`
                        : "provider/model-id"
                    }
                    className="font-mono text-sm bg-background/50 border-white/10"
                  />
                )}
              </div>
            </div>

            {!draftProviderHasKey && (
              <div className="flex items-start gap-2 text-xs text-warning bg-warning/10 border border-warning/20 rounded-md p-3">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  No API key found for {providerForDraft.label}. Add{" "}
                  <code className="font-mono">{providerForDraft.envVar}</code> in the Secrets
                  tab before switching, or the agent will fail to start.
                </span>
              </div>
            )}

            {providerForDraft.local && (
              <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 border border-white/5 rounded-md p-3">
                <Server className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
                <span>
                  {providerForDraft.id === "ollama"
                    ? "Make sure Ollama is running locally (default http://localhost:11434) and that you've pulled the model with `ollama pull <model>`."
                    : "Make sure LM Studio's local server is running (default http://localhost:1234) with the chosen model loaded."}
                </span>
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={!isDirty || saving || !draftModel}>
                {saving ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                Save model
              </Button>
            </div>
          </GlassCard>
        </>
      )}
    </div>
  );
};

export default LLMConfig;
