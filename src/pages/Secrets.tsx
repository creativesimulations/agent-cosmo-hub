import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  KeyRound, Eye, EyeOff, Plus, Trash2, Globe, Shield, Loader2, Lock, AlertTriangle, ArrowDownToLine, RefreshCw, Puzzle,
} from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { systemAPI, secretsStore, type SecretsBackend } from "@/lib/systemAPI";
import { findPresetByEnvVar } from "@/lib/secretPresets";
import SecretForm from "@/components/secrets/SecretForm";
import { toast } from "sonner";

interface SecretEntry {
  envVar: string;
  provider: string;
  masked: string;
  revealed?: string;
}

const labelForEnvVar = (envVar: string): string =>
  findPresetByEnvVar(envVar)?.label ?? envVar;

const maskValue = (val: string): string => {
  if (!val) return "(empty)";
  if (val.length <= 8) return "••••••••";
  return val.substring(0, 4) + "••••••••" + val.substring(val.length - 4);
};

const backendStyles: Record<SecretsBackend, { color: string; icon: React.ReactNode; safe: boolean }> = {
  keychain: { color: "text-success", icon: <Lock className="w-3 h-3" />, safe: true },
  safestorage: { color: "text-success", icon: <Lock className="w-3 h-3" />, safe: true },
  memory: { color: "text-muted-foreground", icon: <AlertTriangle className="w-3 h-3" />, safe: false },
  plaintext: { color: "text-warning", icon: <AlertTriangle className="w-3 h-3" />, safe: false },
};

const Secrets = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [keys, setKeys] = useState<SecretEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [presetEnvVar, setPresetEnvVar] = useState<string>("");
  const [backend, setBackend] = useState<{ backend: SecretsBackend; label: string } | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // env-var → list of skill names that reference it. Lets us show "Used by"
  // chips so users can spot typos like `X` instead of `X_BEARER_TOKEN`.
  const [skillUsage, setSkillUsage] = useState<Map<string, string[]>>(new Map());

  useEffect(() => {
    init();
  }, []);

  // Honor ?addKey=OPENROUTER_API_KEY deep-links from the LLM Config page.
  useEffect(() => {
    const params = new URLSearchParams(location.search || location.hash.split("?")[1] || "");
    const requested = params.get("addKey");
    if (requested) {
      setPresetEnvVar(requested);
      setShowAddForm(true);
      navigate(location.pathname, { replace: true });
    }
  }, [location, navigate]);

  const init = async () => {
    setLoading(true);
    const info = await secretsStore.getBackend();
    setBackend(info);
    await loadKeys();
    // Best-effort: build the secret→skills map. If listSkills fails (no agent),
    // we silently skip — Secrets still works without it.
    try {
      const sk = await systemAPI.listSkills();
      if (sk.success) {
        const usage = new Map<string, string[]>();
        for (const s of sk.skills) {
          for (const env of s.requiredSecrets ?? []) {
            const arr = usage.get(env) ?? [];
            arr.push(s.name);
            usage.set(env, arr);
          }
        }
        setSkillUsage(usage);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const loadKeys = async () => {
    const { keys: keyNames } = await secretsStore.list();
    const entries: SecretEntry[] = await Promise.all(
      keyNames.map(async (envVar) => {
        const value = await secretsStore.get(envVar);
        return {
          envVar,
          provider: labelForEnvVar(envVar),
          masked: maskValue(value),
          revealed: value,
        };
      })
    );
    setKeys(entries);
  };

  const syncToAgent = async (showToast = false) => {
    setSyncing(true);
    const res = await secretsStore.materializeEnv();
    setSyncing(false);
    if (showToast) {
      if (res.success) {
        toast.success("Secrets synced to agent", {
          description: `${res.count ?? 0} secret${res.count === 1 ? "" : "s"} written to ~/.hermes/.env`,
        });
      } else {
        toast.error("Failed to sync secrets", { description: res.error || "Unknown error" });
      }
    }
    return res;
  };

  const toggleVisibility = (envVar: string) => {
    setShowKeys((prev) => ({ ...prev, [envVar]: !prev[envVar] }));
  };

  const handleAddKey = async (envVar: string, value: string) => {
    if (!envVar || !value) return;
    setAdding(true);
    const ok = await secretsStore.set(envVar, value);
    if (ok) {
      toast.success(`Saved ${envVar}`);
      await syncToAgent(false);
    } else {
      toast.error(`Could not save ${envVar}`, {
        description: "Check the Logs tab — the credential store rejected the write.",
      });
    }
    setShowAddForm(false);
    setPresetEnvVar("");
    await loadKeys();
    setAdding(false);
  };

  const handleDeleteKey = async (envVar: string) => {
    await secretsStore.delete(envVar);
    await syncToAgent(false);
    await loadKeys();
  };

  const handleMigrateFromEnv = async () => {
    setMigrating(true);
    await secretsStore.migrateFromEnv();
    await loadKeys();
    setMigrating(false);
  };

  const handleManualSync = () => {
    void syncToAgent(true);
  };

  const style = backend ? backendStyles[backend.backend] : backendStyles.plaintext;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <KeyRound className="w-6 h-6 text-primary" />
            Secrets
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Anything the agent uses to log in — API keys, bot tokens, email passwords, app-specific
            passwords. The <strong className="text-foreground">name</strong> matters: skills look for
            exact environment-variable names like <code className="text-foreground">OPENAI_API_KEY</code>.
            Open{" "}
            <button onClick={() => navigate("/skills")} className="text-primary hover:underline inline-flex items-center gap-0.5">
              <Puzzle className="w-3 h-3" /> Skills &amp; Tools
            </button>{" "}
            to see exactly what each skill expects.
          </p>
        </div>
        <Button
          size="sm"
          className="gradient-primary text-primary-foreground shrink-0"
          onClick={() => setShowAddForm(!showAddForm)}
        >
          <Plus className="w-4 h-4 mr-1" /> Add Secret
        </Button>
      </div>

      {/* Storage backend & security explainer */}
      <GlassCard className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 ${style.color}`}>
            {style.safe ? <Shield className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
          </div>
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">Storage:</span>
              <span className={`text-sm font-medium ${style.color}`}>
                {backend?.label || "Detecting…"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {backend?.backend === "keychain" && (
                <>Secrets are stored in your operating system's keychain — the same hardened, OS-managed vault used by 1Password, GitHub CLI, and VS Code. They're encrypted at rest and only decrypted briefly when an agent starts.</>
              )}
              {backend?.backend === "safestorage" && (
                <>Secrets are encrypted at rest using your OS account key. They're only decrypted briefly when an agent starts and written to <code className="text-foreground/70">~/.hermes/.env</code> with owner-only permissions (chmod 600).</>
              )}
              {backend?.backend === "memory" && (
                <>Browser preview mode — secrets are kept in memory only for testing the UI. Run the desktop app to use real encrypted storage.</>
              )}
              {backend?.backend === "plaintext" && (
                <>No encrypted backend is available on this system. Install <code>libsecret</code> (Linux) for keychain support.</>
              )}
            </p>
          </div>
        </div>
        {backend?.backend !== "memory" && (
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/5">
            <p className="text-xs text-muted-foreground flex-1">
              Secrets are pushed to <code>~/.hermes/.env</code> automatically when you add or
              remove a key. Use the buttons if anything looks out of sync.
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleMigrateFromEnv}
                disabled={migrating}
                className="h-7 text-xs"
                title="Pull credential-shaped keys out of an existing plaintext .env into secure storage"
              >
                {migrating ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <ArrowDownToLine className="w-3 h-3 mr-1" />}
                Re-import .env
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleManualSync}
                disabled={syncing}
                className="h-7 text-xs"
                title="Decrypt all stored secrets and write them to ~/.hermes/.env"
              >
                {syncing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                Sync to agent
              </Button>
            </div>
          </div>
        )}
      </GlassCard>

      {showAddForm && (
        <GlassCard className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Add New Secret</h3>
          <SecretForm
            initialEnvVar={presetEnvVar}
            saving={adding}
            onSave={handleAddKey}
            onCancel={() => {
              setShowAddForm(false);
              setPresetEnvVar("");
            }}
          />
        </GlassCard>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading secrets...
        </div>
      ) : keys.length === 0 ? (
        <GlassCard className="text-center py-8">
          <p className="text-sm text-muted-foreground">
            No secrets configured yet. Click "Add Secret" or run the install wizard to get started.
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
                  {showKeys[apiKey.envVar] ? apiKey.revealed : apiKey.masked}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded bg-white/5 flex items-center gap-1 ${style.color}`}>
                  {style.icon}
                  {backend?.backend === "keychain" ? "Keychain" :
                    backend?.backend === "safestorage" ? "Encrypted" :
                    backend?.backend === "memory" ? "Memory" : "Plaintext"}
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

export default Secrets;
