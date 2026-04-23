import { useEffect, useMemo, useRef, useState } from "react";
import {
  Cloud,
  Server,
  Globe,
  MousePointerClick,
  Flame,
  Lock,
  ExternalLink,
  KeyRound,
  Loader2,
  ArrowLeft,
  Sparkles,
  Play,
  Square,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Circle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { systemAPI, secretsStore, browserSetup } from "@/lib/systemAPI";
import {
  BROWSER_BACKENDS,
  BrowserBackend,
  BrowserBackendId,
  getBrowserBackend,
} from "@/lib/browserBackends";
import { isUpgradeUnlocked, getUpgrade } from "@/lib/licenses";
import EnterLicenseKeyDialog from "@/components/upgrades/EnterLicenseKeyDialog";
import { invalidateCapabilityProbeCache } from "@/lib/capabilityProbe";
import { useSettings } from "@/contexts/SettingsContext";
import { useSudoPrompt } from "@/contexts/SudoPromptContext";

interface BrowserSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful save so the parent can re-probe / re-render. */
  onConfigured?: () => void;
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Cloud,
  Server,
  Chrome: Globe,
  MousePointerClick,
  Flame,
};

const openExternal = (url: string) => {
  window.open(url, "_blank", "noopener,noreferrer");
};

const MAX_LOG_LINES = 200;

/** Streaming log panel — auto-scrolls, capped at MAX_LOG_LINES. */
const LogPanel = ({ lines }: { lines: string[] }) => {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);
  if (lines.length === 0) return null;
  return (
    <pre
      ref={ref}
      className="text-[11px] font-mono whitespace-pre-wrap break-all bg-background/40 border border-white/10 rounded-md p-3 max-h-48 overflow-y-auto text-foreground/90"
    >
      {lines.join("\n")}
    </pre>
  );
};

type StatusKind = "idle" | "ok" | "warn" | "err" | "busy";
const StatusRow = ({
  label,
  status,
  detail,
}: {
  label: string;
  status: StatusKind;
  detail?: string;
}) => {
  const Icon =
    status === "ok"
      ? CheckCircle2
      : status === "err"
      ? XCircle
      : status === "busy"
      ? Loader2
      : Circle;
  const color =
    status === "ok"
      ? "text-success"
      : status === "err"
      ? "text-destructive"
      : status === "warn"
      ? "text-warning"
      : status === "busy"
      ? "text-primary"
      : "text-muted-foreground";
  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon className={cn("w-3.5 h-3.5 shrink-0", color, status === "busy" && "animate-spin")} />
      <span className="font-medium text-foreground">{label}</span>
      {detail && <span className="text-muted-foreground">— {detail}</span>}
    </div>
  );
};

const BrowserSetupDialog = ({ open, onOpenChange, onConfigured }: BrowserSetupDialogProps) => {
  const { update, settings } = useSettings();
  const { requestSudoPassword } = useSudoPrompt();
  const [step, setStep] = useState<"pick" | "configure">("pick");
  const [picked, setPicked] = useState<BrowserBackendId | null>(null);
  const [unlocks, setUnlocks] = useState<Record<string, boolean>>({});
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state — keyed by backend.
  const [bbApiKey, setBbApiKey] = useState("");
  const [bbProjectId, setBbProjectId] = useState("");
  const [camofoxUrl, setCamofoxUrl] = useState("http://localhost:9377");
  const [camofoxPersist, setCamofoxPersist] = useState(false);
  const [browserUseKey, setBrowserUseKey] = useState("");
  const [firecrawlKey, setFirecrawlKey] = useState("");

  // ─── Camofox automation state ──────────────────────────────────
  const [camofoxLog, setCamofoxLog] = useState<string[]>([]);
  const [camofoxBusy, setCamofoxBusy] = useState(false);
  const [nodeStatus, setNodeStatus] = useState<StatusKind>("idle");
  const [nodeDetail, setNodeDetail] = useState<string | undefined>();
  const [serverStatus, setServerStatus] = useState<StatusKind>("idle");
  const [healthStatus, setHealthStatus] = useState<StatusKind>("idle");

  // ─── Local Chrome automation state ─────────────────────────────
  const [chromeLog, setChromeLog] = useState<string[]>([]);
  const [chromeBusy, setChromeBusy] = useState(false);
  const [chromeStatus, setChromeStatus] = useState<StatusKind>("idle");
  const [chromeDetail, setChromeDetail] = useState<string | undefined>();
  const [cdpStatus, setCdpStatus] = useState<StatusKind>("idle");
  const [chromeRunning, setChromeRunning] = useState(false);

  const appendLog = (setter: React.Dispatch<React.SetStateAction<string[]>>) =>
    (line: string) =>
      setter((prev) => {
        const next = [...prev, ...line.split("\n").map((l) => l.replace(/\r$/, "")).filter(Boolean)];
        return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
      });

  const refreshUnlocks = async () => {
    const next: Record<string, boolean> = {};
    for (const b of BROWSER_BACKENDS) {
      if (b.tier === "paid" && b.upgradeId) {
        next[b.upgradeId] = await isUpgradeUnlocked(b.upgradeId);
      }
    }
    setUnlocks(next);
  };

  useEffect(() => {
    if (!open) return;
    setStep("pick");
    setPicked(null);
    setCamofoxLog([]);
    setChromeLog([]);
    setNodeStatus("idle");
    setServerStatus("idle");
    setHealthStatus("idle");
    setChromeStatus("idle");
    setCdpStatus("idle");
    void refreshUnlocks();
  }, [open]);

  const backend: BrowserBackend | null = picked ? getBrowserBackend(picked) ?? null : null;
  const isLocked = (b: BrowserBackend | null): boolean =>
    !!(b && b.tier === "paid" && b.upgradeId && !unlocks[b.upgradeId]);

  const handlePick = (id: BrowserBackendId) => {
    setPicked(id);
    setStep("configure");
  };

  /**
   * After ANY backend is configured, the agent also needs a browser-class
   * skill enabled, otherwise it has no tool to drive the backend with —
   * which is exactly the "browser permission error" the agent reports.
   * Tries the canonical names in order; first hit wins.
   */
  const ensureBrowserSkillEnabled = async (
    log: (line: string) => void,
  ): Promise<boolean> => {
    try {
      const res = await systemAPI.listSkills();
      if (!res.success) {
        log("⚠ Couldn't list installed skills — skipped auto-enable.");
        return false;
      }
      const cfg = await systemAPI.getSkillsConfig();
      const disabled = new Set((cfg.disabled || []).map((s) => s.toLowerCase()));
      const candidates = ["browser", "web_browser", "browser_use", "playwright"];
      const installed = res.skills.map((s) => s.name);
      const installedLower = installed.map((s) => s.toLowerCase());
      const matchIdx = installedLower.findIndex((s) => candidates.includes(s));
      if (matchIdx === -1) {
        log(`✗ Ron has no browser skill installed. Looked for: ${candidates.join(", ")}.`);
        log("  Open Skills & Tools, add a browser skill, then re-run setup.");
        toast.error("Ron has no browser skill installed", {
          description: "Open Skills & Tools to add 'browser' or 'playwright', then re-run setup.",
        });
        return false;
      }
      const realName = installed[matchIdx];
      const lower = installedLower[matchIdx];
      if (!disabled.has(lower)) {
        log(`✓ Browser skill "${realName}" is already enabled.`);
        return true;
      }
      const enable = await systemAPI.setSkillEnabled(realName, true);
      if (enable.success) {
        log(`✓ Enabled browser skill "${realName}".`);
        return true;
      }
      log(`✗ Failed to enable "${realName}": ${enable.error || "unknown error"}`);
      return false;
    } catch (e) {
      log(`⚠ Skill auto-enable failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  };

  const handleSaveSecrets = async (
    entries: Array<[string, string]>,
    successMsg: string,
  ): Promise<boolean> => {
    setSaving(true);
    let allOk = true;
    for (const [k, v] of entries) {
      const ok = await secretsStore.set(k, v);
      if (!ok) {
        toast.error(`Failed to save ${k}`);
        allOk = false;
      }
    }
    setSaving(false);
    if (allOk) {
      toast.success(successMsg, { description: "Restart Ron to take effect." });
      invalidateCapabilityProbeCache();
      onConfigured?.();
      onOpenChange(false);
    }
    return allOk;
  };

  const handleSaveBrowserbase = async () => {
    if (!bbApiKey.trim() || !bbProjectId.trim()) return;
    await handleSaveSecrets(
      [
        ["BROWSERBASE_API_KEY", bbApiKey.trim()],
        ["BROWSERBASE_PROJECT_ID", bbProjectId.trim()],
      ],
      "Browserbase configured",
    );
  };

  const handleSaveBrowserUse = async () => {
    if (!browserUseKey.trim()) return;
    await handleSaveSecrets(
      [["BROWSER_USE_API_KEY", browserUseKey.trim()]],
      "Browser Use configured",
    );
  };

  const handleSaveFirecrawl = async () => {
    if (!firecrawlKey.trim()) return;
    await handleSaveSecrets(
      [["FIRECRAWL_API_KEY", firecrawlKey.trim()]],
      "Firecrawl configured",
    );
  };

  // ─── Camofox automation ───────────────────────────────────────────────────
  // We install Camofox via `git clone + npm install + npm start` (the project's
  // own README install path) so no Docker is required. The previous Docker-pull
  // approach failed because the upstream image isn't published publicly
  // (GHCR returned `denied`).
  const ensureNode = async (logFn: (line: string) => void): Promise<boolean> => {
    setNodeStatus("busy");
    setNodeDetail("checking…");
    const node = await browserSetup.detectNode();
    const gitOk = await browserSetup.detectGit();
    if (!node.installed) {
      setNodeDetail("Node.js missing — installing…");
      logFn("Node.js not found. Installing now…");
      const platform = await systemAPI.getPlatform();
      let pw: string | null = null;
      if (platform.isLinux || platform.isWSL) {
        pw = await requestSudoPassword("install Node.js (needed to run Camofox)");
        if (pw === null) {
          setNodeStatus("err");
          setNodeDetail("install cancelled");
          return false;
        }
      }
      const inst = await browserSetup.installNode((e) => e.data && logFn(e.data), pw);
      if (!inst.success) {
        setNodeStatus("err");
        setNodeDetail("Node install failed — see log");
        return false;
      }
      const recheck = await browserSetup.detectNode();
      if (!recheck.installed) {
        setNodeStatus("warn");
        setNodeDetail("installer launched — finish install, then click Install & start Camofox again");
        return false;
      }
    }
    if (!gitOk) {
      logFn("git not found. Installing now…");
      const platform = await systemAPI.getPlatform();
      let pw: string | null = null;
      if (platform.isLinux || platform.isWSL) {
        pw = await requestSudoPassword("install git (needed to fetch Camofox)");
        if (pw === null) {
          setNodeStatus("err");
          setNodeDetail("install cancelled");
          return false;
        }
      }
      const ginst = await browserSetup.installGit((e) => e.data && logFn(e.data), pw);
      if (!ginst.success) {
        setNodeStatus("err");
        setNodeDetail("git install failed — see log");
        return false;
      }
    }
    const final = await browserSetup.detectNode();
    setNodeStatus("ok");
    setNodeDetail(final.version ? `Node ${final.version}` : "ready");
    return true;
  };

  const handleInstallCamofox = async () => {
    setCamofoxBusy(true);
    setCamofoxLog([]);
    const log = appendLog(setCamofoxLog);
    try {
      const ready = await ensureNode(log);
      if (!ready) {
        toast.error("Couldn't prepare Node.js / git", { description: "See the log for details." });
        return;
      }
      setServerStatus("busy");
      const run = await browserSetup.setupAndStartCamofox((e) => e.data && log(e.data));
      if (!run.success) {
        setServerStatus("err");
        toast.error("Failed to start Camofox", { description: "See the log for details." });
        return;
      }
      setServerStatus("ok");
      setHealthStatus("busy");
      // First-run npm install + Camoufox download can take several minutes.
      const healthy = await browserSetup.pollCamofox(240000, (e) => e.data && log(e.data));
      setHealthStatus(healthy ? "ok" : "warn");
      // Save URL secret + persistence config regardless of health (URL is correct).
      await secretsStore.set("CAMOFOX_URL", camofoxUrl.trim() || "http://localhost:9377");
      await systemAPI.setBrowserCamofoxPersistence(camofoxPersist).catch(() => undefined);
      await ensureBrowserSkillEnabled(log);
      invalidateCapabilityProbeCache();
      if (healthy) {
        toast.success("Camofox is running", { description: "Send Ron a new message — config is reloaded each turn." });
        onConfigured?.();
      } else {
        toast.warning("Camofox started but health check timed out", {
          description: "First-run downloads (~300MB) can take a while — try the health check again in a minute.",
        });
      }
    } finally {
      setCamofoxBusy(false);
    }
  };

  const handleStopCamofox = async () => {
    setCamofoxBusy(true);
    const log = appendLog(setCamofoxLog);
    await browserSetup.stopCamofoxServer((e) => e.data && log(e.data));
    setServerStatus("idle");
    setHealthStatus("idle");
    setCamofoxBusy(false);
    toast.success("Camofox stopped");
  };

  // ─── Local Chrome automation ──────────────────────────────────────────────
  const handleLaunchChrome = async () => {
    setChromeBusy(true);
    setChromeLog([]);
    const log = appendLog(setChromeLog);
    try {
      setChromeStatus("busy");
      setChromeDetail("checking…");
      let chromePath = await browserSetup.detectChrome();
      if (!chromePath) {
        setChromeDetail("not installed — installing…");
        log("Chrome not found. Installing now…");
        const platform = await systemAPI.getPlatform();
        let pw: string | null = null;
        if (platform.isLinux || platform.isWSL) {
          pw = await requestSudoPassword("install Google Chrome (needed for the local browser backend)");
          if (pw === null) {
            setChromeStatus("err");
            setChromeDetail("install cancelled");
            return;
          }
        }
        const inst = await browserSetup.installChrome(
          (e) => e.data && log(e.data),
          pw,
        );
        if (!inst.success) {
          setChromeStatus("err");
          setChromeDetail("install failed");
          toast.error("Chrome install failed", { description: "See the log for details." });
          return;
        }
        chromePath = await browserSetup.detectChrome();
        if (!chromePath) {
          setChromeStatus("warn");
          setChromeDetail("installer launched — finish install, then click Launch Chrome & connect again");
          return;
        }
      }
      setChromeStatus("ok");
      setChromeDetail(chromePath);

      setCdpStatus("busy");
      await browserSetup.launchChromeWithCdp(chromePath, 9222, (e) => e.data && log(e.data));
      const cdpUp = await browserSetup.pollCdp(9222, 90000, (e) => e.data && log(e.data));
      if (!cdpUp) {
        setCdpStatus("err");
        toast.error("Chrome started but the CDP endpoint did not respond");
        return;
      }
      setCdpStatus("ok");
      setChromeRunning(true);

      // Wire it into Hermes config.
      await systemAPI.setBrowserCdpUrl("http://127.0.0.1:9222").catch(() => undefined);
      // Mark capability as user-managed so the probe stops nagging.
      update({
        capabilityPolicy: {
          ...(settings.capabilityPolicy || {}),
          webBrowser: "allow",
        },
      });
      invalidateCapabilityProbeCache();
      log("✓ Hermes config updated: browser.cdp_url = http://127.0.0.1:9222");
      toast.success("Local Chrome connected", { description: "Restart Ron to take effect." });
      onConfigured?.();
    } finally {
      setChromeBusy(false);
    }
  };

  const handleStopChrome = async () => {
    setChromeBusy(true);
    const log = appendLog(setChromeLog);
    await browserSetup.stopLaunchedChrome((e) => e.data && log(e.data));
    await systemAPI.setBrowserCdpUrl(null).catch(() => undefined);
    setCdpStatus("idle");
    setChromeRunning(false);
    setChromeBusy(false);
    toast.success("Chrome stopped");
  };

  const browserbaseUpgrade = getUpgrade("browserbase");

  // ─── Render ────────────────────────────────────────────────────────────
  const renderPick = () => {
    const primary = BROWSER_BACKENDS.filter((b) => b.surface !== "cloud" || b.id === "browserbase");
    const secondary = BROWSER_BACKENDS.filter(
      (b) => b.surface === "cloud" && b.id !== "browserbase",
    );

    return (
      <div className="space-y-4">
        <div className="space-y-2">
          {primary.map((b) => {
            const Icon = ICONS[b.icon] ?? Cloud;
            const locked = isLocked(b);
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => handlePick(b.id)}
                className={cn(
                  "w-full text-left p-3 rounded-lg border transition-all",
                  "border-white/10 bg-background/40 hover:border-primary/40 hover:bg-primary/5",
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-md bg-primary/15 text-primary flex items-center justify-center shrink-0">
                    <Icon className="w-4.5 h-4.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">{b.name}</span>
                      {b.tier === "paid" && (
                        <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary text-[10px]">
                          {locked ? <Lock className="w-2.5 h-2.5 mr-1" /> : <Sparkles className="w-2.5 h-2.5 mr-1" />}
                          Paid · {browserbaseUpgrade?.priceLabel.replace("One-time · ", "") ?? "$29"}
                        </Badge>
                      )}
                      {b.id === "browserbase" && !locked && (
                        <Badge variant="outline" className="border-success/40 bg-success/10 text-success text-[10px]">
                          Unlocked
                        </Badge>
                      )}
                      {b.surface === "local" && (
                        <Badge variant="outline" className="border-white/10 text-muted-foreground text-[10px]">
                          Local
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{b.tagline}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {secondary.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-white/5">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Or quick-add</p>
            <div className="flex flex-wrap gap-2">
              {secondary.map((b) => {
                const Icon = ICONS[b.icon] ?? Cloud;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => handlePick(b.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/10 bg-background/40 hover:border-primary/40 hover:bg-primary/5 text-xs text-foreground transition-colors"
                  >
                    <Icon className="w-3.5 h-3.5 text-primary" />
                    {b.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderBrowserbasePaywall = () => {
    if (!browserbaseUpgrade) return null;
    return (
      <div className="space-y-4">
        <div className="p-4 rounded-lg border border-primary/30 bg-primary/5 space-y-2">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-primary" />
            <p className="text-sm font-semibold text-foreground">Unlock Browserbase support</p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Browserbase is a one-time {browserbaseUpgrade.priceLabel.replace("One-time · ", "")} Ronbot upgrade. After unlocking,
            you'll plug in your Browserbase API key and project ID — Ron does the rest.
            (You'll still need a Browserbase account at browserbase.com for the API key itself.)
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            onClick={() => openExternal(browserbaseUpgrade.buyUrl)}
            className="gradient-primary text-primary-foreground"
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
            Buy ({browserbaseUpgrade.priceLabel.replace("One-time · ", "")})
          </Button>
          <Button variant="outline" onClick={() => setUnlockOpen(true)}>
            <KeyRound className="w-3.5 h-3.5 mr-1.5" /> Enter key
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Prefer a free option? Use{" "}
          <button onClick={() => handlePick("camofox")} className="text-primary hover:underline">Camofox</button>
          {" "}or{" "}
          <button onClick={() => handlePick("localChrome")} className="text-primary hover:underline">Local Chrome</button>.
        </p>
      </div>
    );
  };

  const renderBrowserbaseForm = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="bb-key">API key</Label>
        <Input
          id="bb-key"
          value={bbApiKey}
          onChange={(e) => setBbApiKey(e.target.value)}
          placeholder="bb_live_…"
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-xs"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="bb-pid">Project ID</Label>
        <Input
          id="bb-pid"
          value={bbProjectId}
          onChange={(e) => setBbProjectId(e.target.value)}
          placeholder="UUID from your Browserbase dashboard"
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-xs"
        />
      </div>
      <button
        type="button"
        onClick={() => openExternal("https://www.browserbase.com/dashboard")}
        className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
      >
        Get keys from Browserbase <ExternalLink className="w-3 h-3" />
      </button>
    </div>
  );

  const renderCamofox = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="cf-url">Camofox server URL</Label>
        <Input
          id="cf-url"
          value={camofoxUrl}
          onChange={(e) => setCamofoxUrl(e.target.value)}
          placeholder="http://localhost:9377"
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-xs"
        />
        <p className="text-[11px] text-muted-foreground">
          Default points at the local server Ron will install for you (no Docker needed — uses Node.js + git).
          Only change this if you're running Camofox on another machine.
        </p>
      </div>

      <div className="flex items-start justify-between gap-3 p-3 rounded-md border border-white/10 bg-background/30">
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-foreground">Persistent sessions</p>
          <p className="text-[11px] text-muted-foreground">
            Keep cookies & localStorage between runs so Ron stays logged in to sites.
          </p>
        </div>
        <Switch checked={camofoxPersist} onCheckedChange={setCamofoxPersist} />
      </div>

      <div className="space-y-2 p-3 rounded-md border border-white/10 bg-background/20">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Status</p>
        <StatusRow label="Node.js & git" status={nodeStatus} detail={nodeDetail} />
        <StatusRow
          label="Camofox server"
          status={serverStatus}
          detail={serverStatus === "ok" ? "running on port 9377" : undefined}
        />
        <StatusRow
          label="Health"
          status={healthStatus}
          detail={
            healthStatus === "ok"
              ? "responding on /health"
              : healthStatus === "warn"
              ? "no response yet — give it a minute"
              : undefined
          }
        />
      </div>

      <LogPanel lines={camofoxLog} />

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={handleInstallCamofox}
          disabled={camofoxBusy}
          className="gradient-primary text-primary-foreground"
        >
          {camofoxBusy ? (
            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5 mr-1.5" />
          )}
          Install &amp; start Camofox
        </Button>
        {serverStatus === "ok" && (
          <Button variant="outline" onClick={handleInstallCamofox} disabled={camofoxBusy}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Restart
          </Button>
        )}
        {serverStatus === "ok" && (
          <Button variant="outline" onClick={handleStopCamofox} disabled={camofoxBusy}>
            <Square className="w-3.5 h-3.5 mr-1.5" /> Stop
          </Button>
        )}
      </div>
    </div>
  );

  const renderLocalChrome = () => (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Ron will install Chrome (if missing), launch it with remote debugging on port 9222, and
        write the connection URL into the agent's config. You don't need to touch a terminal.
      </p>

      <div className="space-y-2 p-3 rounded-md border border-white/10 bg-background/20">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Status</p>
        <StatusRow label="Chrome" status={chromeStatus} detail={chromeDetail} />
        <StatusRow
          label="CDP endpoint"
          status={cdpStatus}
          detail={cdpStatus === "ok" ? "http://127.0.0.1:9222" : undefined}
        />
      </div>

      <LogPanel lines={chromeLog} />

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={handleLaunchChrome}
          disabled={chromeBusy}
          className="gradient-primary text-primary-foreground"
        >
          {chromeBusy ? (
            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5 mr-1.5" />
          )}
          Launch Chrome &amp; connect
        </Button>
        {chromeRunning && (
          <Button variant="outline" onClick={handleStopChrome} disabled={chromeBusy}>
            <Square className="w-3.5 h-3.5 mr-1.5" /> Stop Chrome
          </Button>
        )}
      </div>

      <div className="p-3 rounded-md border border-warning/30 bg-warning/5 text-[11px] text-foreground/90">
        Ron uses a fresh user-data directory at <code>~/.ronbot-chrome</code> so it doesn't conflict
        with your normal Chrome profile. Sign in to any sites you want Ron to access in that window.
      </div>
    </div>
  );

  const renderQuickKey = (label: string, value: string, onChange: (v: string) => void, placeholder: string) => (
    <div className="space-y-2">
      <Label htmlFor="quick-key">{label}</Label>
      <Input
        id="quick-key"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="font-mono text-xs"
      />
    </div>
  );

  const renderConfigure = () => {
    if (!backend) return null;
    if (backend.id === "browserbase") {
      return isLocked(backend) ? renderBrowserbasePaywall() : renderBrowserbaseForm();
    }
    if (backend.id === "camofox") return renderCamofox();
    if (backend.id === "localChrome") return renderLocalChrome();
    if (backend.id === "browserUse")
      return renderQuickKey("Browser Use API key", browserUseKey, setBrowserUseKey, "bu_…");
    if (backend.id === "firecrawl")
      return renderQuickKey("Firecrawl API key", firecrawlKey, setFirecrawlKey, "fc-…");
    return null;
  };

  /** Whether the footer Save button applies to the current backend. */
  const usesFooterSave = (b: BrowserBackend | null): boolean =>
    !!b && (b.id === "browserbase" || b.id === "browserUse" || b.id === "firecrawl");

  const canSave = (): boolean => {
    if (!backend) return false;
    if (backend.id === "browserbase") return !isLocked(backend) && !!bbApiKey.trim() && !!bbProjectId.trim();
    if (backend.id === "browserUse") return !!browserUseKey.trim();
    if (backend.id === "firecrawl") return !!firecrawlKey.trim();
    return false;
  };

  const handleSave = async () => {
    if (!backend) return;
    if (backend.id === "browserbase") return handleSaveBrowserbase();
    if (backend.id === "browserUse") return handleSaveBrowserUse();
    if (backend.id === "firecrawl") return handleSaveFirecrawl();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {step === "configure" && backend && (
                <button
                  type="button"
                  onClick={() => setStep("pick")}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Back"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              )}
              {step === "pick" ? "Set up Ron's web browser" : `Configure ${backend?.name ?? ""}`}
            </DialogTitle>
            <DialogDescription>
              {step === "pick"
                ? "Pick a backend so Ron can actually load web pages. Most modern sites block plain HTTP — you'll want a real browser here."
                : backend?.description}
            </DialogDescription>
          </DialogHeader>

          {step === "pick" ? renderPick() : renderConfigure()}

          {step === "configure" && backend && usesFooterSave(backend) && (
            <DialogFooter className="pt-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
              {!isLocked(backend) && (
                <Button onClick={handleSave} disabled={saving || !canSave()}>
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Saving…
                    </>
                  ) : (
                    "Save & restart Ron"
                  )}
                </Button>
              )}
            </DialogFooter>
          )}

          {step === "configure" && backend && !usesFooterSave(backend) && (
            <DialogFooter className="pt-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <EnterLicenseKeyDialog
        upgradeId="browserbase"
        open={unlockOpen}
        onOpenChange={setUnlockOpen}
        onUnlocked={async () => {
          await refreshUnlocks();
        }}
      />
    </>
  );
};

export default BrowserSetupDialog;
