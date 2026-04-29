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
  Globe,
  Wrench,
  Search,
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
import ActionableError from "@/components/ui/ActionableError";

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
  const [browserDiag, setBrowserDiag] = useState<Awaited<ReturnType<typeof systemAPI.getBrowserDiagnostics>> | null>(null);
  const [browserBusy, setBrowserBusy] = useState(false);
  const [selfTest, setSelfTest] = useState<Awaited<ReturnType<typeof systemAPI.runBrowserSelfTest>> | null>(null);
  const [selfTestBusy, setSelfTestBusy] = useState(false);
  const [showAllCommands, setShowAllCommands] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandScope, setCommandScope] = useState<"all" | "gateway" | "whatsapp" | "hermes" | "system">("all");

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
    try {
      const diag = await systemAPI.getBrowserDiagnostics();
      setBrowserDiag(diag);
    } catch {
      setBrowserDiag(null);
    }
  };

  const handleRepairBrowser = async () => {
    setBrowserBusy(true);
    try {
      const r = await systemAPI.repairConfig();
      await refreshSummaries();
      if (r.success) {
        toast({
          title: "Config repaired",
          description: "Rewrote toolsets to hermes-cli, stripped legacy keys, fixed binary permissions, and re-ran doctor.",
        });
        setLastResult(`✅ Repair OK\n\nhermes doctor:\n${r.doctorOutput}`);
      } else {
        toast({ title: "Repair failed", description: r.error || "See output below", variant: "destructive" });
        setLastResult(`❌ Repair failed: ${r.error || "unknown"}\n\n${r.doctorOutput}`);
      }
    } catch (e) {
      toast({ title: "Repair failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBrowserBusy(false);
    }
  };

  const handleBrowserSelfTest = async () => {
    setSelfTestBusy(true);
    try {
      const r = await systemAPI.runBrowserSelfTest();
      setSelfTest(r);
      toast({
        title: "Browser self-test complete",
        description: r.navigateOk
          ? "Real browser navigation works."
          : r.cdpUrl
          ? "CDP wired but navigation didn't complete — see panel."
          : "No CDP backend configured.",
      });
    } catch (e) {
      toast({ title: "Self-test failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSelfTestBusy(false);
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

  const copyLatestFailureBundle = async () => {
    const firstFail = entries.find((e) => !e.success);
    if (!firstFail) {
      toast({ title: "No failures", description: "There are no failing command entries to copy." });
      return;
    }
    const payload = [
      `label=${firstFail.label}`,
      `time=${new Date(firstFail.timestamp).toISOString()}`,
      `cwd=${firstFail.cwd || "(unknown)"}`,
      `phase=${firstFail.phase}`,
      `exit=${firstFail.exitCode ?? "—"}`,
      `status=${firstFail.status}`,
      "",
      "$ " + firstFail.command,
      firstFail.stdout ? `\n--- stdout ---\n${firstFail.stdout}` : "",
      firstFail.stderr ? `\n--- stderr ---\n${firstFail.stderr}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    await navigator.clipboard.writeText(payload);
    toast({ title: "Copied latest failure bundle", description: "Redacted command details copied." });
  };

  const downloadFiltered = () => {
    const body = visibleEntries.map((e) =>
      [
        `time=${new Date(e.timestamp).toISOString()} label=${e.label} phase=${e.phase} status=${e.status} exit=${e.exitCode ?? "—"} duration=${e.durationMs}ms`,
        `cwd=${e.cwd || "(unknown)"}`,
        `$ ${e.command}`,
        e.stdout ? `--- stdout ---\n${e.stdout.trimEnd()}` : "",
        e.stderr ? `--- stderr ---\n${e.stderr.trimEnd()}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    ).join("\n\n");
    const blob = new Blob([body], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ronbot-app-diagnostics-filtered-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
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

  const actionableIssues: string[] = [];
  if (storeSummary.loaded && !storeSummary.error && storeSummary.entries.length === 0) {
    actionableIssues.push("No secrets are saved in your OS credential store. Add required keys in Secrets.");
  }
  if (envSummary.loaded && !envSummary.error && envSummary.entries.length === 0) {
    actionableIssues.push("`~/.hermes/.env` has no keys yet. Run “Sync secrets now”.");
  }
  if (cfgSummary.loaded && !cfgSummary.error && !cfgSummary.modelLine) {
    actionableIssues.push("No model is configured in `~/.hermes/config.yaml`.");
  }
  if (permsBlock === null) {
    actionableIssues.push("Permissions block has not been synced to config yet.");
  }
  if (browserDiag) {
    if (!browserDiag.cdpUrl) actionableIssues.push("Browser CDP URL is missing.");
    if (browserDiag.cdpUrl && !browserDiag.cdpReachable) actionableIssues.push("Browser CDP is configured but not reachable.");
    if (!browserDiag.browserEnabledInConfig) actionableIssues.push("Managed browser config block is missing.");
    if (!browserDiag.hermesWebToolsetLoaded) actionableIssues.push("Hermes browser/web toolset is not loaded.");
    if (browserDiag.internetPermission !== "allow") actionableIssues.push("Internet permission is not set to allow.");
  }

  const visibleEntries = (showAllCommands ? entries : entries.filter((e) => !e.success)).filter((e) => {
    const scopeMatch =
      commandScope === "all" ||
      (commandScope === "gateway" && /gateway/i.test(e.command)) ||
      (commandScope === "whatsapp" && /whatsapp|baileys/i.test(e.command + e.stdout + e.stderr)) ||
      (commandScope === "hermes" && /hermes/i.test(e.command)) ||
      (commandScope === "system" && !/hermes|gateway|whatsapp|baileys/i.test(e.command));
    if (!scopeMatch) return false;
    const q = commandQuery.trim().toLowerCase();
    if (!q) return true;
    return [e.command, e.stdout, e.stderr, e.cwd || "", e.label].join("\n").toLowerCase().includes(q);
  });

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Activity className="w-6 h-6 text-primary" />
          App Diagnostics
        </h1>
        <p className="text-sm text-muted-foreground">
          View current state and fixable errors first. Technical command logs are available below when needed.{" "}
          <a href="#/logs" className="text-primary hover:underline">
            Looking for chat history or agent activity? See Agent Logs →
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

      <GlassCard className="p-4 space-y-3">
        <h2 className="text-sm font-semibold">Current status</h2>
        <ul className="space-y-2 text-xs">
          <li className="flex items-center gap-2">
            <span className={cn("w-2 h-2 rounded-full", storeSummary.error ? "bg-destructive" : "bg-success")} />
            Secrets store: {storeSummary.error ? "error" : `${storeSummary.entries.length} key(s) saved`}
          </li>
          <li className="flex items-center gap-2">
            <span className={cn("w-2 h-2 rounded-full", envSummary.error ? "bg-destructive" : "bg-success")} />
            Env sync: {envSummary.error ? "error reading .env" : `${envSummary.entries.length} key(s) in ~/.hermes/.env`}
          </li>
          <li className="flex items-center gap-2">
            <span className={cn("w-2 h-2 rounded-full", cfgSummary.error || !cfgSummary.modelLine ? "bg-warning" : "bg-success")} />
            Model config: {cfgSummary.modelLine ? cfgSummary.modelLine : "not configured"}
          </li>
          <li className="flex items-center gap-2">
            <span className={cn("w-2 h-2 rounded-full", permsBlock ? "bg-success" : "bg-warning")} />
            Permissions block: {permsBlock ? "present" : "not synced yet"}
          </li>
          <li className="flex items-center gap-2">
            <span
              className={cn(
                "w-2 h-2 rounded-full",
                browserDiag && browserDiag.cdpReachable && browserDiag.browserEnabledInConfig && browserDiag.hermesWebToolsetLoaded
                  ? "bg-success"
                  : "bg-warning",
              )}
            />
            Browser chain: {browserDiag ? (browserDiag.cdpReachable ? "ready" : "needs attention") : "checking"}
          </li>
        </ul>
      </GlassCard>

      <GlassCard className="p-4 space-y-3">
        <h2 className="text-sm font-semibold">Actionable issues</h2>
        {actionableIssues.length === 0 ? (
          <p className="text-xs text-muted-foreground">No obvious configuration issues detected.</p>
        ) : (
          <ul className="space-y-2">
            {actionableIssues.map((issue) => (
              <li key={issue} className="text-xs text-foreground rounded-md border border-border/60 bg-background/30 px-3 py-2">
                {issue}
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      <details className="rounded-lg border border-border/60 bg-background/20 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">Advanced diagnostics (for support)</summary>
        <div className="mt-3 space-y-4">
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
          <ActionableError
            title="Could not read credential store"
            summary={storeSummary.error}
            details={storeSummary.error}
            onFix={refreshSummaries}
            fixLabel="Refresh diagnostics"
          />
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
            <ActionableError
              title="Could not read ~/.hermes/.env"
              summary={envSummary.error}
              details={envSummary.error}
              onFix={refreshSummaries}
              fixLabel="Refresh diagnostics"
            />
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
            <ActionableError
              title="Could not read ~/.hermes/config.yaml"
              summary={cfgSummary.error}
              details={cfgSummary.error}
              onFix={refreshSummaries}
              fixLabel="Refresh diagnostics"
            />
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

      {/* Permissions block sent to the agent */}
      <GlassCard className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            Permissions sent to agent
            <span className="text-[11px] font-normal text-muted-foreground">
              (managed block in ~/.hermes/config.yaml)
            </span>
          </h2>
          <Button onClick={handleSyncPerms} disabled={syncingPerms} variant="ghost" size="sm">
            <RefreshCw className={cn("w-3 h-3 mr-1", syncingPerms && "animate-spin")} />
            Re-read block
          </Button>
        </div>
        {permsBlock ? (
          <pre className="p-2 rounded bg-background/40 border border-white/5 text-[11px] font-mono whitespace-pre-wrap max-h-72 overflow-auto">
            {permsBlock}
          </pre>
        ) : (
          <p className="text-xs text-muted-foreground">
            No managed permissions block found. It's written automatically on the first chat message,
            or you can sync it manually from Settings → Permissions.
          </p>
        )}
      </GlassCard>

      {/* Browser toolset chain — exists to debug "browser permission error" replies. */}
      <GlassCard className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Globe className="w-4 h-4 text-primary" />
            Browser toolset chain
            <span className="text-[11px] font-normal text-muted-foreground">
              (CDP → config.yaml → toolset → permission)
            </span>
          </h2>
          <Button
            onClick={handleRepairBrowser}
            disabled={browserBusy}
            variant="ghost"
            size="sm"
          >
            <Wrench className={cn("w-3 h-3 mr-1", browserBusy && "animate-pulse")} />
            Repair config
          </Button>
        </div>

        {!browserDiag ? (
          <p className="text-xs text-muted-foreground">Loading browser diagnostics…</p>
        ) : (
          <ul className="text-xs space-y-1.5">
            <li className="flex items-center gap-2">
              {browserDiag.cdpUrl
                ? <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                : <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
              <span className="font-mono">cdp_url:</span>
              <span className={cn("font-mono", browserDiag.cdpUrl ? "text-foreground" : "text-destructive")}>
                {browserDiag.cdpUrl ?? "not set — agent has no browser to drive"}
              </span>
            </li>
            {browserDiag.cdpUrl && (
              <li className="flex items-center gap-2">
                {browserDiag.cdpReachable
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                  : <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
                <span className="font-mono">CDP reachable:</span>
                <span className={cn(browserDiag.cdpReachable ? "text-foreground" : "text-destructive")}>
                  {browserDiag.cdpReachable
                    ? `yes${browserDiag.cdpVersion ? ` (${browserDiag.cdpVersion})` : ""}`
                    : "no — start Chrome from Skills → Browser, or open it on port 9222"}
                </span>
              </li>
            )}
            <li className="flex items-center gap-2">
              {browserDiag.browserEnabledInConfig
                ? <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                : <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
              <span className="font-mono">managed browser block present:</span>
              <span className={cn(browserDiag.browserEnabledInConfig ? "text-foreground" : "text-destructive")}>
                {browserDiag.browserEnabledInConfig ? "yes" : "missing — click Repair"}
              </span>
            </li>
            <li className="flex items-center gap-2">
              {browserDiag.hermesWebToolsetLoaded
                ? <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                : <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
              <span className="font-mono">hermes-cli toolset loaded:</span>
              <span className={cn(browserDiag.hermesWebToolsetLoaded ? "text-foreground" : "text-destructive")}>
                {browserDiag.hermesWebToolsetLoaded
                  ? "yes (web, browser_*, terminal, file, vision, image_gen, tts… all registered)"
                  : "no — agent has no tools loaded; click Repair config"}
              </span>
            </li>
            <li className="flex items-center gap-2">
              {browserDiag.internetPermission === "allow"
                ? <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                : <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
              <span className="font-mono">internet permission:</span>
              <span className={cn(
                browserDiag.internetPermission === "allow" ? "text-foreground" : "text-destructive",
              )}>
                {browserDiag.internetPermission ?? "not synced"}
                {browserDiag.internetPermission && browserDiag.internetPermission !== "allow" &&
                  " — set to 'allow' in Settings → Permissions and re-sync"}
              </span>
            </li>
          </ul>
        )}

        {browserDiag?.rawBrowserBlock && (
          <details className="text-[11px] text-muted-foreground">
            <summary className="cursor-pointer">Show raw browser block</summary>
            <pre className="mt-1 p-2 rounded bg-background/40 border border-white/5 font-mono whitespace-pre-wrap">
              {browserDiag.rawBrowserBlock}
              {browserDiag.rawToolsetsBlock ? "\n\n" + browserDiag.rawToolsetsBlock : ""}
            </pre>
          </details>
        )}

        <div className="pt-2 border-t border-white/5 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs font-semibold text-foreground">End-to-end browser self-test</p>
            <Button
              onClick={handleBrowserSelfTest}
              disabled={selfTestBusy}
              variant="outline"
              size="sm"
            >
              <Activity className={cn("w-3 h-3 mr-1", selfTestBusy && "animate-pulse")} />
              {selfTestBusy ? "Testing…" : "Run self-test"}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Opens a real CDP tab, navigates to example.com, and reports what the agent will actually
            be able to do.
          </p>
          {selfTest && (
            <ul className="text-xs space-y-1.5 mt-2">
              <li className="flex items-center gap-2">
                {selfTest.hermesCliToolsetLoaded
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                  : <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
                <span>Browser tool registered (hermes-cli toolset)</span>
              </li>
              {selfTest.cdpUrl && (
                <li className="flex items-center gap-2">
                  {selfTest.cdpReachable
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                    : <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
                  <span>CDP reachable {selfTest.cdpVersion ? `(${selfTest.cdpVersion})` : ""}</span>
                </li>
              )}
              {selfTest.navigateOk !== null && (
                <li className="flex items-center gap-2">
                  {selfTest.navigateOk
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                    : <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
                  <span>
                    Real navigation: {selfTest.navigateOk
                      ? `landed on ${selfTest.navigateFinalUrl ?? "example.com"}`
                      : (selfTest.navigateError ?? "failed")}
                  </span>
                </li>
              )}
              <li className="flex items-center gap-2">
                {selfTest.webSearchBackend
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                  : <XCircle className="w-3.5 h-3.5 text-warning shrink-0" />}
                <span>
                  Web-search backend: {selfTest.webSearchBackend
                    ? selfTest.webSearchBackend.toUpperCase()
                    : "none — Ron can read URLs but can't discover new ones"}
                </span>
              </li>
              {selfTest.doctorReportsBrowser !== null && (
                <li className="flex items-center gap-2">
                  {selfTest.doctorReportsBrowser
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                    : <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
                  <span>hermes doctor reports browser tool</span>
                </li>
              )}
            </ul>
          )}
        </div>
      </GlassCard>

      <GlassCard className="p-4 space-y-3">
        <h2 className="text-sm font-semibold">Debug toggles</h2>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-foreground">Log every prompt-detection event</p>
            <p className="text-[11px] text-muted-foreground">
              When ON, every approval-prompt match is recorded in the agent log. Use this to confirm
              the parser is firing on real prompts.
            </p>
          </div>
          <Switch checked={debugPrompts} onCheckedChange={toggleDebugPrompts} />
        </div>
      </GlassCard>

      {/* Command log */}
      <GlassCard className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            Runtime command telemetry <span className="text-muted-foreground font-normal">({visibleEntries.length} shown / {entries.length} total)</span>
          </h2>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowAllCommands((v) => !v)}
            >
              {showAllCommands ? "Hide successful" : "Show all"}
            </Button>
            <Button size="sm" variant="ghost" onClick={copyLatestFailureBundle}>Copy latest failure</Button>
            <Button size="sm" variant="ghost" onClick={downloadFiltered}>Download filtered</Button>
            <Button size="sm" variant="ghost" onClick={copyAll}><Copy className="w-3 h-3 mr-1" /> Copy</Button>
            <Button size="sm" variant="ghost" onClick={downloadAll}><Download className="w-3 h-3 mr-1" /> Download</Button>
            <Button size="sm" variant="ghost" onClick={() => diagnostics.clear()}><Trash2 className="w-3 h-3 mr-1" /> Clear</Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[280px] flex-1">
            <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={commandQuery}
              onChange={(e) => setCommandQuery(e.target.value)}
              placeholder="Search command, output, cwd..."
              className="w-full h-8 pl-8 pr-2 rounded-md border border-border/60 bg-background/50 text-xs"
            />
          </div>
          {(["all", "gateway", "whatsapp", "hermes", "system"] as const).map((scope) => (
            <Button
              key={scope}
              size="sm"
              variant={commandScope === scope ? "default" : "ghost"}
              onClick={() => setCommandScope(scope)}
            >
              {scope}
            </Button>
          ))}
        </div>

        {visibleEntries.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">
            {entries.length === 0
              ? "No commands recorded yet. Trigger a sync, doctor, or chat to populate the log."
              : "No failing commands in the current log."}
          </p>
        ) : (
          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
            {visibleEntries.map((e) => {
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
                      <Clock className="w-3 h-3" />{e.durationMs}ms · {e.phase} · exit={e.exitCode ?? "—"}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="px-3 pb-3 space-y-2 text-[11px] font-mono">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div className="p-2 rounded bg-background/40 border border-white/5">
                          <p className="text-muted-foreground mb-1">cwd</p>
                          <p className="break-all">{e.cwd || "(unknown)"}</p>
                        </div>
                        <div className="p-2 rounded bg-background/40 border border-white/5">
                          <p className="text-muted-foreground mb-1">status</p>
                          <p>{e.status}{e.redacted ? " · redacted" : ""}</p>
                        </div>
                      </div>
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
      <RecommendedPackages />
        </div>
      </details>
    </div>
  );
};

export default Diagnostics;

// ─── Recommended packages panel ───────────────────────────────────────────
// Non-blocking checks for ripgrep/ffmpeg/curl with one-click install. Lets
// users add tools they skipped during the install wizard without re-running it.
type PkgState = {
  id: string;
  label: string;
  hint: string;
  installed: boolean | null;
  version?: string;
  installing: boolean;
  message?: string;
};

const RecommendedPackages = () => {
  const [pkgs, setPkgs] = useState<PkgState[]>([
    { id: "ripgrep", label: "ripgrep (rg)", hint: "Fast in-repo search used by the agent's file tools.", installed: null, installing: false },
    { id: "ffmpeg",  label: "ffmpeg",       hint: "Audio/video processing for vision and TTS skills.",   installed: null, installing: false },
    { id: "curl",    label: "curl",         hint: "Used to download updates and run web-fetch tools.",   installed: null, installing: false },
  ]);

  useEffect(() => {
    void scanAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (id: string, patch: Partial<PkgState>) =>
    setPkgs((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const scanAll = async () => {
    const [rg, ff, c] = await Promise.all([
      systemAPI.checkRipgrep().catch(() => ({ installed: false })),
      systemAPI.checkFfmpeg().catch(() => ({ found: false })),
      systemAPI.checkCurl().catch(() => ({ installed: false })),
    ]);
    update("ripgrep", { installed: !!rg.installed, version: (rg as { version?: string }).version });
    update("ffmpeg",  { installed: !!(ff as { found?: boolean }).found, version: (ff as { version?: string }).version });
    update("curl",    { installed: !!c.installed,  version: (c as { version?: string }).version });
  };

  const install = async (id: string) => {
    update(id, { installing: true, message: undefined });
    try {
      const r =
        id === "ripgrep" ? await systemAPI.installRipgrep() :
        id === "ffmpeg"  ? await systemAPI.installFfmpeg() :
                            await systemAPI.installCurl();
      if (r?.success) {
        update(id, { installing: false, installed: true, message: "Installed" });
        await scanAll();
      } else {
        update(id, { installing: false, message: (r?.stderr || "Install failed").trim().slice(0, 240) });
      }
    } catch (e) {
      update(id, { installing: false, message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <GlassCard className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Wrench className="w-4 h-4 text-primary" />
          Recommended packages
        </h2>
        <Button onClick={scanAll} variant="ghost" size="sm">
          <RefreshCw className="w-3 h-3 mr-1" /> Re-scan
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Optional tools that improve the agent's capabilities. Install anytime — none of these block the agent from running.
      </p>
      <div className="space-y-2">
        {pkgs.map((p) => (
          <div key={p.id} className="rounded-lg border border-white/5 bg-background/40 p-3 flex items-start gap-3">
            <div className="mt-0.5">
              {p.installed === null ? (
                <Clock className="w-4 h-4 text-muted-foreground" />
              ) : p.installed ? (
                <CheckCircle2 className="w-4 h-4 text-success" />
              ) : (
                <XCircle className="w-4 h-4 text-warning" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-foreground">{p.label}</span>
                {p.version && <span className="text-[10px] font-mono text-accent">{p.version}</span>}
              </div>
              <p className="text-[11px] text-muted-foreground">{p.hint}</p>
              {p.message && (
                <p className="text-[11px] text-warning mt-1 font-mono whitespace-pre-wrap break-words">{p.message}</p>
              )}
            </div>
            {p.installed === false && (
              <Button size="sm" variant="ghost" disabled={p.installing} onClick={() => install(p.id)} className="shrink-0">
                {p.installing ? (
                  <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                ) : (
                  <Download className="w-3 h-3 mr-1" />
                )}
                {p.installing ? "Installing…" : "Install"}
              </Button>
            )}
          </div>
        ))}
      </div>
    </GlassCard>
  );
};

