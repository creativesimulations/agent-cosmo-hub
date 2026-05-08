/**
 * useDoctorReport — single source of state and actions for the Diagnostics page.
 *
 * Owns: env / config / credential-store / permissions / browser snapshots,
 * startup-issue list, last-result text, and all the action handlers that
 * the Diagnostics cards trigger (sync secrets, run doctor, ping chat,
 * repair browser config, self-test, fix startup issues, refresh).
 *
 * Cards are pure presentation and read everything from the object this
 * hook returns.
 */
import { useEffect, useState } from "react";
import { systemAPI, secretsStore, type BackendInfo } from "@/lib/systemAPI";
import { toast } from "@/hooks/use-toast";
import { useSudoPrompt } from "@/contexts/SudoPromptContext";

export interface EnvSummary {
  loaded: boolean;
  entries: Array<{ key: string; valueLength: number; managed: boolean }>;
  raw?: string;
  error?: string;
}

export interface ConfigSummary {
  loaded: boolean;
  modelLine?: string;
  raw?: string;
  error?: string;
}

export interface StoreSummary {
  loaded: boolean;
  backend?: BackendInfo;
  entries: Array<{ key: string; valueLength: number }>;
  error?: string;
}

export interface StartupIssue {
  id: string;
  severity: "info" | "warn" | "error";
  title: string;
  detail: string;
  fixable: boolean;
}

export type BrowserDiagnostics = Awaited<ReturnType<typeof systemAPI.getBrowserDiagnostics>>;
export type BrowserSelfTest = Awaited<ReturnType<typeof systemAPI.runBrowserSelfTest>>;

export const useDoctorReport = () => {
  const { requestSudoPassword } = useSudoPrompt();

  const [envSummary, setEnvSummary] = useState<EnvSummary>({ loaded: false, entries: [] });
  const [cfgSummary, setCfgSummary] = useState<ConfigSummary>({ loaded: false });
  const [storeSummary, setStoreSummary] = useState<StoreSummary>({ loaded: false, entries: [] });
  const [permsBlock, setPermsBlock] = useState<string | null>(null);
  const [browserDiag, setBrowserDiag] = useState<BrowserDiagnostics | null>(null);
  const [startupIssues, setStartupIssues] = useState<StartupIssue[]>([]);
  const [selfTest, setSelfTest] = useState<BrowserSelfTest | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [running, setRunning] = useState<"doctor" | "ping" | null>(null);
  const [browserBusy, setBrowserBusy] = useState(false);
  const [selfTestBusy, setSelfTestBusy] = useState(false);
  const [syncingPerms, setSyncingPerms] = useState(false);
  const [fixingStartup, setFixingStartup] = useState(false);
  const [lastResult, setLastResult] = useState<string>("");

  const refreshSummaries = async () => {
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
    try {
      const doctor = await systemAPI.analyzeDoctorIssues();
      setStartupIssues(doctor.issues || []);
    } catch {
      setStartupIssues([]);
    }
  };

  useEffect(() => {
    refreshSummaries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const parsed = await systemAPI.analyzeDoctorIssues([r.stdout, r.stderr].filter(Boolean).join("\n"));
      setStartupIssues(parsed.issues || []);
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

  const handleSyncPerms = async () => {
    setSyncingPerms(true);
    try {
      await refreshSummaries();
      toast({ title: "Refreshed", description: "Re-read managed permissions block from ~/.hermes/config.yaml" });
    } finally {
      setSyncingPerms(false);
    }
  };

  const handleFixStartupIssues = async () => {
    setFixingStartup(true);
    try {
      const pw = await requestSudoPassword("fix startup reliability issues for Hermes");
      if (pw === null) {
        toast({ title: "Startup fix cancelled" });
        return;
      }
      const result = await systemAPI.runStartupAutoFix({ sudoPassword: pw });
      const detail = result.actions.length > 0 ? result.actions.join("\n") : "No automatic actions were needed.";
      setLastResult(`Startup auto-fix:\n${detail}`);
      setStartupIssues(result.issues || []);
      if (result.success) {
        toast({ title: "Startup issues fixed", description: "Core startup checks now look healthy." });
      } else {
        toast({ title: "Startup issues remain", description: result.error || "Review details below.", variant: "destructive" });
      }
      await refreshSummaries();
    } finally {
      setFixingStartup(false);
    }
  };

  // Derived: actionable issues list
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

  return {
    // state
    envSummary,
    cfgSummary,
    storeSummary,
    permsBlock,
    browserDiag,
    startupIssues,
    selfTest,
    actionableIssues,
    // busy flags
    syncing,
    running,
    browserBusy,
    selfTestBusy,
    syncingPerms,
    fixingStartup,
    lastResult,
    // actions
    refreshSummaries,
    handleSyncSecrets,
    handleDoctor,
    handlePing,
    handleRepairBrowser,
    handleBrowserSelfTest,
    handleSyncPerms,
    handleFixStartupIssues,
  };
};

export type DoctorReport = ReturnType<typeof useDoctorReport>;
