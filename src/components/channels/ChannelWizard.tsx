import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { ExternalLink, ArrowLeft, ArrowRight, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { systemAPI } from "@/lib/systemAPI";
import { toast } from "sonner";
import type { Channel } from "@/lib/channels";
import ActionableError from "@/components/ui/ActionableError";
import { useSudoPrompt } from "@/contexts/SudoPromptContext";

type Step = 0 | 1 | 2 | 3;
type WaPairingPhase = "idle" | "runtime" | "bridge-deps" | "pairing";

interface ChannelWizardProps {
  channel: Channel;
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}

const openExternal = (url: string) => window.open(url, "_blank", "noopener,noreferrer");

const ChannelWizard = ({ channel, open, onClose, onComplete }: ChannelWizardProps) => {
  const [step, setStep] = useState<Step>(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"idle" | "ok" | "fail">("idle");
  const [testError, setTestError] = useState<string>("");
  const [formError, setFormError] = useState<string>("");

  /** WhatsApp: session folder probe + in-app QR stream */
  const [waPairedChecked, setWaPairedChecked] = useState(false);
  const [waPaired, setWaPaired] = useState(false);
  const [waPairingActive, setWaPairingActive] = useState(false);
  const [waPairingPhase, setWaPairingPhase] = useState<WaPairingPhase>("idle");
  const [waPairingLines, setWaPairingLines] = useState<string[]>([]);
  const [waPairingError, setWaPairingError] = useState("");
  const [waPairPrereqChecked, setWaPairPrereqChecked] = useState(false);
  const [waPairPrereqOk, setWaPairPrereqOk] = useState(false);
  const [waPairPrereqDetail, setWaPairPrereqDetail] = useState("");
  const [waAutoFixing, setWaAutoFixing] = useState(false);
  const [setupToolsChecked, setSetupToolsChecked] = useState(false);
  const [setupToolsOk, setSetupToolsOk] = useState(false);
  const [setupToolsDetail, setSetupToolsDetail] = useState("");
  const [gatewayRefreshBusy, setGatewayRefreshBusy] = useState(false);
  const waLogBuffer = useRef("");
  const waStreamIdRef = useRef<string | null>(null);
  const waLogEndRef = useRef<HTMLDivElement | null>(null);
  const { requestSudoPassword } = useSudoPrompt();

  // Pre-load any already-stored credentials so reconfiguring is friction-free.
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setTestResult("idle");
    setTestError("");
    setFormError("");
    setWaPairedChecked(false);
    setWaPaired(false);
    setWaPairingActive(false);
    setWaPairingPhase("idle");
    setWaPairingLines([]);
    setWaPairingError("");
    setWaPairPrereqChecked(false);
    setWaPairPrereqOk(false);
    setWaPairPrereqDetail("");
    setWaAutoFixing(false);
    setSetupToolsChecked(false);
    setSetupToolsOk(false);
    setSetupToolsDetail("");
    waLogBuffer.current = "";
    waStreamIdRef.current = null;
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const cred of channel.credentials) {
        const existing = await systemAPI.secrets.get(cred.envVar);
        // For hidden creds, always use defaultValue (auto). For choice, fall
        // back to defaultValue when nothing is stored yet.
        if (cred.kind === "hidden") {
          next[cred.envVar] = cred.defaultValue ?? "";
        } else if (cred.kind === "choice") {
          next[cred.envVar] = existing || cred.defaultValue || cred.choices?.[0]?.value || "";
        } else {
          next[cred.envVar] = existing || "";
        }
      }
      if (!cancelled) setValues(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, channel]);

  const visibleCredentials = useMemo(
    () => channel.credentials.filter((c) => c.kind !== "hidden"),
    [channel.credentials],
  );

  const requiredFilled = useMemo(
    () => channel.credentials.every((c) => c.optional || (values[c.envVar] || "").trim().length > 0),
    [channel.credentials, values],
  );

  const appendWaPairingChunk = useCallback((event: { type: string; data?: string }) => {
    if ((event.type !== "stdout" && event.type !== "stderr") || !event.data) return;
    if (event.data.includes("[process] Command timed out")) {
      const sid = waStreamIdRef.current;
      if (sid) {
        void systemAPI.killStream(sid);
        waStreamIdRef.current = null;
      }
      setWaPairingActive(false);
      const phaseMessage =
        waPairingPhase === "runtime"
          ? "Managed runtime preparation timed out."
          : waPairingPhase === "bridge-deps"
            ? "WhatsApp bridge dependency installation timed out."
            : "WhatsApp pairing timed out before a session was saved.";
      setWaPairingError(`${phaseMessage} Try again; Ronbot will continue from any cached progress.`);
      setWaPairingPhase("idle");
    }
    waLogBuffer.current += event.data.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const parts = waLogBuffer.current.split("\n");
    waLogBuffer.current = parts.pop() ?? "";
    if (parts.length === 0) return;
    setWaPairingLines((prev) => [...prev, ...parts].slice(-400));
  }, [waPairingPhase]);

  const saveCredentials = async (): Promise<boolean> => {
    setSaving(true);
    try {
      for (const cred of channel.credentials) {
        const v = (values[cred.envVar] || "").trim();
        if (!v && cred.optional) continue;
        if (!v) {
          setFormError(`${cred.label} is required`);
          toast.error(`${cred.label} is required`);
          return false;
        }
        const ok = await systemAPI.secrets.set(cred.envVar, v);
        if (!ok) {
          setFormError(`Failed to save ${cred.label}`);
          toast.error(`Failed to save ${cred.label}`);
          return false;
        }
      }
      // Push secrets into ~/.hermes/.env so the gateway can read them.
      await systemAPI.materializeEnv();
      setFormError("");
      return true;
    } finally {
      setSaving(false);
    }
  };

  const runTest = useCallback(async () => {
    setTesting(true);
    setTestResult("idle");
    setTestError("");
    try {
      await systemAPI.materializeEnv();
      if (channel.id === "whatsapp") {
        const paired = await systemAPI.isWhatsAppPaired();
        if (!paired.success) {
          setTestResult("fail");
          setTestError(paired.error || "Couldn't verify WhatsApp pairing.");
          return;
        }
        if (!paired.paired) {
          setTestResult("fail");
          setTestError(
            "WhatsApp is not linked yet. Use “Start QR pairing” above, scan with your phone, then try the test again.",
          );
          return;
        }
      }
      const r = await systemAPI.testChannel(channel.id);
      if (r.success) {
        setTestResult("ok");
        return;
      }
      const detail = r.stderr?.trim() || r.stdout?.trim() || "Channel test command failed.";
      const env = await systemAPI.readEnvFile();
      const missing = channel.credentials
        .filter((c) => !c.optional)
        .filter((c) => !(env[c.envVar] && env[c.envVar].trim().length > 0));
      setTestResult("fail");
      setTestError(
        missing.length > 0
          ? `${detail}\nMissing in ~/.hermes/.env: ${missing.map((m) => m.envVar).join(", ")}`
          : detail,
      );
    } catch (e) {
      setTestResult("fail");
      setTestError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  }, [channel]);

  /** Step 3: tools for credential tests + WhatsApp pairing prereqs (npm, script) + session */
  useEffect(() => {
    if (!open || step !== 3) return;
    let cancelled = false;
    setSetupToolsChecked(false);
    setSetupToolsOk(false);
    setSetupToolsDetail("");
    if (channel.id === "whatsapp") {
      setWaPairedChecked(false);
      setWaPairPrereqChecked(false);
    }
    (async () => {
      const tools = await systemAPI.checkChannelSetupTools(channel.id);
      if (cancelled) return;
      setSetupToolsDetail([tools.stderr, tools.stdout].filter(Boolean).join("\n").trim());
      setSetupToolsChecked(true);
      setSetupToolsOk(tools.success);

      if (channel.id === "whatsapp") {
        const pr = await systemAPI.checkWhatsAppPairingPrereqs();
        const r = await systemAPI.isWhatsAppPaired();
        if (cancelled) return;
        setWaPairPrereqDetail([pr.stderr, pr.stdout].filter(Boolean).join("\n").trim());
        setWaPairPrereqChecked(true);
        setWaPairPrereqOk(pr.success);
        setWaPaired(!!(r.success && r.paired));
        setWaPairedChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, step, channel.id]);

  useEffect(() => {
    waLogEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [waPairingLines]);

  /** Stop Hermes pairing if the user closes the wizard mid-stream */
  useEffect(() => {
    if (open) return;
    const id = waStreamIdRef.current;
    if (id) {
      void systemAPI.killStream(id);
      waStreamIdRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open || step !== 3 || testing) return;
    if (!setupToolsChecked || !setupToolsOk) return;
    if (channel.id === "whatsapp") {
      if (!waPairedChecked) return;
      if (!waPaired) return;
    }
    if (testResult !== "idle") return;
    void runTest();
  }, [
    open,
    step,
    channel.id,
    waPaired,
    waPairedChecked,
    setupToolsChecked,
    setupToolsOk,
    testResult,
    testing,
    runTest,
  ]);

  const startWaPairing = async () => {
    setWaPairingError("");
    waLogBuffer.current = "";
    setWaPairingLines([]);
    setWaPairingActive(true);
    setWaPairingPhase("runtime");
    waStreamIdRef.current = null;
    try {
      if (waPairPrereqChecked && !waPairPrereqOk) {
        const fixed = await autoFixWhatsAppPairingTools();
        if (!fixed) return;
      }
      await systemAPI.materializeEnv().catch(() => undefined);
      setWaPairingPhase("bridge-deps");
      const bridge = await systemAPI.ensureWhatsAppBridgeDeps(appendWaPairingChunk, {
        onStreamId: (id: string) => {
          waStreamIdRef.current = id;
        },
      });
      if (!bridge.success) {
        const detail = [bridge.stderr, bridge.stdout].filter(Boolean).join("\n").trim();
        setWaPairingError(detail || "Could not repair WhatsApp bridge dependencies.");
        toast.error("WhatsApp dependency repair failed", {
          description: detail.split("\n")[0] || "Review details and try again.",
        });
        setWaPairingPhase("idle");
        return;
      }
      setWaPairingPhase("pairing");
      await systemAPI.runWhatsAppPairing(appendWaPairingChunk, {
        onStreamId: (id) => {
          waStreamIdRef.current = id;
        },
      });
    } catch (e) {
      setWaPairingError(e instanceof Error ? e.message : String(e));
    } finally {
      setWaPairingActive(false);
      setWaPairingPhase("idle");
      waStreamIdRef.current = null;
      const tail = waLogBuffer.current.trimEnd();
      if (tail) {
        setWaPairingLines((prev) => [...prev, tail].slice(-400));
        waLogBuffer.current = "";
      }
    }
    const paired = await systemAPI.isWhatsAppPaired();
    if (paired.success && paired.paired) {
      setWaPaired(true);
      toast.success("WhatsApp linked");
      void runTest();
    } else if (!paired.success) {
      setWaPairingError(paired.error || "Could not verify WhatsApp pairing.");
    } else {
      setWaPairingError(
        "Hermes closed before a session was saved. Check the log for errors, or try Start QR pairing again after scanning.",
      );
    }
  };

  const autoFixWhatsAppPairingTools = useCallback(async (): Promise<boolean> => {
    setWaAutoFixing(true);
    try {
      const platform = await systemAPI.getPlatform();
      const current = await systemAPI.checkWhatsAppPairingPrereqs();
      if (current.success) {
        setWaPairPrereqDetail([current.stderr, current.stdout].filter(Boolean).join("\n").trim());
        setWaPairPrereqOk(true);
        setWaPairPrereqChecked(true);
        return true;
      }

      const detail = [current.stderr, current.stdout].filter(Boolean).join("\n").trim();
      const missingNode = /\bnpm\b/i.test(detail) || /node/i.test(detail);
      const missingScript = /\bscript\b/i.test(detail);

      if (missingNode) {
        const runtime = await systemAPI.ensureHermesNodeRuntime(appendWaPairingChunk, {
          onStreamId: (id: string) => {
            waStreamIdRef.current = id;
          },
        });
        if (!runtime.success) {
          const msg = [runtime.stderr, runtime.stdout].filter(Boolean).join("\n").trim();
          setWaPairPrereqDetail(msg || detail);
          toast.error("Could not prepare managed Node runtime", {
            description: msg.split("\n")[0] || "Try again after checking network access.",
          });
          return false;
        }
      }

      if (missingScript && (platform.isLinux || platform.isWSL)) {
        const pw = await requestSudoPassword("install util-linux (provides script) for WhatsApp pairing");
        if (pw === null) {
          toast.error("util-linux install cancelled");
          return false;
        }
        const util = await systemAPI.sudo.aptInstall(["util-linux"], pw);
        if (!util.success) {
          const msg = [util.stderr, util.stdout].filter(Boolean).join("\n").trim();
          setWaPairPrereqDetail(msg || detail);
          toast.error("Could not install script utility", {
            description: msg.split("\n")[0] || "Try again and allow elevated install permissions.",
          });
          return false;
        }
      }

      const recheck = await systemAPI.checkWhatsAppPairingPrereqs();
      setWaPairPrereqDetail([recheck.stderr, recheck.stdout].filter(Boolean).join("\n").trim());
      setWaPairPrereqChecked(true);
      setWaPairPrereqOk(recheck.success);
      if (!recheck.success) {
        toast.error("Still missing WhatsApp tools", {
          description: "Ronbot could not fully prepare dependencies automatically yet.",
        });
      }
      return recheck.success;
    } finally {
      setWaAutoFixing(false);
    }
  }, [appendWaPairingChunk, requestSudoPassword]);

  const cancelWaPairing = async () => {
    const id = waStreamIdRef.current;
    setWaPairingActive(false);
    setWaPairingPhase("idle");
    waStreamIdRef.current = null;
    if (id) {
      await systemAPI.killStream(id);
    }
  };

  const recheckWaPaired = async () => {
    const paired = await systemAPI.isWhatsAppPaired();
    if (paired.success && paired.paired) {
      const id = waStreamIdRef.current;
      if (id) {
        await systemAPI.killStream(id);
      }
      waStreamIdRef.current = null;
      setWaPairingActive(false);
      setWaPairingPhase("idle");
      setWaPaired(true);
      setWaPairingError("");
      toast.success("WhatsApp linked");
      setTestResult("idle");
      void runTest();
    } else {
      toast.info("Not linked yet", {
        description: "Finish scanning the QR code on your phone, then check again.",
      });
    }
  };

  useEffect(() => {
    if (!open || step !== 3 || channel.id !== "whatsapp" || !waPairingActive) return;
    const timer = window.setInterval(() => {
      void (async () => {
        const paired = await systemAPI.isWhatsAppPaired();
        if (!(paired.success && paired.paired)) return;
        const id = waStreamIdRef.current;
        if (id) {
          await systemAPI.killStream(id);
        }
        waStreamIdRef.current = null;
        setWaPairingActive(false);
        setWaPairingPhase("idle");
        setWaPaired(true);
        setWaPairingError("");
        toast.success("WhatsApp linked");
        setTestResult("idle");
        void runTest();
      })();
    }, 2000);
    return () => {
      window.clearInterval(timer);
    };
  }, [open, step, channel.id, waPairingActive, runTest]);

  const handleRefreshGatewayInstall = async () => {
    setGatewayRefreshBusy(true);
    try {
      const r = await systemAPI.refreshGatewayInstall();
      if (r.success) {
        toast.success("Gateway service refreshed", {
          description: "Hermes re-saved your PATH for the messaging gateway. Start the gateway from Channels if needed.",
        });
        if (channel.id === "whatsapp") {
          const pr = await systemAPI.checkWhatsAppPairingPrereqs();
          setWaPairPrereqDetail([pr.stderr, pr.stdout].filter(Boolean).join("\n").trim());
          setWaPairPrereqOk(pr.success);
        }
      } else {
        toast.error("Could not refresh gateway", {
          description: r.stderr?.split("\n")[0] || r.stdout?.split("\n")[0] || "Check logs and try again.",
        });
      }
    } finally {
      setGatewayRefreshBusy(false);
    }
  };

  const enableGateway = async () => {
    const r = await systemAPI.startGateway();
    if (r.success) {
      setFormError("");
      toast.success(`${channel.name} channel enabled`, {
        description: "Your agent is now reachable here.",
      });
      onComplete();
      onClose();
    } else {
      const detail = r.stderr?.split("\n")[0] || "Check Logs for details.";
      setFormError(detail);
      toast.error("Failed to start gateway", {
        description: detail,
      });
    }
  };

  const next = async () => {
    if (step === 2) {
      const ok = await saveCredentials();
      if (!ok) return;
    }
    setStep((s) => Math.min(3, s + 1) as Step);
  };
  const back = () => setStep((s) => Math.max(0, s - 1) as Step);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className={
          channel.id === "whatsapp" ? "w-[94vw] max-w-5xl max-h-[88vh] overflow-y-auto" : "max-w-xl max-h-[85vh] overflow-y-auto"
        }
      >
        <DialogHeader>
          <DialogTitle>Set up {channel.name}</DialogTitle>
          <DialogDescription>
            Step {step + 1} of 4 · {channel.difficulty} setup
          </DialogDescription>
        </DialogHeader>

        {formError && (
          <ActionableError
            title="Channel setup needs attention"
            summary={formError}
            details={formError}
            onFix={() => setFormError("")}
            fixLabel="Dismiss"
          />
        )}

        {/* Progress bar */}
        <div className="flex gap-1.5 mb-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </div>

        {/* Step 0 — what this does */}
        {step === 0 && (
          <div className="space-y-3 py-2">
            <h3 className="text-sm font-semibold text-foreground">What you're about to enable</h3>
            <p className="text-sm text-muted-foreground">{channel.tagline}</p>
            <p className="text-sm text-muted-foreground">
              Once set up, you'll be able to message your agent through {channel.name} from any device, and
              your agent will reply through the same channel.
            </p>
            <div className="rounded-lg border border-border/60 bg-background/30 p-3 text-xs text-muted-foreground">
              <strong className="text-foreground">You'll need:</strong>
              <ul className="list-disc list-inside mt-1 space-y-0.5">
                {visibleCredentials.map((c) => (
                  <li key={c.envVar}>{c.label}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Step 1 — get credentials */}
        {step === 1 && (
          <div className="space-y-4 py-2">
            <h3 className="text-sm font-semibold text-foreground">Get your credentials</h3>
            <ol className="space-y-3">
              {channel.setupSteps.map((s, i) => (
                <li key={i} className="rounded-lg border border-border/60 bg-background/30 p-3">
                  <div className="flex items-start gap-3">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-semibold shrink-0">
                      {i + 1}
                    </span>
                    <div className="space-y-2 flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{s.title}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">{s.body}</p>
                      {s.link && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openExternal(s.link!.url)}
                          className="h-7 text-xs"
                        >
                          <ExternalLink className="w-3 h-3 mr-1.5" /> {s.link.label}
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Step 2 — paste credentials */}
        {step === 2 && (
          <div className="space-y-3 py-2">
            <h3 className="text-sm font-semibold text-foreground">Paste your credentials</h3>
            <p className="text-xs text-muted-foreground">
              These are stored in your OS keychain — never in plain text.
            </p>
            <div className="space-y-3">
              {visibleCredentials.map((cred) => (
                <div key={cred.envVar} className="space-y-1">
                  <Label htmlFor={cred.envVar} className="text-xs">
                    {cred.label}{" "}
                    {cred.optional && <span className="text-muted-foreground/60">(optional)</span>}
                  </Label>
                  {cred.kind === "choice" && cred.choices ? (
                    <div className="space-y-2 pt-1">
                      {cred.choices.map((opt) => {
                        const checked = (values[cred.envVar] || "") === opt.value;
                        return (
                          <label
                            key={opt.value}
                            htmlFor={`${cred.envVar}-${opt.value}`}
                            className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                              checked
                                ? "border-primary bg-primary/5"
                                : "border-border/60 bg-background/30 hover:border-border"
                            }`}
                          >
                            <input
                              id={`${cred.envVar}-${opt.value}`}
                              type="radio"
                              name={cred.envVar}
                              value={opt.value}
                              checked={checked}
                              onChange={() =>
                                setValues((v) => ({ ...v, [cred.envVar]: opt.value }))
                              }
                              className="mt-0.5 accent-primary"
                            />
                            <div className="space-y-0.5">
                              <p className="text-sm font-medium text-foreground">{opt.label}</p>
                              {opt.description && (
                                <p className="text-[11px] text-muted-foreground leading-relaxed">
                                  {opt.description}
                                </p>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <>
                      <Input
                        id={cred.envVar}
                        type={cred.inputType ?? "password"}
                        value={values[cred.envVar] || ""}
                        onChange={(e) =>
                          setValues((v) => ({ ...v, [cred.envVar]: e.target.value }))
                        }
                        placeholder={cred.hint}
                        autoComplete="off"
                        spellCheck={false}
                        className="bg-background/50"
                      />
                      <p className="text-[11px] text-muted-foreground">{cred.hint}</p>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 3 — test & enable */}
        {step === 3 && (
          <div className="space-y-4 py-2">
            <h3 className="text-sm font-semibold text-foreground">Test &amp; enable</h3>
            <p className="text-sm text-muted-foreground">{channel.testHint}</p>

            {step === 3 &&
              setupToolsChecked &&
              setupToolsOk &&
              channel.id !== "whatsapp" &&
              ["telegram", "slack", "discord", "signal"].includes(channel.id) && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-background/30 px-3 py-2 text-[11px] text-muted-foreground">
                  <span className="min-w-[12rem] flex-1">
                    After installing curl, Python, or Node, or changing PATH, refresh the gateway service so Hermes snapshots PATH (recommended in Hermes docs for macOS/Linux).
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={gatewayRefreshBusy}
                    onClick={() => void handleRefreshGatewayInstall()}
                  >
                    {gatewayRefreshBusy ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Refreshing…
                      </>
                    ) : (
                      "Refresh gateway PATH"
                    )}
                  </Button>
                </div>
              )}

            {step === 3 && setupToolsChecked && !setupToolsOk && (
              <ActionableError
                title="A system tool is missing for the connection test"
                summary={
                  channel.id === "signal"
                    ? "Ronbot uses curl to ping the signal-cli health URL Hermes documents. Python is not required for this channel test."
                    : "Ronbot uses curl and Python 3 to verify your bot tokens when Hermes does not provide a built-in gateway test command."
                }
                details={
                  setupToolsDetail ||
                  (channel.id === "signal"
                    ? "Install curl in the same environment Hermes uses. On Windows with WSL, install curl inside that Linux distro."
                    : "Install curl and Python 3 in the same environment Hermes uses. On Windows with WSL, install them inside that Linux distro.")
                }
                fixLabel={channel.id === "signal" ? "cURL downloads" : "Python downloads"}
                onFix={() =>
                  openExternal(
                    channel.id === "signal"
                      ? "https://curl.se/download.html"
                      : "https://www.python.org/downloads/",
                  )
                }
              />
            )}

            {channel.id === "whatsapp" && waPairPrereqChecked && !waPairPrereqOk && (
              <ActionableError
                title="WhatsApp pairing needs npm and script"
                summary="Ronbot uses a managed Node runtime for WhatsApp bridge dependencies and needs script(1) to allocate a PTY so Hermes can render the QR in this window."
                details={
                  waPairPrereqDetail ||
                  "Use Auto-fix to prepare the managed runtime and missing tools. WhatsApp pairing follows Hermes docs: gateway is the long-running service, and this step only links/saves the session."
                }
                fixLabel="Auto-fix now"
                fixing={waAutoFixing}
                onFix={() => void autoFixWhatsAppPairingTools()}
              />
            )}

            {channel.id === "whatsapp" && setupToolsOk && waPairPrereqOk && waPairedChecked && !waPaired && (
              <div className="rounded-lg border border-border/60 bg-background/30 p-4 space-y-3">
                <h4 className="text-sm font-medium text-foreground">Link WhatsApp</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  On your phone: WhatsApp → Settings → Linked devices → Link a device. Then start pairing here
                  and scan the QR code when it appears in the log below.
                </p>
                {waPairingError && (
                  <p className="text-xs text-destructive font-mono whitespace-pre-wrap">{waPairingError}</p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  After installing Node or changing PATH, use &quot;Refresh gateway PATH&quot; so Hermes re-saves the gateway service (recommended in Hermes docs for macOS/Linux).
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={gatewayRefreshBusy}
                    onClick={() => void handleRefreshGatewayInstall()}
                  >
                    {gatewayRefreshBusy ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Refreshing…
                      </>
                    ) : (
                      "Refresh gateway PATH"
                    )}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void startWaPairing()}
                    disabled={
                      waPairingActive ||
                      waAutoFixing ||
                      testing ||
                      !waPairPrereqChecked ||
                      (waPairPrereqChecked && !waPairPrereqOk)
                    }
                    className="gradient-primary text-primary-foreground"
                  >
                    {waPairingActive ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Pairing…
                      </>
                    ) : (
                      "Start QR pairing"
                    )}
                  </Button>
                  {waPairingActive && (
                    <Button type="button" variant="outline" onClick={() => void cancelWaPairing()}>
                      Cancel pairing
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void recheckWaPaired()}
                    disabled={testing}
                  >
                    I already scanned — check link
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Tip: ASCII QR codes need a monospace font and equal line height. If it still looks cramped, widen the window and zoom your display to 100%.
                </p>
                <div className="rounded-md border border-border/50 bg-background/50 h-[52vh] min-h-[22rem] overflow-x-auto overflow-y-auto p-2">
                  <pre className="text-[10px] leading-[10px] font-mono text-foreground/90 whitespace-pre min-w-max">
                    {(waPairingLines.length > 0 || waLogBuffer.current)
                      ? [...waPairingLines, ...(waLogBuffer.current ? [waLogBuffer.current] : [])].join("\n")
                      : waPairingActive
                        ? "Starting…"
                        : "Output from Hermes will appear here."}
                  </pre>
                  <div ref={waLogEndRef} />
                </div>
              </div>
            )}

            <div className="rounded-lg border border-border/60 bg-background/30 p-4">
              {!setupToolsChecked ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                  Checking tools for this step…
                </div>
              ) : channel.id === "whatsapp" && (!waPairedChecked || !waPaired) ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  {waPairedChecked ? (
                    <>
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      Link WhatsApp above, then the test runs automatically.
                    </>
                  ) : (
                    <>
                      <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                      Checking WhatsApp link and tools…
                    </>
                  )}
                </div>
              ) : !setupToolsOk ? (
                <p className="text-sm text-muted-foreground">Fix the missing tools above, then run the test.</p>
              ) : testResult === "idle" ? (
                <Button
                  onClick={() => void runTest()}
                  disabled={testing || !setupToolsOk}
                  className="w-full"
                >
                  {testing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Testing…
                    </>
                  ) : (
                    "Run test"
                  )}
                </Button>
              ) : null}
              {testResult === "ok" && (
                <div className="flex items-center gap-2 text-sm text-success">
                  <CheckCircle2 className="w-4 h-4" /> Credentials look good. Ready to enable.
                </div>
              )}
              {testResult === "fail" && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="w-4 h-4" /> Test failed
                  </div>
                  {testError && (
                    <p className="text-xs text-muted-foreground font-mono">{testError}</p>
                  )}
                  <Button variant="outline" size="sm" onClick={() => void runTest()} disabled={testing || !setupToolsOk}>
                    Try again
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {step > 0 && (
            <Button variant="ghost" onClick={back} disabled={saving || (channel.id === "whatsapp" && step === 3 && waPairingActive)}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
          )}
          <div className="flex-1" />
          {step < 3 ? (
            <Button
              onClick={next}
              disabled={saving || (step === 2 && !requiredFilled)}
              className="gradient-primary text-primary-foreground"
            >
              {saving ? (
                <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Saving…</>
              ) : (
                <>Next <ArrowRight className="w-4 h-4 ml-1" /></>
              )}
            </Button>
          ) : (
            <Button
              onClick={enableGateway}
              disabled={testResult !== "ok"}
              className="gradient-primary text-primary-foreground"
            >
              Enable {channel.name}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ChannelWizard;
