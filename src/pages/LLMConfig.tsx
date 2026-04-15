import { useState } from "react";
import { Cpu, Check, Star, Globe } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface ModelProvider {
  id: string;
  name: string;
  models: { id: string; name: string; enabled: boolean; isDefault?: boolean }[];
  isLocal?: boolean;
}

const initialProviders: ModelProvider[] = [
  {
    id: "openai",
    name: "OpenAI",
    models: [
      { id: "gpt-4o", name: "GPT-4o", enabled: true, isDefault: true },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", enabled: true },
      { id: "o1", name: "o1", enabled: false },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    models: [
      { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet", enabled: true },
      { id: "claude-3-haiku", name: "Claude 3 Haiku", enabled: false },
    ],
  },
  {
    id: "ollama",
    name: "Ollama (Local)",
    isLocal: true,
    models: [
      { id: "llama3.1", name: "Llama 3.1 70B", enabled: false },
      { id: "mistral", name: "Mistral 7B", enabled: false },
    ],
  },
];

const LLMConfig = () => {
  const [providers, setProviders] = useState(initialProviders);

  const toggleModel = (providerId: string, modelId: string) => {
    setProviders((prev) =>
      prev.map((p) =>
        p.id === providerId
          ? { ...p, models: p.models.map((m) => (m.id === modelId ? { ...m, enabled: !m.enabled } : m)) }
          : p
      )
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Cpu className="w-6 h-6 text-primary" />
          LLM Configuration
        </h1>
        <p className="text-sm text-muted-foreground">Configure which models your agents can use</p>
      </div>

      <div className="space-y-4">
        {providers.map((provider) => (
          <GlassCard key={provider.id} className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {provider.isLocal ? (
                  <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
                    <Globe className="w-4 h-4 text-success" />
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Cpu className="w-4 h-4 text-primary" />
                  </div>
                )}
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{provider.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {provider.models.filter((m) => m.enabled).length}/{provider.models.length} models enabled
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              {provider.models.map((model) => (
                <div
                  key={model.id}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-lg transition-all",
                    model.enabled ? "glass-subtle border-primary/10" : "bg-white/[0.02]"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-foreground font-mono">{model.name}</span>
                    {model.isDefault && (
                      <span className="flex items-center gap-1 text-[10px] font-medium text-warning bg-warning/10 px-2 py-0.5 rounded-full">
                        <Star className="w-3 h-3" /> Default
                      </span>
                    )}
                  </div>
                  <Switch
                    checked={model.enabled}
                    onCheckedChange={() => toggleModel(provider.id, model.id)}
                  />
                </div>
              ))}
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  );
};

export default LLMConfig;
