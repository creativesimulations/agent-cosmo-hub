import { useEffect, useMemo, useState } from "react";
import { Cpu, AlertCircle, CheckCircle2, KeyRound, Loader2, Save } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
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
  const [saving, setSaving] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    const [config, secrets] = await Promise.all([
      systemAPI.readConfig(),
      systemAPI.secrets.list(),
    ]);
    const current = config.success && config.content ? readConfiguredModel(config.content) : null;
    setModel(current);
    setSavedKeys(secrets.keys);
    const provider = findProviderForModel(current) ?? LLM_PROVIDERS[0];
    setProviderId(provider.id);
    setDraftModel(current ?? provider.defaultModel);
    setLoading(false);
  };

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentConnected]);

  const activeProvider = useMemo(() => findProviderForModel(model), [model]);
  const providerForDraft = useMemo(
    () => LLM_PROVIDERS.find((p) => p.id === providerId) ?? LLM_PROVIDERS[0],
    [providerId]
  );
  const draftProviderHasKey =
    !providerForDraft.envVar || savedKeys.includes(providerForDraft.envVar);

  const handleProviderChange = (id: string) => {
    setProviderId(id);
    const opts = MODEL_OPTIONS[id] ?? [];
    setDraftModel(opts[0]?.id ?? LLM_PROVIDERS.find((p) => p.id === id)?.defaultModel ?? "");
  };

  const handleSave = async () => {
    if (!draftModel) return;
    setSaving(true);
    const result = await systemAPI.setModel(draftModel);
    setSaving(false);
    if (result.success) {
      toast.success("Model updated", { description: draftModel });
      setModel(draftModel);
      void refreshConnection();
    } else {
      toast.error("Failed to update model", {
        description: result.stderr || "Could not write config.yaml",
      });
    }
  };

  const modelOptions = MODEL_OPTIONS[providerId] ?? [];
  const isDirty = draftModel !== model;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Cpu className="w-6 h-6 text-primary" />
          LLM Configuration
        </h1>
        <p className="text-sm text-muted-foreground">
          Choose which agentic model your agent should use. Only models with reliable
          tool-calling are listed.
        </p>
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
            </GlassCard>

            <GlassCard className="space-y-2">
              <p className="text-xs text-muted-foreground">Active provider</p>
              <div className="flex items-center gap-2 text-sm text-foreground">
                {activeProvider ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-success" />
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
                  const has = !provider.envVar || savedKeys.includes(provider.envVar);
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
                <Select value={draftModel} onValueChange={setDraftModel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {modelOptions.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
