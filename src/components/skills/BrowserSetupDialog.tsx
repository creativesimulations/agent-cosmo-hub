import { useEffect, useMemo, useState } from "react";
import {
  Cloud,
  Server,
  Chrome as ChromeIcon,
  MousePointerClick,
  Flame,
  Lock,
  ExternalLink,
  KeyRound,
  Loader2,
  ArrowLeft,
  Copy,
  CheckCircle2,
  Sparkles,
  ChevronDown,
  ChevronRight,
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
import { systemAPI, secretsStore } from "@/lib/systemAPI";
import {
  BROWSER_BACKENDS,
  BrowserBackend,
  BrowserBackendId,
  camofoxDockerSnippet,
  camofoxGitSnippet,
  detectOS,
  getBrowserBackend,
  localChromeLaunchCommand,
} from "@/lib/browserBackends";
import { isUpgradeUnlocked, getUpgrade } from "@/lib/licenses";
import EnterLicenseKeyDialog from "@/components/upgrades/EnterLicenseKeyDialog";
import { invalidateCapabilityProbeCache } from "@/lib/capabilityProbe";
import { useSettings } from "@/contexts/SettingsContext";

interface BrowserSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful save so the parent can re-probe / re-render. */
  onConfigured?: () => void;
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Cloud,
  Server,
  Chrome,
  MousePointerClick,
  Flame,
};

const openExternal = (url: string) => {
  window.open(url, "_blank", "noopener,noreferrer");
};

const CopyBlock = ({ children }: { children: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative group">
      <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-background/40 border border-white/10 rounded-md p-3 pr-10 text-foreground/90">
        {children}
      </pre>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(children).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="absolute top-2 right-2 p-1.5 rounded-md hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Copy to clipboard"
      >
        {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
};

const BrowserSetupDialog = ({ open, onOpenChange, onConfigured }: BrowserSetupDialogProps) => {
  const { setSetting, settings } = useSettings();
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
  const [camofoxHowto, setCamofoxHowto] = useState(false);
  const [browserUseKey, setBrowserUseKey] = useState("");
  const [firecrawlKey, setFirecrawlKey] = useState("");

  const os = useMemo(() => detectOS(), []);
  const chromeCmd = useMemo(() => localChromeLaunchCommand(os), [os]);

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
    void refreshUnlocks();
  }, [open]);

  const backend: BrowserBackend | null = picked ? getBrowserBackend(picked) ?? null : null;
  const isLocked = (b: BrowserBackend | null): boolean =>
    !!(b && b.tier === "paid" && b.upgradeId && !unlocks[b.upgradeId]);

  const handlePick = (id: BrowserBackendId) => {
    setPicked(id);
    setStep("configure");
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
      toast.success(successMsg, {
        description: "Restart Ron to take effect.",
      });
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

  const handleSaveCamofox = async () => {
    if (!camofoxUrl.trim()) return;
    setSaving(true);
    const ok = await secretsStore.set("CAMOFOX_URL", camofoxUrl.trim());
    if (!ok) {
      setSaving(false);
      toast.error("Failed to save CAMOFOX_URL");
      return;
    }
    // Update Hermes config block (best-effort).
    await systemAPI.setBrowserCamofoxPersistence?.(camofoxPersist).catch(() => undefined);
    setSaving(false);
    toast.success("Camofox configured", {
      description: "Restart Ron to take effect.",
    });
    invalidateCapabilityProbeCache();
    onConfigured?.();
    onOpenChange(false);
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

  const handleSaveLocalChrome = async () => {
    // No secrets — just record that the user is managing this manually.
    setSetting("capabilityPolicy", {
      ...(settings.capabilityPolicy || {}),
      webBrowser: "allow",
    });
    toast.success("Local Chrome marked as configured", {
      description: "Run the launch command in your terminal, then issue `/browser connect` from inside Ron.",
    });
    invalidateCapabilityProbeCache();
    onConfigured?.();
    onOpenChange(false);
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
                      {b.surface === "manual" && (
                        <Badge variant="outline" className="border-white/10 text-muted-foreground text-[10px]">
                          Advanced
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
          Prefer a free option? Use <button onClick={() => handlePick("camofox")} className="text-primary hover:underline">Camofox</button>
          {" "}or <button onClick={() => handlePick("localChrome")} className="text-primary hover:underline">Local Chrome</button>.
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
      <div className="border border-white/5 rounded-md">
        <button
          type="button"
          onClick={() => setCamofoxHowto((v) => !v)}
          className="w-full flex items-center justify-between p-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <span className="font-medium">How to run Camofox</span>
          {camofoxHowto ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        {camofoxHowto && (
          <div className="px-3 pb-3 space-y-3">
            <div className="space-y-1.5">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Docker (recommended)</p>
              <CopyBlock>{camofoxDockerSnippet()}</CopyBlock>
            </div>
            <div className="space-y-1.5">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Or from source</p>
              <CopyBlock>{camofoxGitSnippet()}</CopyBlock>
            </div>
            <button
              type="button"
              onClick={() => openExternal("https://github.com/jo-inc/camofox-browser")}
              className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
            >
              Camofox docs <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const renderLocalChrome = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Step 1 — Launch Chrome with remote debugging ({os})
        </p>
        <CopyBlock>{chromeCmd}</CopyBlock>
        <p className="text-[11px] text-muted-foreground">
          Use a fresh user-data dir so it doesn't conflict with your normal Chrome profile.
          Log into any sites you want Ron to access.
        </p>
      </div>
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Step 2 — Connect from the agent terminal
        </p>
        <CopyBlock>{`hermes\n/browser connect`}</CopyBlock>
        <p className="text-[11px] text-muted-foreground">
          The <code className="text-foreground">/browser connect</code> command must be issued from
          a terminal session of the agent — not from this chat. Once connected, Ron will use that
          Chrome for all browsing in this app too.
        </p>
      </div>
      <div className="p-3 rounded-md border border-warning/30 bg-warning/5 text-[11px] text-foreground/90">
        Marking this option as configured tells Ronbot to stop showing the "no browser configured"
        warning. If you switch backends later, set <code>Web browsing</code> back to "Ask" in Settings.
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

  const canSave = (): boolean => {
    if (!backend) return false;
    if (backend.id === "browserbase") return !isLocked(backend) && !!bbApiKey.trim() && !!bbProjectId.trim();
    if (backend.id === "camofox") return !!camofoxUrl.trim();
    if (backend.id === "localChrome") return true;
    if (backend.id === "browserUse") return !!browserUseKey.trim();
    if (backend.id === "firecrawl") return !!firecrawlKey.trim();
    return false;
  };

  const handleSave = async () => {
    if (!backend) return;
    if (backend.id === "browserbase") return handleSaveBrowserbase();
    if (backend.id === "camofox") return handleSaveCamofox();
    if (backend.id === "localChrome") return handleSaveLocalChrome();
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

          {step === "configure" && backend && backend.id !== "localChrome" && (
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
          {step === "configure" && backend?.id === "localChrome" && (
            <DialogFooter className="pt-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave}>Mark as configured</Button>
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
