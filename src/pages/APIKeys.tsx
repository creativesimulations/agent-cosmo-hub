import { useState } from "react";
import { KeyRound, Eye, EyeOff, Plus, CheckCircle2, AlertCircle, Trash2 } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ApiKey {
  id: string;
  provider: string;
  key: string;
  status: "valid" | "invalid" | "unchecked";
}

const initialKeys: ApiKey[] = [
  { id: "1", provider: "OpenAI", key: "sk-proj-****...****a8Xf", status: "valid" },
  { id: "2", provider: "Anthropic", key: "sk-ant-****...****7mQp", status: "valid" },
  { id: "3", provider: "Hugging Face", key: "hf_****...****9kLm", status: "invalid" },
];

const APIKeys = () => {
  const [keys, setKeys] = useState(initialKeys);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  const toggleVisibility = (id: string) => {
    setShowKeys((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <KeyRound className="w-6 h-6 text-primary" />
            API Keys & Credentials
          </h1>
          <p className="text-sm text-muted-foreground">Securely manage your provider API keys</p>
        </div>
        <Button size="sm" className="gradient-primary text-primary-foreground">
          <Plus className="w-4 h-4 mr-1" /> Add Key
        </Button>
      </div>

      <GlassCard variant="subtle" className="p-3">
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <KeyRound className="w-3 h-3 text-accent" />
          Keys are encrypted locally using Electron's safeStorage API and never transmitted.
        </p>
      </GlassCard>

      <div className="space-y-3">
        {keys.map((apiKey) => (
          <GlassCard key={apiKey.id} className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                {apiKey.status === "valid" ? (
                  <CheckCircle2 className="w-4 h-4 text-success" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-destructive" />
                )}
                <span className="text-sm font-semibold text-foreground">{apiKey.provider}</span>
              </div>
              <span className="text-xs font-mono text-muted-foreground">
                {showKeys[apiKey.id] ? "sk-proj-abc123...full-key-here" : apiKey.key}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => toggleVisibility(apiKey.id)}
              >
                {showKeys[apiKey.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  );
};

export default APIKeys;
