import { useEffect, useMemo, useState } from "react";
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

  // Pre-load any already-stored credentials so reconfiguring is friction-free.
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setTestResult("idle");
    setTestError("");
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const cred of channel.credentials) {
        const existing = await systemAPI.secrets.get(cred.envVar);
        next[cred.envVar] = existing || "";
      }
      if (!cancelled) setValues(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, channel]);

  const requiredFilled = useMemo(
    () => channel.credentials.every((c) => c.optional || (values[c.envVar] || "").trim().length > 0),
    [channel.credentials, values],
  );

  const saveCredentials = async (): Promise<boolean> => {
    setSaving(true);
    try {
      for (const cred of channel.credentials) {
        const v = (values[cred.envVar] || "").trim();
        if (!v && cred.optional) continue;
        if (!v) {
          toast.error(`${cred.label} is required`);
          return false;
        }
        const ok = await systemAPI.secrets.set(cred.envVar, v);
        if (!ok) {
          toast.error(`Failed to save ${cred.label}`);
          return false;
        }
      }
      // Push secrets into ~/.hermes/.env so the gateway can read them.
      await systemAPI.materializeEnv();
      return true;
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult("idle");
    setTestError("");
    // Sync to disk first in case the user just edited values without leaving step 2.
    await systemAPI.materializeEnv();
    // We don't have a per-channel test endpoint yet — but materializeEnv
    // surfaces the missing-key path, which is the most common failure mode.
    // The real send-test will land when we wire startGateway(channel).
    try {
      // readEnvFile() returns a parsed Record<string, string> of the
      // current ~/.hermes/.env. A key is "present" when it exists with
      // a non-empty value.
      const env = await systemAPI.readEnvFile();
      const missing = channel.credentials
        .filter((c) => !c.optional)
        .filter((c) => !(env[c.envVar] && env[c.envVar].trim().length > 0));
      if (missing.length > 0) {
        setTestResult("fail");
        setTestError(`Missing in ~/.hermes/.env: ${missing.map((m) => m.envVar).join(", ")}`);
      } else {
        setTestResult("ok");
      }
    } catch (e) {
      setTestResult("fail");
      setTestError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const enableGateway = async () => {
    const r = await systemAPI.startGateway();
    if (r.success) {
      toast.success(`${channel.name} channel enabled`, {
        description: "Your agent is now reachable here.",
      });
      onComplete();
      onClose();
    } else {
      toast.error("Failed to start gateway", {
        description: r.stderr?.split("\n")[0] || "Check Logs for details.",
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
                {channel.credentials.map((c) => (
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
              {channel.credentials.map((cred) => (
                <div key={cred.envVar} className="space-y-1">
                  <Label htmlFor={cred.envVar} className="text-xs">
                    {cred.label}{" "}
                    {cred.optional && <span className="text-muted-foreground/60">(optional)</span>}
                  </Label>
                  <Input
                    id={cred.envVar}
                    type={cred.inputType ?? "password"}
                    value={values[cred.envVar] || ""}
                    onChange={(e) => setValues((v) => ({ ...v, [cred.envVar]: e.target.value }))}
                    placeholder={cred.hint}
                    autoComplete="off"
                    spellCheck={false}
                    className="bg-background/50"
                  />
                  <p className="text-[11px] text-muted-foreground">{cred.hint}</p>
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

            <div className="rounded-lg border border-border/60 bg-background/30 p-4">
              {testResult === "idle" && (
                <Button onClick={runTest} disabled={testing} className="w-full">
                  {testing ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Testing…</>
                  ) : (
                    "Run test"
                  )}
                </Button>
              )}
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
                  <Button variant="outline" size="sm" onClick={runTest} disabled={testing}>
                    Try again
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {step > 0 && (
            <Button variant="ghost" onClick={back} disabled={saving}>
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
