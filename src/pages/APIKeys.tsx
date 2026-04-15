import { useState } from "react";
import {
  KeyRound, Eye, EyeOff, Plus, CheckCircle2, AlertCircle, Trash2,
  GitBranch, Globe, Shield,
} from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ApiKey {
  id: string;
  provider: string;
  key: string;
  status: "valid" | "invalid" | "unchecked";
  category: "llm" | "git" | "platform";
}

const initialKeys: ApiKey[] = [
  { id: "git", provider: "GitHub (PAT)", key: "ghp_****...****xK9m", status: "valid", category: "git" },
  { id: "1", provider: "OpenAI", key: "sk-proj-****...****a8Xf", status: "valid", category: "llm" },
  { id: "2", provider: "Anthropic", key: "sk-ant-****...****7mQp", status: "valid", category: "llm" },
  { id: "3", provider: "Hugging Face", key: "hf_****...****9kLm", status: "invalid", category: "llm" },
];

const categories = [
  { id: "git", label: "Git & Source", icon: GitBranch },
  { id: "llm", label: "LLM Providers", icon: Globe },
  { id: "platform", label: "Platforms", icon: Shield },
];

const APIKeys = () => {
  const [keys, setKeys] = useState(initialKeys);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const toggleVisibility = (id: string) => {
    setShowKeys((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const filtered = activeCategory === "all" ? keys : keys.filter((k) => k.category === activeCategory);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <KeyRound className="w-6 h-6 text-primary" />
            API Keys & Credentials
          </h1>
          <p className="text-sm text-muted-foreground">Securely manage provider keys, Git tokens, and platform credentials</p>
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

      {/* Category tabs */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setActiveCategory("all")}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
            activeCategory === "all" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
          )}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5",
              activeCategory === cat.id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
            )}
          >
            <cat.icon className="w-3 h-3" />
            {cat.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map((apiKey) => (
          <GlassCard key={apiKey.id} className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                {apiKey.status === "valid" ? (
                  <CheckCircle2 className="w-4 h-4 text-success" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-destructive" />
                )}
                <span className="text-sm font-semibold text-foreground">{apiKey.provider}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground capitalize">
                  {apiKey.category}
                </span>
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
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
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
