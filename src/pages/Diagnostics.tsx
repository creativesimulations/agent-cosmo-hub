import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  Copy,
  Download,
  Trash2,
  RefreshCw,
  Stethoscope,
  Send,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { systemAPI } from "@/lib/systemAPI";
import { secretsStore, type BackendInfo } from "@/lib/systemAPI";
import { diagnostics, type DiagEntry } from "@/lib/diagnostics";
import { setDebugPromptDetection, isDebugPromptDetection } from "@/lib/approvalBridge";
import { ShieldCheck } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface EnvSummary {
  loaded: boolean;
  entries: Array<{ key: string; valueLength: number; managed: boolean }>;
  raw?: string;
  error?: string;
}

interface ConfigSummary {
  loaded: boolean;
  modelLine?: string;
  raw?: string;
  error?: string;
}

interface StoreSummary {
  loaded: boolean;
  backend?: BackendInfo;
  entries: Array<{ key: string; valueLength: number }>;
  error?: string;
}

const Diagnostics = () => {
  const [entries, setEntries] = useState<DiagEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [running, setRunning] = useState<"doctor" | "ping" | null>(null);
  const [envSummary, setEnvSummary] = useState<EnvSummary>({ loaded: false, entries: [] });
  const [cfgSummary, setCfgSummary] = useState<ConfigSummary>({ loaded: false });
  const [storeSummary, setStoreSummary] = useState<StoreSummary>({ loaded: false, entries: [] });
  const [lastResult, setLastResult] = useState<string>("");
  const [permsBlock, setPermsBlock] = useState<string | null>(null);
  const [syncingPerms, setSyncingPerms] = useState(false);
  const [debugPrompts, setDebugPrompts] = useState<boolean>(isDebugPromptDetection());

  useEffect(() => {
    const unsub = diagnostics.subscribe((all) => {
      setEntries(all.slice().reverse());
    });
    refreshSummaries();
    return unsub;
  }, []);

  const refreshSummaries = async () => {
    // 1. Credential store snapshot — this is the source of truth.
    try {
      const backend = await secretsStore.getBackend();
      const { keys } = await secretsStore.list();
      const storeEntries = await Promise.all(
        keys.map(async (k) => ({ key: k, valueLength: (await secretsStore.get(k)).length })),
      );
      setStoreSummary({ loaded: true, backend, entries: storeEntries });
    } catch (e) {
      setStoreSummary({ loaded: true, entries: [], error: e instanceof Error ? e.message : String(e) });
    }
    try {
      const env = await systemAPI.readEnvFile();
      const keys = Object.keys(env);
      setEnvSummary({
        loaded: true,
        entries: keys.map((k) => ({
          key: k,
          valueLength: env[k]?.length ?? 0,
          managed: /^(OPENROUTER|OPENAI|ANTHROPIC|GOOGLE|GEMINI|GROQ|MISTRAL|DEEPSEEK|NOUS|COHERE|PERPLEXITY|HUGGINGFACE|REPLICATE|EXA|FIRECRAWL|ELEVENLABS|BROWSERBASE|TELEGRAM|DISCORD|SLACK)_/i.test(k),
        })),
      });
    } catch (e) {
      setEnvSummary({ loaded: true, entries: [], error: e instanceof Error ? e.message : String(e) });
    }
    try {
      const cfg = await systemAPI.readConfig();
      const modelLine = cfg.success && cfg.content
        ? cfg.content.match(/^\s*model:\s*(.+)\s*$/m)?.[1]?.trim()
        : undefined;
      setCfgSummary({ loaded: true, modelLine, raw: cfg.content });
    } catch (e) {
      setCfgSummary({ loaded: true, error: e instanceof Error ? e.message : String(e) });
    }
    try {
      const block = await systemAPI.readPermissionsBlock();
      setPermsBlock(block);
    } catch {
      setPermsBlock(null);
    }
  };


  const handleSyncSecrets = async () => {
    setSyncing(true);
    setLastResult("");
    try {
      const r = await systemAPI.materializeEnv();
      if (r.success) {
        toast({ title: "Secrets synced", description: `Wrote ${r.count ?? 0} key(s) to ~/.hermes/.env` });
        setLastResult(`✅ OK — wrote ${r.count ?? 0} keys to ~/.hermes/.env`);
      } else {
        toast({ title: "Sync failed", description: r.error || "Unknown error", variant: "destructive" });
        const missing = r.missing && r.missing.length > 0 ? `\nMissing: ${r.missing.join(", ")}` : "";
        setLastResult(`❌ FAILED — ${r.error || "unknown error"}${missing}`);
      }
      await refreshSummaries();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Sync failed", description: msg, variant: "destructive" });
      setLastResult(`❌ FAILED — ${msg}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleDoctor = async () => {
    setRunning("doctor");
    try {
      const r = await systemAPI.hermesDoctor();
      setLastResult(`hermes doctor (exit=${r.code}):\n${r.stdout || r.stderr || "(no output)"}`);
    } finally {
      setRunning(null);
    }
  };

  const handlePing = async () => {
    setRunning("ping");
    try {
      const r = await systemAPI.chatAgent("ping");
      const head = r.success ? "✅ chat ok" : "❌ chat failed";
      setLastResult(`${head}\n\nReply:\n${r.reply || "(empty)"}\n\nDiagnostics:\n${r.diagnostics || "(none)"}\n\nstderr:\n${r.stderr || "(none)"}`);
    } finally {
      setRunning(null);
    }
  };

  const handleSyncPerms = async () => {
    setSyncingPerms(true);
    try {
      // Pull latest settings from disk-backed settings (mirrored by SettingsContext)
      // We just call the systemAPI which reads current PermissionsConfig from settings store.
      // Settings live in renderer; easiest path is to re-read what's already persisted via
      // the materialize path which also writes perms — but we expose syncPermissions directly.
      // The PermissionsPanel button does this with the live in-memory copy; here we trigger
      // a refresh of the on-disk block view.
      await refreshSummaries();
      toast({ title: "Refreshed", description: "Re-read managed permissions block from ~/.hermes/config.yaml" });
    } finally {
      setSyncingPerms(false);
    }
  };

  const toggleDebugPrompts = (on: boolean) => {
    setDebugPrompts(on);
    setDebugPromptDetection(on);
    toast({
      title: on ? "Prompt detection logging ON" : "Prompt detection logging OFF",
      description: on
        ? "Every approval-prompt match will be recorded in the agent log."
        : "Stopped logging prompt detection events.",
    });
  };

  const copyAll = async () => {
    await navigator.clipboard.writeText(diagnostics.toText());
    toast({ title: "Copied", description: `${entries.length} log entries copied` });
  };

  const downloadAll = () => {
    const blob = new Blob([diagnostics.toText()], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ronbot-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Activity className="w-6 h-6 text-primary" />
          Diagnostics
        </h1>
        <p className="text-sm text-muted-foreground">
          Inspect agent state, sync secrets manually, and review every shell command the app has run.{" "}
          <a href="#/logs" className="text-primary hover:underline">
            Looking for chat history or agent activity? See Logs →
          </a>
        </p>
      </div>

      {/* Action row */}
      <GlassCard className="p-4">
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSyncSecrets} disabled={syncing} className="gradient-primary text-primary-foreground">
            <RefreshCw className={cn("w-4 h-4 mr-2", syncing && "animate-spin")} />
            Sync secrets now
          </Button>
          <Button onClick={handleDoctor} disabled={running !== null} variant="secondary">
            <Stethoscope className={cn("w-4 h-4 mr-2", running === "doctor" && "animate-pulse")} />
            Run hermes doctor
          </Button>
          <Button onClick={handlePing} disabled={running !== null} variant="secondary">
            <Send className={cn("w-4 h-4 mr-2", running === "ping" && "animate-pulse")} />
            Test chat round-trip
          </Button>
          <Button onClick={refreshSummaries} variant="ghost" size="sm" className="ml-auto">
            <RefreshCw className="w-3 h-3 mr-1" /> Refresh state
          </Button>
        </div>
        {lastResult && (
          <pre className="mt-3 p-3 rounded bg-background/40 border border-white/5 text-[11px] font-mono whitespace-pre-wrap max-h-64 overflow-auto">
            {lastResult}
          </pre>
        )}
      </GlassCard>

      {/* Credential store snapshot — source of truth, before materialize */}
      <GlassCard className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            OS credential store
            {storeSummary.backend && (
              <Badge variant="outline" className="text-[9px] py-0 px-1.5 ml-1">
                {storeSummary.backend.label}
              </Badge>
            )}
          </h2>
          <span className="text-[11px] text-muted-foreground">
            What's actually saved (before materialize)
          </span>
        </div>
        {storeSummary.error ? (
          <p className="text-xs text-destructive">{storeSummary.error}</p>
        ) : storeSummary.entries.length === 0 ? (
          <p className="text-xs text-destructive">
            ⚠ No keys in the credential store. Add them in the Secrets tab. If keys disappear after re-adding,
            the OS backend ({storeSummary.backend?.backend ?? "unknown"}) isn't persisting them — check Logs for errors.
          </p>
        ) : (
          <ul className="text-xs font-mono space-y-1">
            {storeSummary.entries.map((e) => (
              <li key={e.key} className="flex items-center gap-2">
                <span className={cn(e.valueLength > 0 ? "text-foreground" : "text-destructive")}>
                  {e.key}
                </span>
                <span className="text-muted-foreground">= ({e.valueLength} chars)</span>
                {e.valueLength === 0 && (
                  <Badge variant="destructive" className="text-[9px] py-0 px-1">empty</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      {/* Env + Config snapshot */}
      <div className="grid md:grid-cols-2 gap-4">
        <GlassCard className="p-4 space-y-2">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            ~/.hermes/.env (key names + lengths only)
          </h2>
          {envSummary.error ? (
            <p className="text-xs text-destructive">{envSummary.error}</p>
          ) : envSummary.entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">No keys present in .env (or file does not exist).</p>
          ) : (
            <ul className="text-xs font-mono space-y-1">
              {envSummary.entries.map((e) => (
                <li key={e.key} className="flex items-center gap-2">
                  <span className={cn(e.valueLength > 0 ? "text-foreground" : "text-destructive")}>
                    {e.key}
                  </span>
                  <span className="text-muted-foreground">= ({e.valueLength} chars)</span>
                  {e.managed && <Badge variant="outline" className="text-[9px] py-0 px-1">secret</Badge>}
                </li>
              ))}
            </ul>
          )}
        </GlassCard>

        <GlassCard className="p-4 space-y-2">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            ~/.hermes/config.yaml
          </h2>
          {cfgSummary.error ? (
            <p className="text-xs text-destructive">{cfgSummary.error}</p>
          ) : cfgSummary.modelLine ? (
            <p className="text-xs font-mono">model: <span className="text-primary">{cfgSummary.modelLine}</span></p>
          ) : (
            <p className="text-xs text-muted-foreground">No model configured.</p>
          )}
          {cfgSummary.raw && (
            <details className="text-[11px] text-muted-foreground">
              <summary className="cursor-pointer">Show full config</summary>
              <pre className="mt-1 p-2 rounded bg-background/40 border border-white/5 font-mono whitespace-pre-wrap">
                {cfgSummary.raw}
              </pre>
            </details>
          )}
        </GlassCard>
      </div>

      {/* Command log */}
      <GlassCard className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            Shell command log <span className="text-muted-foreground font-normal">({entries.length} entries, newest first)</span>
          </h2>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={copyAll}><Copy className="w-3 h-3 mr-1" /> Copy</Button>
            <Button size="sm" variant="ghost" onClick={downloadAll}><Download className="w-3 h-3 mr-1" /> Download</Button>
            <Button size="sm" variant="ghost" onClick={() => diagnostics.clear()}><Trash2 className="w-3 h-3 mr-1" /> Clear</Button>
          </div>
        </div>

        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">
            No commands recorded yet. Trigger a sync, doctor, or chat to populate the log.
          </p>
        ) : (
          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
            {entries.map((e) => {
              const isOpen = expanded.has(e.id);
              return (
                <motion.div
                  key={e.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="border border-white/5 rounded-lg overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => toggle(e.id)}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 text-left"
                  >
                    {e.success
                      ? <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                      : <XCircle className="w-4 h-4 text-destructive shrink-0" />}
                    <span className="text-[10px] font-mono text-muted-foreground w-16 shrink-0">
                      {new Date(e.timestamp).toLocaleTimeString()}
                    </span>
                    <Badge variant="outline" className="text-[9px] py-0 px-1">{e.label}</Badge>
                    <span className="text-xs font-mono truncate flex-1 text-muted-foreground">
                      {e.command}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0 flex items-center gap-1">
                      <Clock className="w-3 h-3" />{e.durationMs}ms · exit={e.exitCode ?? "—"}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="px-3 pb-3 space-y-2 text-[11px] font-mono">
                      <div>
                        <p className="text-muted-foreground mb-1">Command</p>
                        <pre className="p-2 rounded bg-background/40 border border-white/5 whitespace-pre-wrap break-all">{e.command}</pre>
                      </div>
                      {e.stdout && (
                        <div>
                          <p className="text-muted-foreground mb-1">stdout</p>
                          <pre className="p-2 rounded bg-background/40 border border-white/5 whitespace-pre-wrap max-h-64 overflow-auto">{e.stdout}</pre>
                        </div>
                      )}
                      {e.stderr && (
                        <div>
                          <p className="text-destructive/80 mb-1">stderr</p>
                          <pre className="p-2 rounded bg-background/40 border border-destructive/20 whitespace-pre-wrap max-h-64 overflow-auto">{e.stderr}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </GlassCard>
    </div>
  );
};

export default Diagnostics;
