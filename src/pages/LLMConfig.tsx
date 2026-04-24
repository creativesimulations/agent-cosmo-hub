import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Cpu, AlertCircle, CheckCircle2, KeyRound, Loader2, Save, RefreshCw, Server, Plus, ExternalLink } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import ActionableError from "@/components/ui/ActionableError";
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
import {
  LLM_PROVIDERS,
  MODEL_OPTIONS,
  findProviderForModel,
  type LLMProvider,
  type LLMModel,
} from "@/lib/llmCatalog";
import { detectLocalRuntimes, type LocalRuntime } from "@/lib/localModels";
import { toast } from "sonner";

const CUSTOM_MODEL_VALUE = "__custom__";

const readConfiguredModel = (config: string) => {
  const match = config.match(/^\s*model:\s*(.+)\s*$/m);
  return match ? match[1].trim().replace(/^['"]|['"]$/g, "") : null;
};

/** Build a LLMProvider entry on the fly from a detected local runtime. */
const runtimeToProvider = (rt: LocalRuntime): LLMProvider => ({
  id: rt.id,
  label: rt.label,
  envVar: "",
  prefix: "",
  hint: `Detected on ${rt.endpoint}. ${
    rt.models.length === 0
      ? "Server is running but no models are loaded — load one in the runtime first."
      : `${rt.models.length} model${rt.models.length === 1 ? "" : "s"} available.`
  }`,
  defaultModel: rt.models[0]?.id ?? `${rt.id}/`,
  local: true,
  allowCustomModel: true,
});

const LLMConfig = () => {
  const navigate = useNavigate();
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
  const [loadError, setLoadError] = useState<string>("");
  const [saveError, setSaveError] = useState<string>("");
  // Detected local runtimes (Ollama, LM Studio, llama.cpp, vLLM, …).
  const [localRuntimes, setLocalRuntimes] = useState<LocalRuntime[]>([]);
  const [scanningLocal, setScanningLocal] = useState(true);
  const dirtyRef = useRef(false);

  // ─── Merged catalog (built-in providers + detected local runtimes) ──────
  const allProviders = useMemo<LLMProvider[]>(
    () => [...LLM_PROVIDERS, ...localRuntimes.map(runtimeToProvider)],
    [localRuntimes],
  );

  const allModelOptions = useMemo<Record<string, LLMModel[]>>(() => {
    const merged: Record<string, LLMModel[]> = { ...MODEL_OPTIONS };
    for (const rt of localRuntimes) {
      merged[rt.id] = rt.models;
    }
    return merged;
  }, [localRuntimes]);

  const findProvider = (id: string | null | undefined) =>
    id ? allProviders.find((p) => p.id === id) ?? null : null;

  const findProviderForModelLocal = (m: string | null | undefined): LLMProvider | null => {
    if (!m) return null;
    const id = m.split("/")[0];
    return findProvider(id) ?? findProviderForModel(m);
  };

  const applyLoadedModel = (current: string | null, savedKeyList: string[], force = false) => {
    setSavedKeys(savedKeyList);
    setModel(current);
    if (force || !dirtyRef.current) {
      const provider = findProviderForModelLocal(current) ?? allProviders[0];
      setProviderId(provider.id);
      const known = (allModelOptions[provider.id] ?? []).some((m) => m.id === current);
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
    if (!config.success) {
      setLoadError(config.error || "Could not read config.yaml");
    } else {
      setLoadError("");
    }
    const current = config.success && config.content ? readConfiguredModel(config.content) : null;
    applyLoadedModel(current, secrets.keys, force);
    if (force) setRefreshing(false);
    setLoading(false);
  };

  const scanLocal = async (showSpinner = false) => {
    if (showSpinner) setScanningLocal(true);
    const found = await detectLocalRuntimes();
    setLocalRuntimes(found);
    setScanningLocal(false);
  };

  // Initial load + refresh when connection state flips
  useEffect(() => {
    setLoading(true);
    void loadAll(true);
    void scanLocal(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentConnected]);

  // Live sync — poll config every 5s and re-scan local runtimes every 15s.
  useEffect(() => {
    const cfgInterval = window.setInterval(() => void loadAll(false), 5000);
    const localInterval = window.setInterval(() => void scanLocal(false), 15000);
    const onFocus = () => {
      void loadAll(false);
      void scanLocal(false);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(cfgInterval);
      window.clearInterval(localInterval);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeProvider = useMemo(() => findProviderForModelLocal(model), [model, allProviders]);
  const providerForDraft = useMemo(
    () => findProvider(providerId) ?? allProviders[0],
    [providerId, allProviders],
  );
  const draftProviderHasKey =
    !providerForDraft.envVar || savedKeys.includes(providerForDraft.envVar);

  const markDirty = () => {
    dirtyRef.current = true;
  };

  const handleProviderChange = (id: string) => {
    markDirty();
    setProviderId(id);
    const opts = allModelOptions[id] ?? [];
    const provider = findProvider(id);
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
      setSaveError("");
      toast.success("Model updated", { description: draftModel });
      setModel(draftModel);
      dirtyRef.current = false;
      void refreshConnection();
    } else {
      setSaveError(result.stderr || "Could not write config.yaml");
      toast.error("Failed to update model", {
        description: result.stderr || "Could not write config.yaml",
      });
    }
  };

  const handleManualRefresh = () => {
    dirtyRef.current = false;
    void loadAll(true);
    void scanLocal(true);
  };

  const modelOptions = allModelOptions[providerId] ?? [];
  const isDirty = draftModel !== model;
  const selectValue = isCustom ? CUSTOM_MODEL_VALUE : draftModel;
  const detectedRuntime = localRuntimes.find((r) => r.id === providerId) ?? null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Cpu className="w-6 h-6 text-primary" />
            LLM Configuration
          </h1>
          <p className="text-sm text-muted-foreground">
            Choose which agentic model your agent should use. Hosted providers, OpenRouter's
            auto-router, plus any local runtimes detected on this machine.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleManualRefresh}
          disabled={refreshing}
          className="text-muted-foreground hover:text-foreground"
          title="Reload from config.yaml and rescan local runtimes"
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
          {loadError && (
            <ActionableError
              title="Could not load model settings"
              summary={loadError}
              details={loadError}
              onFix={handleManualRefresh}
            />
          )}

          {saveError && (
            <ActionableError
              title="Could not save model settings"
              summary={saveError}
              details={saveError}
              onFix={handleSave}
              fixLabel="Try Save Again"
            />
          )}

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
              <div className="flex items-center justify-between text-sm font-medium text-foreground">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-primary" /> Providers
                </div>
                {scanningLocal && (
                  <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                )}
              </div>
              <div className="space-y-2">
                {LLM_PROVIDERS.map((provider) => {
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
                {localRuntimes.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground/70 pt-1 border-t border-white/5">
                    No local runtimes detected. Start Ollama, LM Studio, llama.cpp, or vLLM and
                    they'll appear here automatically.
                  </div>
                ) : (
                  localRuntimes.map((rt) => (
                    <div
                      key={rt.id}
                      className="flex items-center justify-between text-xs text-muted-foreground"
                    >
                      <span className="flex items-center gap-1.5">
                        <Server className="w-3 h-3 text-success" /> {rt.label}
                      </span>
                      <span className="text-success">
                        {rt.models.length > 0 ? `${rt.models.length} models` : "running"}
                      </span>
                    </div>
                  ))
                )}
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
                    {allProviders.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground/80">{providerForDraft.hint}</p>
                {providerForDraft.docsUrl && (
                  <a
                    href={providerForDraft.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                  >
                    Provider docs <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Model</label>
                <Select value={selectValue} onValueChange={handleModelSelect}>
                  <SelectTrigger>
                    <SelectValue placeholder={modelOptions.length === 0 ? "No models found" : "Select a model"} />
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
                <div className="flex-1 space-y-2">
                  <p>
                    No API key found for {providerForDraft.label}. The agent expects it as{" "}
                    <code className="font-mono">{providerForDraft.envVar}</code>.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-warning/40 text-warning hover:bg-warning/20 hover:text-warning"
                    onClick={() => navigate(`/secrets?addKey=${providerForDraft.envVar}`)}
                  >
                    <Plus className="w-3 h-3 mr-1" /> Add {providerForDraft.envVar}
                  </Button>
                  {providerForDraft.docsUrl && (
                    <a
                      href={providerForDraft.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                    >
                      Where to get this key <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            )}

            {providerForDraft.local && detectedRuntime && (
              <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 border border-white/5 rounded-md p-3">
                <Server className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
                <span>
                  Detected at <code className="font-mono">{detectedRuntime.endpoint}</code>.{" "}
                  {detectedRuntime.models.length === 0
                    ? "The runtime is up but no models are loaded — load one and click Refresh."
                    : `${detectedRuntime.models.length} model${detectedRuntime.models.length === 1 ? "" : "s"} available.`}
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
