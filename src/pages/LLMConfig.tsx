import { useEffect, useMemo, useState } from "react";
import { Cpu, AlertCircle, CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import { systemAPI } from "@/lib/systemAPI";

const PROVIDERS = [
  { id: "openrouter", label: "OpenRouter", envVar: "OPENROUTER_API_KEY" },
  { id: "openai", label: "OpenAI", envVar: "OPENAI_API_KEY" },
  { id: "anthropic", label: "Anthropic", envVar: "ANTHROPIC_API_KEY" },
  { id: "nous", label: "Nous Portal", envVar: "NOUS_API_KEY" },
  { id: "ollama", label: "Ollama (Local)", envVar: "" },
] as const;

const readConfiguredModel = (config: string) => {
  const match = config.match(/^\s*model:\s*(.+)\s*$/m);
  return match ? match[1].trim().replace(/^['\"]|['\"]$/g, "") : null;
};

const LLMConfig = () => {
  const { connected: agentConnected } = useAgentConnection();
  const [loading, setLoading] = useState(true);
  const [model, setModel] = useState<string | null>(null);
  const [savedKeys, setSavedKeys] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      const [config, secrets] = await Promise.all([
        systemAPI.readConfig(),
        systemAPI.secrets.list(),
      ]);

      if (cancelled) return;

      setModel(config.success && config.content ? readConfiguredModel(config.content) : null);
      setSavedKeys(secrets.keys);
      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [agentConnected]);

  const activeProvider = useMemo(() => {
    if (!model) return null;
    const providerId = model.split("/")[0];
    return PROVIDERS.find((provider) => provider.id === providerId) ?? null;
  }, [model]);

  const configuredProviders = useMemo(
    () => PROVIDERS.filter((provider) => !provider.envVar || savedKeys.includes(provider.envVar)),
    [savedKeys]
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Cpu className="w-6 h-6 text-primary" />
          LLM Configuration
        </h1>
        <p className="text-sm text-muted-foreground">Configure which models your agents can use</p>
      </div>

      {loading ? (
        <GlassCard className="flex items-center justify-center py-16">
          <div className="text-center space-y-3">
            <Loader2 className="w-10 h-10 text-primary mx-auto animate-spin" />
            <p className="text-sm text-muted-foreground">Loading configured LLMs…</p>
          </div>
        </GlassCard>
      ) : model ? (
        <div className="grid gap-4 md:grid-cols-3">
          <GlassCard className="space-y-2">
            <p className="text-xs text-muted-foreground">Default model</p>
            <p className="text-sm font-medium text-foreground break-all">{model}</p>
          </GlassCard>

          <GlassCard className="space-y-2">
            <p className="text-xs text-muted-foreground">Active provider</p>
            <div className="flex items-center gap-2 text-sm text-foreground">
              <CheckCircle2 className="w-4 h-4 text-success" />
              <span>{activeProvider?.label ?? "Custom provider"}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {agentConnected ? "Agent connection is active." : "Configuration found; reconnecting the local agent will enable chat and live status."}
            </p>
          </GlassCard>

          <GlassCard className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <KeyRound className="w-4 h-4 text-primary" /> Saved credentials
            </div>
            <div className="space-y-2">
              {configuredProviders.map((provider) => (
                <div key={provider.id} className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{provider.label}</span>
                  <span className="text-success">Configured</span>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>
      ) : (
        <GlassCard className="flex items-center justify-center py-16">
          <div className="text-center space-y-3">
            <AlertCircle className="w-10 h-10 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">No LLM configuration found</p>
            <p className="text-xs text-muted-foreground/60">Finish installation or reconnect the local agent to load its configured model and provider.</p>
          </div>
        </GlassCard>
      )}
    </div>
  );
};

export default LLMConfig;
