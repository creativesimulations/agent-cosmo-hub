import { useState, useEffect } from "react";
import {
  KeyRound, Eye, EyeOff, Plus, CheckCircle2, AlertCircle, Trash2,
  Globe, Shield, Loader2, Save,
} from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { systemAPI } from "@/lib/systemAPI";

interface ApiKeyEntry {
  envVar: string;
  provider: string;
  value: string;
  masked: string;
  status: "valid" | "unchecked";
}

const KNOWN_KEYS: Record<string, string> = {
  OPENROUTER_API_KEY: "OpenRouter",
  OPENAI_API_KEY: "OpenAI",
  ANTHROPIC_API_KEY: "Anthropic",
  NOUS_API_KEY: "Nous Portal",
  TELEGRAM_BOT_TOKEN: "Telegram",
  DISCORD_BOT_TOKEN: "Discord",
  SLACK_BOT_TOKEN: "Slack",
  EXA_API_KEY: "Exa Search",
  FIRECRAWL_API_KEY: "Firecrawl",
  ELEVENLABS_API_KEY: "ElevenLabs",
};

const maskValue = (val: string): string => {
  if (val.length <= 8) return "****";
  return val.substring(0, 4) + "****" + val.substring(val.length - 4);
};

const APIKeys = () => {
  const [keys, setKeys] = useState<ApiKeyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyValue, setNewKeyValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    loadKeys();
  }, []);

  const loadKeys = async () => {
    setLoading(true);
    try {
      const envVars = await systemAPI.readEnvFile();
      const entries: ApiKeyEntry[] = Object.entries(envVars).map(([envVar, value]: [string, string]) => ({
        envVar,
        provider: KNOWN_KEYS[envVar] || envVar,
        value,
        masked: maskValue(value),
        status: "unchecked" as const,
      }));
      setKeys(entries);
    } catch {
      setKeys([]);
    }
    setLoading(false);
  };

  const toggleVisibility = (envVar: string) => {
    setShowKeys((prev) => ({ ...prev, [envVar]: !prev[envVar] }));
  };

  const handleAddKey = async () => {
    if (!newKeyName || !newKeyValue) return;
    setAdding(true);
    await systemAPI.setEnvVar(newKeyName, newKeyValue);
    setNewKeyName("");
    setNewKeyValue("");
    setShowAddForm(false);
    await loadKeys();
    setAdding(false);
  };

  const handleDeleteKey = async (envVar: string) => {
    await systemAPI.removeEnvVar(envVar);
    await loadKeys();
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <KeyRound className="w-6 h-6 text-primary" />
            API Keys & Credentials
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage provider keys stored securely on your machine
          </p>
        </div>
        <Button
          size="sm"
          className="gradient-primary text-primary-foreground"
          onClick={() => setShowAddForm(!showAddForm)}
        >
          <Plus className="w-4 h-4 mr-1" /> Add Key
        </Button>
      </div>

      <GlassCard variant="subtle" className="p-3">
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <Shield className="w-3 h-3 text-accent" />
          Keys are stored locally and never transmitted. They are read and written via secure IPC.
        </p>
      </GlassCard>

      {showAddForm && (
        <GlassCard className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Add New Key</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Variable Name</label>
              <Input
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value.toUpperCase())}
                placeholder="OPENAI_API_KEY"
                className="bg-background/50 border-white/10 font-mono text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Value</label>
              <Input
                type="password"
                value={newKeyValue}
                onChange={(e) => setNewKeyValue(e.target.value)}
                placeholder="sk-..."
                className="bg-background/50 border-white/10 font-mono text-sm"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground flex-1">
              Common: OPENROUTER_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN
            </p>
            <Button
              size="sm"
              onClick={handleAddKey}
              disabled={!newKeyName || !newKeyValue || adding}
              className="gradient-primary text-primary-foreground"
            >
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
              Save
            </Button>
          </div>
        </GlassCard>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading keys...
        </div>
      ) : keys.length === 0 ? (
        <GlassCard className="text-center py-8">
          <p className="text-sm text-muted-foreground">
            No API keys configured yet. Click "Add Key" or run the install wizard to get started.
          </p>
        </GlassCard>
      ) : (
        <div className="space-y-3">
          {keys.map((apiKey) => (
            <GlassCard key={apiKey.envVar} className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">{apiKey.provider}</span>
                </div>
                <span className="text-xs font-mono text-muted-foreground">
                  {showKeys[apiKey.envVar] ? apiKey.value : apiKey.masked}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground font-mono">
                  {apiKey.envVar}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => toggleVisibility(apiKey.envVar)}
                >
                  {showKeys[apiKey.envVar] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDeleteKey(apiKey.envVar)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
};

export default APIKeys;
