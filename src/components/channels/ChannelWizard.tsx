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

type Step = 0 | 1 | 2 | 3;

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
  const [waPairingLines, setWaPairingLines] = useState<string[]>([]);
  const [waPairingError, setWaPairingError] = useState("");
  const waLogBuffer = useRef("");
  const waStreamIdRef = useRef<string | null>(null);
  const waLogEndRef = useRef<HTMLDivElement | null>(null);

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
    setWaPairingLines([]);
    setWaPairingError("");
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
    waLogBuffer.current += event.data.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const parts = waLogBuffer.current.split("\n");
    waLogBuffer.current = parts.pop() ?? "";
    if (parts.length === 0) return;
    setWaPairingLines((prev) => [...prev, ...parts].slice(-400));
  }, []);

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

  /** WhatsApp step 3: probe whether a session already exists */
  useEffect(() => {
    if (!open || step !== 3 || channel.id !== "whatsapp") return;
    let cancelled = false;
    setWaPairedChecked(false);
    (async () => {
      const r = await systemAPI.isWhatsAppPaired();
      if (cancelled) return;
      setWaPaired(!!(r.success && r.paired));
      setWaPairedChecked(true);
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
    if (channel.id === "whatsapp") {
      if (!waPairedChecked) return;
      if (!waPaired) return;
    }
    if (testResult !== "idle") return;
    void runTest();
  }, [open, step, channel.id, waPaired, waPairedChecked, testResult, testing, runTest]);

  const startWaPairing = async () => {
    setWaPairingError("");
    waLogBuffer.current = "";
    setWaPairingLines([]);
    setWaPairingActive(true);
    waStreamIdRef.current = null;
    await systemAPI.materializeEnv().catch(() => undefined);
    try {
      await systemAPI.runWhatsAppPairing(appendWaPairingChunk, {
        onStreamId: (id) => {
          waStreamIdRef.current = id;
        },
      });
    } catch (e) {
      setWaPairingError(e instanceof Error ? e.message : String(e));
    } finally {
      setWaPairingActive(false);
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

  const cancelWaPairing = async () => {
    const id = waStreamIdRef.current;
    if (id) {
      await systemAPI.killStream(id);
    }
  };

  const recheckWaPaired = async () => {
    const paired = await systemAPI.isWhatsAppPaired();
    if (paired.success && paired.paired) {
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
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
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

            {channel.id === "whatsapp" && waPairedChecked && !waPaired && (
              <div className="rounded-lg border border-border/60 bg-background/30 p-4 space-y-3">
                <h4 className="text-sm font-medium text-foreground">Link WhatsApp</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  On your phone: WhatsApp → Settings → Linked devices → Link a device. Then start pairing here
                  and scan the QR code when it appears in the log below.
                </p>
                {waPairingError && (
                  <p className="text-xs text-destructive font-mono whitespace-pre-wrap">{waPairingError}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={() => void startWaPairing()}
                    disabled={waPairingActive || testing}
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
                    disabled={waPairingActive || testing}
                  >
                    I already scanned — check link
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Tip: ASCII QR codes need a monospace font — if the square looks cramped, widen the window or scroll horizontally.
                </p>
                <div className="rounded-md border border-border/50 bg-background/50 max-h-56 overflow-x-auto overflow-y-auto p-2">
                  <pre className="text-[10px] leading-tight font-mono text-foreground/90 whitespace-pre min-w-max">
                    {waPairingLines.length > 0 ? waPairingLines.join("\n") : waPairingActive ? "Starting…" : "Output from Hermes will appear here."}
                  </pre>
                  <div ref={waLogEndRef} />
                </div>
              </div>
            )}

            <div className="rounded-lg border border-border/60 bg-background/30 p-4">
              {channel.id === "whatsapp" && (!waPairedChecked || !waPaired) ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  {waPairedChecked ? (
                    <>
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      Link WhatsApp above, then the test runs automatically.
                    </>
                  ) : (
                    <>
                      <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                      Checking WhatsApp link…
                    </>
                  )}
                </div>
              ) : testResult === "idle" ? (
                <Button onClick={() => void runTest()} disabled={testing} className="w-full">
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
                  <Button variant="outline" size="sm" onClick={() => void runTest()} disabled={testing}>
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
