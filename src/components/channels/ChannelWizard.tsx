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
import { ExternalLink, ArrowLeft, ArrowRight, Loader2, CheckCircle2, AlertCircle, RotateCcw, Trash2 } from "lucide-react";
import { systemAPI } from "@/lib/systemAPI";
import { toast } from "sonner";
import type { Channel } from "@/lib/channels";
import ActionableError from "@/components/ui/ActionableError";
import { useSudoPrompt } from "@/contexts/SudoPromptContext";
import { useCapabilities } from "@/contexts/CapabilitiesContext";
import { invalidateCapabilityProbeCache } from "@/lib/capabilityProbe";
import WhatsAppTerminal from "@/components/channels/WhatsAppTerminal";

type Step = 0 | 1 | 2 | 3;
type WaPairingPhase = "idle" | "runtime" | "bridge-deps" | "pairing";
type WaBaseline = {
  mode: string;
  allowedUsers: string;
};

interface ChannelWizardProps {
  channel: Channel;
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}

const openExternal = (url: string) => window.open(url, "_blank", "noopener,noreferrer");
const normalizeAllowedUsers = (value: string): string =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .sort()
    .join(",");

/** E.164: country code first, 7–15 digits total, no +. */
const E164_PHONE_ONLY = /^[1-9]\d{6,14}$/;

const stripAnsiLike = (value: string): string => {
  const ESC = String.fromCharCode(27);
  const BEL = String.fromCharCode(7);
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch !== ESC) {
      out += ch;
      continue;
    }
    const next = value[i + 1] || "";
    // CSI
    if (next === "[") {
      i += 2;
      while (i < value.length) {
        const code = value.charCodeAt(i);
        if (code >= 0x40 && code <= 0x7e) break;
        i += 1;
      }
      continue;
    }
    // OSC
    if (next === "]") {
      i += 2;
      while (i < value.length) {
        if (value[i] === BEL) break;
        if (value[i] === ESC && value[i + 1] === "\\") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    // Other one-char escape sequences.
    i += 1;
  }
  return out;
};

const ChannelWizard = ({ channel, open, onClose, onComplete }: ChannelWizardProps) => {
  const { refreshProbes } = useCapabilities();
  const bumpMessagingProbe = useCallback(() => {
    invalidateCapabilityProbeCache();
    void refreshProbes();
  }, [refreshProbes]);

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
  const [waTerminalRaw, setWaTerminalRaw] = useState("");
  const [waTerminalResetTick, setWaTerminalResetTick] = useState(0);
  const [waTerminalReady, setWaTerminalReady] = useState(false);
  const [waPairingError, setWaPairingError] = useState("");
  const [waPairPrereqChecked, setWaPairPrereqChecked] = useState(false);
  const [waPairPrereqOk, setWaPairPrereqOk] = useState(false);
  const [waPairPrereqDetail, setWaPairPrereqDetail] = useState("");
  const [waBaseline, setWaBaseline] = useState<WaBaseline | null>(null);
  const [waAwaitingResetConfirm, setWaAwaitingResetConfirm] = useState(false);
  const [waRetryReady, setWaRetryReady] = useState(false);
  const [waAutoFixing, setWaAutoFixing] = useState(false);
  const [waStatusHint, setWaStatusHint] = useState("");
  const waLastOutputAtRef = useRef(0);
  const waAutoPromptSeenRef = useRef<Set<string>>(new Set());
  const waDebugRunIdRef = useRef<string>("");
  const [setupToolsChecked, setSetupToolsChecked] = useState(false);
  const [setupToolsOk, setSetupToolsOk] = useState(false);
  const [setupToolsDetail, setSetupToolsDetail] = useState("");
  const [gatewayRefreshBusy, setGatewayRefreshBusy] = useState(false);
  const waLogBuffer = useRef("");
  const waStreamIdRef = useRef<string | null>(null);
  /** Prevents auto "Enable" from racing the mid-pairing gateway restart path. */
  const waWhatsAppFinalizeInFlightRef = useRef(false);
  const waWhatsAppFinalizeCompletedRef = useRef(false);
  /** One automatic QR start per wizard open while on the WhatsApp test step. */
  const waAutoPairAttemptedForSessionRef = useRef(false);
  const prevWhatsAppTestResultRef = useRef<"idle" | "ok" | "fail">("idle");
  const waLogEndRef = useRef<HTMLDivElement | null>(null);
  const { requestSudoPassword } = useSudoPrompt();

  /** Pre-existing channel state (from a prior install or earlier setup). */
  const [hadExistingConfig, setHadExistingConfig] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  /** Stale-session escape hatch for WhatsApp: surface "Force fresh QR pairing". */
  const [waStaleSessionDetected, setWaStaleSessionDetected] = useState(false);
  const [waForceFreshBusy, setWaForceFreshBusy] = useState(false);
  const [waRePairRestartBusy, setWaRePairRestartBusy] = useState(false);
  const [waRuntimeRepairBusy, setWaRuntimeRepairBusy] = useState(false);
  const [waBridgeInactiveHint, setWaBridgeInactiveHint] = useState("");
  /** Guard against double-click reentry before state updates land. */
  const resetInFlightRef = useRef(false);
  const startPairingInFlightRef = useRef(false);
  const forceFreshInFlightRef = useRef(false);
  const rePairRestartInFlightRef = useRef(false);
  const refreshGatewayInstallInFlightRef = useRef(false);

  // Pre-load any already-stored credentials so reconfiguring is friction-free.
  useEffect(() => {
    if (!open) return;
    setWaBridgeInactiveHint("");
    setStep(0);
    waWhatsAppFinalizeCompletedRef.current = false;
    setTestResult("idle");
    prevWhatsAppTestResultRef.current = "idle";
    setTestError("");
    setFormError("");
    setWaPairedChecked(false);
    setWaPaired(false);
    setWaPairingActive(false);
    setWaPairingPhase("idle");
    setWaPairingLines([]);
    setWaTerminalRaw("");
    setWaTerminalResetTick((n) => n + 1);
    setWaTerminalReady(false);
    setWaPairingError("");
    setWaPairPrereqChecked(false);
    setWaPairPrereqOk(false);
    setWaPairPrereqDetail("");
    setWaBaseline(null);
    setWaAwaitingResetConfirm(false);
    setWaRetryReady(false);
    setWaAutoFixing(false);
    setWaStatusHint("");
    setHadExistingConfig(false);
    setResetConfirmOpen(false);
    setResetting(false);
    setWaStaleSessionDetected(false);
    setWaForceFreshBusy(false);
    waAutoPromptSeenRef.current = new Set();
    setSetupToolsChecked(false);
    setSetupToolsOk(false);
    setSetupToolsDetail("");
    waLogBuffer.current = "";
    waStreamIdRef.current = null;
    let cancelled = false;
    (async () => {
      const env = await systemAPI.readEnvFile().catch(() => ({} as Record<string, string>));
      const requiredKeys = channel.credentials.filter((c) => !c.optional).map((c) => c.envVar);
      const wasConfigured = requiredKeys.length > 0 && requiredKeys.every(
        (k) => !!env[k] && env[k].trim().length > 0,
      );
      const next: Record<string, string> = {};
      for (const cred of channel.credentials) {
        const existing = await systemAPI.secrets.get(cred.envVar);
        // For hidden creds, always use defaultValue (auto). For choice, fall
        // back to defaultValue when nothing is stored yet.
        if (cred.kind === "hidden") {
          next[cred.envVar] = cred.defaultValue ?? "";
        } else if (cred.kind === "choice") {
          const fromEnvChoice = (env[cred.envVar] || "").trim();
          next[cred.envVar] = existing || fromEnvChoice || cred.defaultValue || cred.choices?.[0]?.value || "";
        } else {
          const fromEnv = (env[cred.envVar] || "").trim();
          next[cred.envVar] = existing || fromEnv || cred.defaultValue || "";
        }
      }
      if (!cancelled) {
        setValues(next);
        setHadExistingConfig(wasConfigured);
        if (channel.id === "whatsapp") {
          setWaBaseline({
            mode: (next.WHATSAPP_MODE || "").trim(),
            allowedUsers: normalizeAllowedUsers(next.WHATSAPP_ALLOWED_USERS || ""),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, channel]);

  const visibleCredentials = useMemo(() => {
    const v = channel.credentials.filter((c) => c.kind !== "hidden");
    if (channel.id === "whatsapp") {
      return v.filter((c) => c.envVar !== "WHATSAPP_ALLOWED_USERS");
    }
    return v;
  }, [channel.credentials, channel.id]);

  /** WhatsApp skips the generic “get credentials” checklist step (old step 1). */
  const { waShortWizard, maxStep, totalSteps, credStep, testStep } = useMemo(() => {
    const wa = channel.id === "whatsapp";
    const ms = wa ? 2 : 3;
    return {
      waShortWizard: wa,
      maxStep: ms,
      totalSteps: ms + 1,
      credStep: wa ? 1 : 2,
      testStep: wa ? 2 : 3,
    };
  }, [channel.id]);

  const emitWaDebugLog = useCallback((hypothesisId: string, location: string, message: string, data: Record<string, unknown>) => {
    // #region agent log
    fetch("http://127.0.0.1:7544/ingest/13d5d95c-e042-47dd-9c7b-02723faafae2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "8f17d1",
      },
      body: JSON.stringify({
        sessionId: "8f17d1",
        runId: waDebugRunIdRef.current || "unset",
        hypothesisId,
        location,
        message,
        data,
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }, []);

  const requiredFilled = useMemo(() => {
    const base = channel.credentials.every((c) => c.optional || (values[c.envVar] || "").trim().length > 0);
    if (channel.id !== "whatsapp") return base;
    const raw = (values.WHATSAPP_ALLOWED_USERS || "").trim();
    const entries = raw.split(",").map((p) => p.trim()).filter(Boolean);
    if (entries.length === 0) return false;
    return base && entries.every((n) => E164_PHONE_ONLY.test(n));
  }, [channel.credentials, channel.id, values]);
  const waModeCurrent = (values.WHATSAPP_MODE || "").trim();
  const waAllowedUsersCurrent = normalizeAllowedUsers(values.WHATSAPP_ALLOWED_USERS || "");
  const waHasModeChange = !!waBaseline && waBaseline.mode !== waModeCurrent;
  const waHasAllowlistChange = !!waBaseline && waBaseline.allowedUsers !== waAllowedUsersCurrent;
  const waRequiresSessionReset = waPaired && (waHasModeChange || waHasAllowlistChange);

  const appendWaPairingChunk = useCallback((event: { type: string; data?: string }) => {
    if ((event.type !== "stdout" && event.type !== "stderr") || !event.data) return;
    // #region agent log
    emitWaDebugLog("H1", "ChannelWizard.tsx:appendWaPairingChunk:start", "chunk received", {
      eventType: event.type,
      streamId: waStreamIdRef.current,
      chunkLen: event.data.length,
      hasRepairWord: /repair\?/i.test(event.data),
      hasYesNo: /\[[Yy]\/[Nn]\]|\(y\/N\)|\[y\/n\]/i.test(event.data),
    });
    // #endregion
    waLastOutputAtRef.current = Date.now();
    const displayData = event.data.replace(/(?:^|\r?\n)[^\r\n]*(?:\[[Yy]\/[Nn]\]|\(y\/N\)|\[y\/n\])[^\r\n]*/g, "");
    setWaTerminalRaw((prev) => {
      const next = prev + displayData;
      return next.length > 220000 ? next.slice(-220000) : next;
    });
    const cleanedData = stripAnsiLike(event.data).replace(/\u200b/g, "");
    // Detect Baileys / Hermes signals that an old session is being resumed
    // instead of generating a fresh QR. We surface a "Force fresh QR pairing"
    // button so the user is not stuck waiting for a QR that will never appear.
    if (
      /found existing session/i.test(cleanedData) ||
      /restoring session/i.test(cleanedData) ||
      /resuming session/i.test(cleanedData) ||
      /existing auth state/i.test(cleanedData) ||
      /already linked/i.test(cleanedData)
    ) {
      setWaStaleSessionDetected(true);
    }
    if (cleanedData.includes("[process] Command timed out")) {
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
      setWaRetryReady(true);
      setWaPairingPhase("idle");
      // If the timeout happened during pairing AND we never saw QR output, the
      // most likely cause is a stale session — invite the user to force-clear.
      // Dependency-install timeouts are a separate (npm/network) failure mode
      // and must NOT trigger the stale-session escape hatch.
      if (waPairingPhase === "pairing") {
        setWaStaleSessionDetected(true);
      }
    }
    waLogBuffer.current += cleanedData.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    // #region agent log
    emitWaDebugLog("H2", "ChannelWizard.tsx:appendWaPairingChunk:buffer", "buffer state before split", {
      streamId: waStreamIdRef.current,
      bufferLen: waLogBuffer.current.length,
      bufferHasRepairPrompt: /repair\?/i.test(waLogBuffer.current) && /\[[Yy]\/[Nn]\]|\(y\/N\)|\[y\/n\]/i.test(waLogBuffer.current),
      bufferEndsWithNewline: waLogBuffer.current.endsWith("\n"),
    });
    // #endregion
    const parts = waLogBuffer.current.split("\n");
    waLogBuffer.current = parts.pop() ?? "";
    const handleYesNoPrompt = (candidate: string) => {
      const trimmed = candidate.trim();
      if (!trimmed) return;
      const hasYesNoPrompt = /\[[Yy]\/[Nn]\]/.test(trimmed) || /\(y\/N\)/.test(trimmed) || /\[y\/n\]/i.test(trimmed);
      if (!hasYesNoPrompt) return;
      // #region agent log
      emitWaDebugLog("H6", "ChannelWizard.tsx:appendWaPairingChunk:promptText", "yes/no prompt candidate", {
        streamId: waStreamIdRef.current,
        promptText: trimmed.slice(0, 220),
      });
      // #endregion
      const id = waStreamIdRef.current;
      if (!id) return;
      if (/repair\?/i.test(trimmed) || (/existing session/i.test(trimmed) && /clear/i.test(trimmed))) {
        // #region agent log
        emitWaDebugLog("H3", "ChannelWizard.tsx:appendWaPairingChunk:repair", "auto-answer repair prompt", {
          streamId: id,
          prompt: trimmed,
          answer: "y\\r",
        });
        // #endregion
        void (async () => {
          const writeResult = await systemAPI.writeStreamStdin(id, "y\r");
          // #region agent log
          emitWaDebugLog("H3", "ChannelWizard.tsx:appendWaPairingChunk:repair:result", "repair prompt write result", {
            streamId: id,
            success: writeResult.success,
            error: writeResult.error || "",
          });
          // #endregion
        })();
        setWaStatusHint("Repair confirmed automatically; continuing pairing.");
        return;
      }
      if (waAutoPromptSeenRef.current.has(trimmed)) return;
      waAutoPromptSeenRef.current.add(trimmed);
      if (/update allowed users\?/i.test(trimmed)) {
        // #region agent log
        emitWaDebugLog("H6", "ChannelWizard.tsx:appendWaPairingChunk:allowUsers", "auto-answer allow users prompt", {
          streamId: id,
          prompt: trimmed,
          answer: "n",
        });
        // #endregion
        void systemAPI.writeStreamStdin(id, "n\n");
        setWaStatusHint("Skipped optional allowed-users update; continuing pairing.");
        return;
      }
      // #region agent log
      emitWaDebugLog("H6", "ChannelWizard.tsx:appendWaPairingChunk:defaultNo", "auto-answer default no prompt", {
        streamId: id,
        prompt: trimmed,
        answer: "n",
      });
      // #endregion
      void systemAPI.writeStreamStdin(id, "n\n");
      setWaStatusHint("Answered a setup prompt automatically to keep pairing moving.");
    };
    for (const line of parts) {
      handleYesNoPrompt(line);
    }
    // Handle prompts that are emitted without a trailing newline (common for interactive [y/n] prompts).
    if (waLogBuffer.current) {
      // #region agent log
      emitWaDebugLog("H2", "ChannelWizard.tsx:appendWaPairingChunk:tail", "checking unterminated tail for prompt", {
        streamId: waStreamIdRef.current,
        tailLen: waLogBuffer.current.length,
        tailHasYesNo: /\[[Yy]\/[Nn]\]|\(y\/N\)|\[y\/n\]/i.test(waLogBuffer.current),
        tailHasRepair: /repair\?/i.test(waLogBuffer.current),
      });
      // #endregion
      handleYesNoPrompt(waLogBuffer.current);
    }
    const visibleParts = parts.filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      const hasYesNoPrompt = /\[[Yy]\/[Nn]\]/.test(trimmed) || /\(y\/N\)/.test(trimmed) || /\[y\/n\]/i.test(trimmed);
      return !hasYesNoPrompt;
    });
    setWaPairingLines((prev) => [...prev, ...visibleParts].slice(-400));
  }, [emitWaDebugLog, waPairingPhase]);

  const saveCredentials = async (): Promise<boolean> => {
    setSaving(true);
    try {
      if (channel.id === "whatsapp") {
        const entries = (values.WHATSAPP_ALLOWED_USERS || "")
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean);
        if (entries.length === 0 || !entries.every((n) => E164_PHONE_ONLY.test(n))) {
          const msg =
            "Enter one or more E.164 numbers (digits only, country code first), comma-separated. Example: 15551234567,447700900123";
          setFormError(msg);
          toast.error("Valid allowlist required", { description: msg });
          return false;
        }
        await systemAPI.secrets.delete("WHATSAPP_ALLOW_ALL_USERS").catch(() => false);
        const normalized = entries.join(",");
        const okPhone = await systemAPI.secrets.set("WHATSAPP_ALLOWED_USERS", normalized);
        if (!okPhone) {
          setFormError("Failed to save WhatsApp allowed users");
          toast.error("Failed to save WhatsApp allowed users");
          return false;
        }
        // Hard-set required WhatsApp runtime keys so materializeEnv cannot
        // produce an incomplete channel config if hidden/choice fields drift.
        const mode = (values.WHATSAPP_MODE || "self-chat").trim() || "self-chat";
        const okEnabled = await systemAPI.secrets.set("WHATSAPP_ENABLED", "true");
        const okMode = await systemAPI.secrets.set("WHATSAPP_MODE", mode);
        if (!okEnabled || !okMode) {
          setFormError("Failed to save WhatsApp runtime mode");
          toast.error("Failed to save WhatsApp runtime mode");
          return false;
        }
        await systemAPI.secrets.set("WHATSAPP_DEBUG", "true").catch(() => false);
      }

      const skipInLoop =
        channel.id === "whatsapp" ? new Set<string>(["WHATSAPP_ALLOWED_USERS"]) : new Set<string>();

      for (const cred of channel.credentials) {
        if (skipInLoop.has(cred.envVar)) continue;
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
      // Push secrets into ~/.hermes/.env so the gateway can read them (Hermes-managed keys).
      await systemAPI.materializeEnv();
      if (channel.id === "whatsapp") {
        const verifyEnabled = (await systemAPI.secrets.get("WHATSAPP_ENABLED")).trim().toLowerCase();
        const verifyMode = (await systemAPI.secrets.get("WHATSAPP_MODE")).trim();
        const verifyAllow = (await systemAPI.secrets.get("WHATSAPP_ALLOWED_USERS")).trim();
        if (verifyEnabled !== "true" || !verifyMode || !verifyAllow) {
          const msg = "WhatsApp credentials were not persisted to secure storage. Please retry setup.";
          setFormError(msg);
          toast.error("WhatsApp secrets missing", { description: msg });
          return false;
        }
      }
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
        const bridge = await systemAPI.getWhatsAppBridgeStatus();
        const sessionOk = !!(paired.success && paired.paired);
        const bridgeOk = !!(bridge.success && bridge.running && bridge.whatsappActive);
        if (!sessionOk && !bridgeOk) {
          if (!paired.success) {
            setTestResult("fail");
            setTestError(paired.error || "Couldn't verify WhatsApp pairing.");
            return;
          }
          setTestResult("fail");
          setTestError(
            "WhatsApp is not linked yet, or the bridge is not connected. Use “Start QR pairing” above, scan with your phone, then try again.",
          );
          return;
        }
      }
      const r = await systemAPI.testChannel(channel.id);
      if (r.success) {
        setTestResult("ok");
        return true;
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
      return false;
    } catch (e) {
      setTestResult("fail");
      setTestError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setTesting(false);
    }
  }, [channel]);

  const beginWhatsAppFinalize = useCallback((): boolean => {
    if (channel.id !== "whatsapp") return false;
    if (!open || step !== testStep) return false;
    if (waWhatsAppFinalizeCompletedRef.current) return false;
    if (waWhatsAppFinalizeInFlightRef.current) return false;
    waWhatsAppFinalizeInFlightRef.current = true;
    return true;
  }, [channel.id, open, step, testStep]);

  /** Stop/start gateway so a new WhatsApp session is picked up (shared by pairing completion + manual button). */
  const restartWhatsAppGatewayWithNewSession = useCallback(async (): Promise<"live" | "fail"> => {
    setWaBridgeInactiveHint("");
    setWaStatusHint("Checking runtime routing…");
    const platform = await systemAPI.getPlatform().catch(() => null);
    if (platform?.isWindows) {
      const probe = await systemAPI.runCommand('wsl bash -lc "echo RONBOT_WSL_OK"', {
        timeout: 10000,
        displayCommand: "wsl routing probe",
      });
      const out = `${probe.stdout || ""}\n${probe.stderr || ""}`;
      if (!probe.success || !/RONBOT_WSL_OK/.test(out)) {
        const detail =
          "Windows desktop could not run Hermes through WSL. Open a terminal and run `wsl --status`, then retry WhatsApp setup.";
        setFormError(detail);
        setWaStatusHint("");
        toast.error("WSL routing check failed", { description: detail });
        return "fail";
      }
    }
    await systemAPI.materializeEnv().catch(() => undefined);
    // Make sure the gateway will spawn the Baileys bridge with the managed
    // Node v20 runtime. Without this, systems with system Node 18.x crash
    // the bridge in a loop with `Cannot destructure property 'subtle' of
    // globalThis.crypto` and the channel never goes live.
    setWaStatusHint("Preparing managed Node runtime for the WhatsApp bridge…");
    const nodePrep = await systemAPI.ensureWhatsAppManagedNode().catch((e) => ({
      success: false,
      error: e instanceof Error ? e.message : String(e),
    }));
    if (!nodePrep.success) {
      setWaStatusHint("");
      const detail =
        nodePrep.error ||
        "Could not prepare the managed Node runtime for WhatsApp. Re-run the WhatsApp setup wizard so Ronbot reinstalls Node v20.";
      setFormError(detail);
      toast.error("WhatsApp bridge runtime not ready", { description: detail });
      return "fail";
    }
    setWaStatusHint("Stopping and replacing messaging gateway…");
    // Kill any crash-looping gateway-managed bridge before we stop the
    // service, otherwise systemd/launchd respawns it on the wrong Node.
    await systemAPI
      .terminateWhatsAppPairingProcesses({ includeGatewayBridge: true })
      .catch(() => undefined);
    await systemAPI.stopGateway().catch(() => undefined);
    // Rotate stale bridge/gateway logs so the failure classifier below reads
    // only post-restart output instead of pre-fix Node 18 stack traces.
    await systemAPI.rotateWhatsAppBridgeLogs().catch(() => undefined);
    await systemAPI.materializeEnv().catch(() => undefined);
    await systemAPI.refreshGatewayInstall().catch(() => undefined);
    // Re-apply patches AFTER refreshGatewayInstall (which rewrites the unit).
    await systemAPI.patchGatewayServicePathForWhatsApp().catch(() => undefined);
    await systemAPI.patchHermesWhatsAppAdapterForNode().catch(() => undefined);
    const recoverySteps: string[] = [];
    let r = await systemAPI.startGateway();
    if (!r.success) {
      const combined = `${r.stdout || ""}\n${r.stderr || ""}`;
      const signals = systemAPI.parseGatewayStartupRecoverySignals(combined);
      if (signals.slackConflict.hasConflict && signals.slackConflict.pid) {
        setWaStatusHint("Detected Slack token conflict, stopping old gateway process and retrying…");
        const terminated = await systemAPI.terminateConflictingGatewayProcess(signals.slackConflict.pid, "slack-token-lock");
        if (terminated.terminated) {
          recoverySteps.push(`Auto-stopped conflicting Slack PID ${signals.slackConflict.pid}.`);
          r = await systemAPI.startGateway();
        } else {
          recoverySteps.push(`Detected Slack token conflict, but PID ${signals.slackConflict.pid} could not be stopped.`);
        }
      }
      if (!r.success) {
        const retryCombined = `${r.stdout || ""}\n${r.stderr || ""}`;
        const retrySignals = systemAPI.parseGatewayStartupRecoverySignals(retryCombined);
        if (retrySignals.whatsappRuntimeMissing) {
          setWaStatusHint("Detected WhatsApp bridge runtime issue, applying runtime repair and retrying…");
          const repaired = await systemAPI.repairWhatsAppGatewayRuntime().catch(() => ({ ok: false }));
          recoverySteps.push(
            repaired.ok
              ? "Ran WhatsApp runtime repair."
              : "Attempted WhatsApp runtime repair, but it did not complete.",
          );
          if (repaired.ok) {
            r = await systemAPI.startGateway();
          }
        }
      }
    }
    if (!r.success) {
      const combined = `${r.stdout || ""}\n${r.stderr || ""}`;
      const lower = combined.toLowerCase();
      let detail = r.stderr?.split("\n")[0] || "Check Logs for details.";
      if (lower.includes("gateway setup") || lower.includes("select [1-18]") || lower.includes("please enter a number")) {
        detail =
          "Gateway entered an interactive setup screen, which this wizard cannot use. Ronbot now avoids this path; retry once. If it persists, open App Diagnostics.";
      } else if (lower.includes("already running")) {
        detail =
          "Gateway was already running and could not be replaced automatically. Retry finalization; if it repeats, reset WhatsApp and run setup again.";
      } else if (lower.includes("slack app token already in use") || lower.includes("non-retryable startup conflict")) {
        detail =
          "Gateway startup is blocked by a Slack token lock from another running process. Ronbot attempted auto-recovery once, but the lock is still active. Stop the other gateway process and retry.";
      } else if (lower.includes("node.js not installed or bridge not configured") || lower.includes("no adapter available for whatsapp")) {
        detail =
          "WhatsApp bridge runtime is still not configured for the shared gateway. Ronbot attempted runtime repair once.\nNext steps: re-run WhatsApp pairing, verify ~/.hermes/platforms/whatsapp/session is writable, then refresh gateway install metadata and retry.";
      } else if (lower.includes("wsl") && lower.includes("not available")) {
        detail =
          "WSL gateway route is unavailable. Verify WSL is installed/running (`wsl --status`), then retry WhatsApp setup.";
      }
      const traceBlock = recoverySteps.length ? `\n\nRecovery attempts:\n- ${recoverySteps.join("\n- ")}` : "";
      setFormError(detail + traceBlock);
      setWaStatusHint("");
      toast.error("Failed to start gateway", { description: detail });
      return "fail";
    }
    setWaStatusHint("Verifying WhatsApp bridge connection…");
    const deadline = Date.now() + 150000;
    let lastHealth: Awaited<ReturnType<typeof systemAPI.getWhatsAppBridgeStatus>> | null = null;
    const otherPlatformWarnings = new Set<string>();
    while (Date.now() < deadline) {
      const h = await systemAPI.getWhatsAppBridgeStatus();
      lastHealth = h;
      (h.nonWhatsappWarnings || []).forEach((line) => otherPlatformWarnings.add(line));
      if (h.running && h.nonWhatsappWarnings?.length && !h.whatsappActive) {
        setWaStatusHint("Gateway started with unrelated platform warnings; waiting for WhatsApp adapter…");
      }
      if (h.fatalWhatsappReason) break;
      if (h.running && h.whatsappActive) break;
      await new Promise((res) => setTimeout(res, 2500));
    }
    setWaStatusHint("");
    if (lastHealth?.running && lastHealth.whatsappActive) {
      setFormError("");
      return "live";
    }
    // Inspect the bridge log for the well-known Node-version crash signature
    // and surface a clear, actionable message instead of a wall of stack traces.
    const failure = await systemAPI
      .classifyWhatsAppBridgeFailure()
      .catch(() => ({ kind: "unknown" as const }));
    const diag = await systemAPI
      .getWhatsAppRuntimeDiagnostic()
      .catch(() => null);
    const tail = (lastHealth?.bridgeLogTail || lastHealth?.statusOutput || "").trim();
    const logR = await systemAPI.readWhatsAppBridgeLogTail(100);
    const hint = (logR.content || tail).split("\n").slice(-20).join("\n").trim();
    setWaBridgeInactiveHint(hint);
    let detail: string;
    if (failure.kind === "node-version" || diag?.bridgeLogShowsNode18) {
      const reasons: string[] = [];
      if (diag) {
        if (!diag.shimVersion || diag.shimVersion === "missing") {
          reasons.push("• Managed Node v20 shim is missing at ~/.hermes/bin/node.");
        } else if (!/^v2[0-9]/.test(diag.shimVersion)) {
          reasons.push(`• Managed Node shim reports ${diag.shimVersion} (need v20+).`);
        }
        if (!diag.serviceUnitPathStartsWithShim && diag.serviceUnitPath) {
          reasons.push(`• Gateway service PATH does not start with ~/.hermes/bin (${diag.serviceUnitPath}).`);
        }
        if (!diag.adapterPatched) {
          reasons.push("• Installed Hermes WhatsApp adapter still launches the bridge with bare 'node'.");
        }
      }
      detail =
        `WhatsApp bridge keeps crashing on Node ${failure.nodeVersion ?? "18.x"} — Baileys needs Node 20+. ` +
        `Click "Re-pair + Restart" to apply the runtime fix.` +
        (reasons.length ? `\n\nDiagnostics:\n${reasons.join("\n")}` : "");
    } else if (lastHealth?.fatalWhatsappReason === "adapter-missing" || failure.kind === "adapter-missing") {
      detail = `WhatsApp adapter is missing from the running gateway.\n${lastHealth?.fatalWhatsappSnippet || failure.snippet || "No adapter available for whatsapp."}`;
    } else if (lastHealth?.fatalWhatsappReason === "bridge-not-configured" || failure.kind === "bridge-not-configured") {
      detail =
        `WhatsApp bridge runtime is not configured on this machine.\n${lastHealth?.fatalWhatsappSnippet || failure.snippet || "WhatsApp: Node.js not installed or bridge not configured."}`;
    } else {
      const combinedHint = `${tail}\n${hint}`.toLowerCase();
      if (
        combinedHint.includes("gateway setup") ||
        combinedHint.includes("select [1-18]") ||
        combinedHint.includes("please enter a number")
      ) {
        detail =
          "Could not confirm WhatsApp because gateway startup entered interactive setup unexpectedly. Retry once; if it repeats, open App Diagnostics and reset WhatsApp.";
      } else if (combinedHint.includes("already running")) {
        detail =
          "Could not confirm WhatsApp because a previous gateway process was still active and blocked replacement. Retry finalization once.";
      } else {
        detail = hint
          ? `Could not confirm WhatsApp after starting the gateway.\nWhatsApp status:\n${hint.split("\n").slice(-10).join("\n")}`
          : "Could not confirm WhatsApp after starting the gateway. Try pairing again.";
      }
    }
    const nonWhatsapp = Array.from(otherPlatformWarnings).slice(-8);
    const nonWhatsappBlock = nonWhatsapp.length
      ? `\n\nOther platform warnings (informational):\n${nonWhatsapp.join("\n")}`
      : "";
    const traceBlock = recoverySteps.length ? `\n\nRecovery attempts:\n- ${recoverySteps.join("\n- ")}` : "";
    setFormError(
      detail +
      traceBlock +
      nonWhatsappBlock +
      (logR.content ? `\n\n${logR.content.split("\n").slice(-24).join("\n")}` : ""),
    );
    toast.error("WhatsApp bridge not confirmed", {
      description:
        failure.kind === "node-version" || diag?.bridgeLogShowsNode18
          ? "Bridge crashed on Node 18 — click Re-pair + Restart to apply the runtime fix."
          : "Try Re-pair + Restart.",
    });
    return "fail";
  }, []);

  /** Final step: tools for credential tests + WhatsApp pairing prereqs (npm, script) + session */
  useEffect(() => {
    if (!open || step !== testStep) return;
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
  }, [open, step, channel.id, testStep]);

  useEffect(() => {
    waLogEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [waPairingLines]);

  /** Stop Hermes pairing if the user closes the wizard mid-stream */
  useEffect(() => {
    if (open) return;
    waAutoPairAttemptedForSessionRef.current = false;
    prevWhatsAppTestResultRef.current = "idle";
    waWhatsAppFinalizeInFlightRef.current = false;
    waWhatsAppFinalizeCompletedRef.current = false;
    const id = waStreamIdRef.current;
    if (id) {
      void systemAPI.killStream(id);
      waStreamIdRef.current = null;
    }
    void systemAPI.terminateWhatsAppPairingProcesses().catch(() => undefined);
  }, [open]);

  /** Clear wizard-only WHATSAPP_DEBUG on close. */
  useEffect(() => {
    if (open || channel.id !== "whatsapp") return;
    void (async () => {
      await systemAPI.secrets.delete("WHATSAPP_DEBUG").catch(() => false);
      await systemAPI.materializeEnv().catch(() => undefined);
    })();
  }, [open, channel.id]);

  useEffect(() => {
    if (!open || step !== testStep || testing) return;
    if (!setupToolsChecked || !setupToolsOk) return;
    if (channel.id === "whatsapp") {
      if (!waPairedChecked) return;
      if (waRequiresSessionReset || waAwaitingResetConfirm) return;
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
    waRequiresSessionReset,
    waAwaitingResetConfirm,
    setupToolsChecked,
    setupToolsOk,
    testResult,
    testing,
    runTest,
    testStep,
  ]);

  const startWaPairing = async (resetSessionFirst: boolean) => {
    if (startPairingInFlightRef.current) return;
    startPairingInFlightRef.current = true;
    waDebugRunIdRef.current = `wa-${Date.now()}`;
    // #region agent log
    emitWaDebugLog("H4", "ChannelWizard.tsx:startWaPairing:start", "start pairing requested", {
      runId: waDebugRunIdRef.current,
      prereqChecked: waPairPrereqChecked,
      prereqOk: waPairPrereqOk,
      waPaired,
      waRequiresSessionReset,
      resetSessionFirst,
    });
    // #endregion
    setWaPairingError("");
    setWaRetryReady(false);
    waLogBuffer.current = "";
    setWaPairingLines([]);
    setWaTerminalRaw("");
    setWaTerminalResetTick((n) => n + 1);
    setWaStatusHint("");
    waLastOutputAtRef.current = Date.now();
    setWaPairingActive(true);
    setWaPairingPhase("runtime");
    waStreamIdRef.current = null;
    try {
      await systemAPI.terminateWhatsAppPairingProcesses().catch(() => undefined);
      if (waPairPrereqChecked && !waPairPrereqOk) {
        const fixed = await autoFixWhatsAppPairingTools();
        if (!fixed) return;
      }
      await systemAPI.materializeEnv().catch(() => undefined);
      setWaPairingPhase("runtime");
      setWaStatusHint("Refreshing gateway PATH automatically…");
      // Best-effort: `hermes gateway install` may fail on systems without
      // `systemctl --user` (e.g. macOS, headless Linux without a user bus).
      // The Node shim + adapter patch are applied regardless, so we treat
      // this as a soft warning and continue to bridge-deps/pairing instead
      // of blocking the QR code from ever appearing.
      const refresh = await systemAPI.refreshGatewayInstall();
      if (!refresh.success) {
        const detail = refresh.stderr?.split("\n")[0] || refresh.stdout?.split("\n")[0] || "";
        if (detail) {
          appendWaPairingChunk({ type: "stderr", data: `[ronbot] gateway refresh skipped: ${detail}\n` });
        }
        toast.message("Gateway PATH refresh skipped", {
          description: detail || "Continuing with managed Node shim and adapter patch.",
        });
      }
      setWaPairingPhase("bridge-deps");
      setWaStatusHint(
        "Installing WhatsApp bridge dependencies. First-time install can take several minutes and needs internet access to the npm registry.",
      );
      const bridge = await systemAPI.ensureWhatsAppBridgeDeps(appendWaPairingChunk, {
        onStreamId: (id: string) => {
          waStreamIdRef.current = id;
          // #region agent log
          emitWaDebugLog("H1", "ChannelWizard.tsx:startWaPairing:bridgeStream", "bridge deps stream id assigned", { streamId: id });
          // #endregion
        },
      });
      if (!bridge.success) {
        const detail = [bridge.stderr, bridge.stdout].filter(Boolean).join("\n").trim();
        setWaPairingError(
          detail ||
            "Could not repair WhatsApp bridge dependencies. This is usually a network or npm registry issue — check internet access and try again.",
        );
        toast.error("WhatsApp dependency repair failed", {
          description: detail.split("\n")[0] || "Check internet access and try again.",
        });
        setWaRetryReady(true);
        setWaPairingActive(false);
        setWaPairingPhase("idle");
        return;
      }
      if (resetSessionFirst) {
        const cleared = await systemAPI.clearWhatsAppSession();
        // #region agent log
        emitWaDebugLog("H8", "ChannelWizard.tsx:startWaPairing:clearSession", "local WhatsApp session cleanup before pairing", {
          success: cleared.success,
          before: cleared.before,
          removed: cleared.removed,
          stderr: cleared.stderr || "",
        });
        // #endregion
        if (!cleared.success) {
          const msg = cleared.stderr || "Could not clear old WhatsApp session files.";
          setWaPairingError(msg);
          toast.error("Could not prepare clean WhatsApp session", {
            description: msg.split("\n")[0] || "Try again and check file permissions.",
          });
          setWaPairingPhase("idle");
          return;
        }
        if (cleared.before > 0 && cleared.removed <= 0) {
          const msg = "Ronbot could not remove the previous WhatsApp session files.";
          setWaPairingError(msg);
          toast.error("Could not prepare clean WhatsApp session", {
            description: "Close any running WhatsApp bridge session and try again.",
          });
          setWaPairingPhase("idle");
          return;
        }
      }
      const sessionState = await systemAPI.getWhatsAppSessionFileCount();
      // #region agent log
      emitWaDebugLog("H9", "ChannelWizard.tsx:startWaPairing:sessionCount", "session count from primary path", {
        success: sessionState.success,
        count: sessionState.count,
        error: sessionState.error || "",
      });
      // #endregion
      if (!sessionState.success) {
        setWaPairingError(sessionState.error || "Could not inspect WhatsApp session state.");
        setWaPairingPhase("idle");
        return;
      }
      if (!resetSessionFirst && sessionState.count > 0) {
        setWaAwaitingResetConfirm(true);
        setWaPairingError("Ronbot detected an existing local WhatsApp session. Confirm relink to replace it and continue.");
        setWaPairingPhase("idle");
        return;
      }
      setWaPairingPhase("pairing");
      setWaStatusHint("Waiting for WhatsApp QR output from Ronbot…");
      await systemAPI.runWhatsAppPairing(appendWaPairingChunk, {
        onStreamId: (id) => {
          waStreamIdRef.current = id;
          // #region agent log
          emitWaDebugLog("H1", "ChannelWizard.tsx:startWaPairing:pairStream", "pairing stream id assigned", { streamId: id });
          // #endregion
        },
      });
    } catch (e) {
      // #region agent log
      emitWaDebugLog("H5", "ChannelWizard.tsx:startWaPairing:catch", "start pairing threw", {
        error: e instanceof Error ? e.message : String(e),
        phase: waPairingPhase,
      });
      // #endregion
      setWaPairingError(e instanceof Error ? e.message : String(e));
      setWaRetryReady(true);
    } finally {
      startPairingInFlightRef.current = false;
      // #region agent log
      emitWaDebugLog("H5", "ChannelWizard.tsx:startWaPairing:finally", "start pairing finalized", {
        streamId: waStreamIdRef.current,
        phase: waPairingPhase,
        bufferedTailLen: waLogBuffer.current.length,
      });
      // #endregion
      setWaPairingActive(false);
      setWaPairingPhase("idle");
      setWaStatusHint("");
      waStreamIdRef.current = null;
      const tail = waLogBuffer.current.trimEnd();
      if (tail) {
        const hasYesNoPrompt = /\[[Yy]\/[Nn]\]/.test(tail) || /\(y\/N\)/.test(tail) || /\[y\/n\]/i.test(tail);
        if (!hasYesNoPrompt) {
          setWaPairingLines((prev) => [...prev, tail].slice(-400));
        }
        waLogBuffer.current = "";
      }
    }
    const paired = await systemAPI.isWhatsAppPaired();
    if (paired.success && paired.paired) {
      setWaPaired(true);
      setWaAwaitingResetConfirm(false);
      setWaBaseline({
        mode: waModeCurrent,
        allowedUsers: waAllowedUsersCurrent,
      });
      toast.success("WhatsApp linked");
      if (!beginWhatsAppFinalize()) return;
      try {
        // Make absolutely sure WHATSAPP_ENABLED=true (and the access keys) are
        // in ~/.hermes/.env BEFORE we ask the gateway to start. Without this
        // the gateway boots without WhatsApp and `hermes gateway status` will
        // silently omit it — the user only finds out by messaging the agent.
        await systemAPI.materializeEnv().catch(() => undefined);
        const env = await systemAPI.readEnvFile().catch(() => ({} as Record<string, string>));
        if ((env.WHATSAPP_ENABLED || "").trim().toLowerCase() !== "true") {
          setWaPairingError(
            "WhatsApp credentials saved, but WHATSAPP_ENABLED=true is missing from ~/.hermes/.env. Try reconfiguring the channel — Ronbot will rewrite the env file.",
          );
          setWaRetryReady(true);
          return;
        }
        const testOk = await runTest();
        if (!testOk) return;
        let outcome = await restartWhatsAppGatewayWithNewSession();
        if (outcome === "fail") {
          // First failure on finalize is almost always the Node 18 / Baileys
          // crypto.subtle crash. Run the atomic runtime repair and retry
          // ONCE before surfacing the error and leaving the wizard open.
          const failure = await systemAPI.classifyWhatsAppBridgeFailure().catch(() => ({ kind: "unknown" as const }));
          const diag = await systemAPI.getWhatsAppRuntimeDiagnostic().catch(() => null);
          if (failure.kind === "node-version" || diag?.bridgeLogShowsNode18) {
            toast.message("Repairing WhatsApp bridge runtime…", { description: "Re-applying Node v20 shim and gateway service overrides." });
            await systemAPI.repairWhatsAppGatewayRuntime(appendWaPairingChunk).catch(() => undefined);
            outcome = await restartWhatsAppGatewayWithNewSession();
          }
          if (outcome === "fail") {
            setTestResult("fail");
            return;
          }
        }
        bumpMessagingProbe();
        waWhatsAppFinalizeCompletedRef.current = true;
        setWaBridgeInactiveHint("");
        toast.success(`${channel.name} channel enabled`, {
          description: "WhatsApp is now active. You can communicate with your agent using WhatsApp.",
        });
        onComplete();
        onClose();
      } finally {
        waWhatsAppFinalizeInFlightRef.current = false;
      }
    } else if (!paired.success) {
      setWaPairingError(paired.error || "Could not verify WhatsApp pairing.");
      setWaRetryReady(true);
    } else {
      setWaPairingError(
        "Pairing closed before a session was saved. Check the log for errors, or try Start QR pairing again after scanning.",
      );
      setWaRetryReady(true);
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

  const requestWaPairingStart = async () => {
    if (startPairingInFlightRef.current) return;
    if (waRequiresSessionReset && !waAwaitingResetConfirm) {
      setWaAwaitingResetConfirm(true);
      return;
    }
    if (waRequiresSessionReset && waAwaitingResetConfirm) {
      setWaAwaitingResetConfirm(false);
      await startWaPairing(true);
      return;
    }
    await startWaPairing(false);
  };

  const cancelWaPairing = async () => {
    if (startPairingInFlightRef.current) return;
    const id = waStreamIdRef.current;
    setWaPairingActive(false);
    setWaPairingPhase("idle");
    setWaStatusHint("");
    setWaRetryReady(true);
    waStreamIdRef.current = null;
    if (id) {
      await systemAPI.killStream(id);
    }
    await systemAPI.terminateWhatsAppPairingProcesses().catch(() => undefined);
  };

  const handleRePairAndRestart = async () => {
    if (rePairRestartInFlightRef.current) return;
    if (channel.id !== "whatsapp") return;
    rePairRestartInFlightRef.current = true;
    setWaRePairRestartBusy(true);
    setWaBridgeInactiveHint("");
    try {
      // 1. Atomic runtime repair: install Node v20, write shims (with the
      // literal "$@" fix), drop systemd override, patch adapter, rotate
      // logs, restart gateway, verify gateway PID actually has the shim
      // dir on its captured PATH. This addresses the recurring case where
      // the user clicks Re-pair + Restart but the bridge keeps crashing
      // on Node 18 because the gateway service PATH was not refreshed.
      appendWaPairingChunk({ type: "stdout", data: "[ronbot] running atomic runtime repair…\n" });
      const repair = await systemAPI
        .repairWhatsAppGatewayRuntime(appendWaPairingChunk)
        .catch((e) => ({ ok: false, steps: [{ name: "repair", ok: false, detail: e instanceof Error ? e.message : String(e) }] as Array<{ name: string; ok: boolean; detail?: string }> }));
      for (const s of repair.steps) {
        appendWaPairingChunk({ type: s.ok ? "stdout" : "stderr", data: `[ronbot] ${s.ok ? "✓" : "✗"} ${s.name}${s.detail ? ` — ${s.detail}` : ""}\n` });
      }
      if (!repair.ok) {
        const failed = repair.steps.find((s) => !s.ok);
        toast.error("Runtime repair did not complete", {
          description: failed ? `${failed.name}: ${failed.detail || "see log"}` : "See log for details.",
        });
        // Still try to proceed — the user may have a working setup despite a non-fatal step.
      }
      // 2. Now clear local session and re-pair.
      await systemAPI.materializeEnv().catch(() => undefined);
      await systemAPI.stopGateway().catch(() => undefined);
      const cleared = await systemAPI.clearWhatsAppSession();
      if (!cleared.success) {
        toast.error("Could not clear WhatsApp session", {
          description: cleared.stderr?.split("\n")[0] || "Try again.",
        });
        return;
      }
      await systemAPI.materializeEnv().catch(() => undefined);
      await systemAPI.startGateway().catch(() => undefined);
      setWaPaired(false);
      setWaPairedChecked(true);
      setTestResult("idle");
      setFormError("");
      waAutoPairAttemptedForSessionRef.current = false;
      await startWaPairing(false);
    } finally {
      rePairRestartInFlightRef.current = false;
      setWaRePairRestartBusy(false);
    }
  };

  const handleRepairRuntimeOnly = async () => {
    if (waRuntimeRepairBusy) return;
    setWaRuntimeRepairBusy(true);
    setWaBridgeInactiveHint("");
    try {
      appendWaPairingChunk({ type: "stdout", data: "[ronbot] running atomic runtime repair…\n" });
      const repair = await systemAPI
        .repairWhatsAppGatewayRuntime(appendWaPairingChunk)
        .catch((e) => ({ ok: false, steps: [{ name: "repair", ok: false, detail: e instanceof Error ? e.message : String(e) }] as Array<{ name: string; ok: boolean; detail?: string }> }));
      for (const s of repair.steps) {
        appendWaPairingChunk({ type: s.ok ? "stdout" : "stderr", data: `[ronbot] ${s.ok ? "✓" : "✗"} ${s.name}${s.detail ? ` — ${s.detail}` : ""}\n` });
      }
      if (repair.ok) {
        toast.success("Runtime repaired", { description: "Gateway restarted on managed Node v20." });
        // Re-test the bridge to see if it now comes up cleanly.
        setFormError("");
        const outcome = await restartWhatsAppGatewayWithNewSession();
        if (outcome === "live") {
          setWaBridgeInactiveHint("");
          toast.success(`${channel.name} channel enabled`, {
            description: "WhatsApp is now active.",
          });
          onComplete();
          onClose();
        }
      } else {
        const failed = repair.steps.find((s) => !s.ok);
        toast.error("Runtime repair did not complete", {
          description: failed ? `${failed.name}: ${failed.detail || "see log"}` : "See log for details.",
        });
      }
    } finally {
      setWaRuntimeRepairBusy(false);
    }
  };

  useEffect(() => {
    if (!waPairingActive) return;
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - (waLastOutputAtRef.current || 0);
      if (elapsed < 15000) return;
      if (waPairingPhase === "pairing") {
        setWaStatusHint("Still waiting for QR output… if this stalls, retry pairing.");
      } else if (waPairingPhase === "bridge-deps") {
        setWaStatusHint("Still preparing WhatsApp bridge dependencies…");
      }
    }, 3000);
    return () => {
      window.clearInterval(timer);
    };
  }, [emitWaDebugLog, waPairingActive, waPairingPhase]);

  const handleRefreshGatewayInstall = async () => {
    if (refreshGatewayInstallInFlightRef.current) return;
    refreshGatewayInstallInFlightRef.current = true;
    setGatewayRefreshBusy(true);
    try {
      if (channel.id === "whatsapp") {
        await systemAPI.materializeEnv().catch(() => undefined);
      }
      const r = await systemAPI.refreshGatewayInstall();
      if (r.success) {
        toast.success("Gateway service refreshed", {
          description: "Ronbot re-saved your PATH for the messaging gateway.",
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
      refreshGatewayInstallInFlightRef.current = false;
      setGatewayRefreshBusy(false);
    }
  };

  useEffect(() => {
    if (!open || channel.id !== "whatsapp" || step !== testStep) return;
    if (!waPairPrereqChecked || !waPairPrereqOk || !setupToolsChecked || !setupToolsOk) return;
    if (waPaired) return;
    if (waRequiresSessionReset || waAwaitingResetConfirm) return;
    if (waPairingActive) return;
    if (waAutoPairAttemptedForSessionRef.current) return;
    waAutoPairAttemptedForSessionRef.current = true;
    void startWaPairing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startWaPairing is recreated each render; ref prevents repeat pairing loops
  }, [
    open,
    channel.id,
    step,
    testStep,
    waPairPrereqChecked,
    waPairPrereqOk,
    setupToolsChecked,
    setupToolsOk,
    waPaired,
    waRequiresSessionReset,
    waAwaitingResetConfirm,
    waPairingActive,
  ]);

  /** When the channel test flips to ok (e.g. already linked), finalize automatically. */
  useEffect(() => {
    if (channel.id !== "whatsapp") return;
    const prev = prevWhatsAppTestResultRef.current;
    prevWhatsAppTestResultRef.current = testResult;
    const becameOk = prev !== "ok" && testResult === "ok";
    if (!becameOk) return;
    if (!open || step !== testStep) return;
    if (waWhatsAppFinalizeCompletedRef.current) return;
    if (!beginWhatsAppFinalize()) return;
    void (async () => {
      try {
        const outcome = await restartWhatsAppGatewayWithNewSession();
        if (outcome === "fail") {
          setTestResult("fail");
          return;
        }
        bumpMessagingProbe();
        waWhatsAppFinalizeCompletedRef.current = true;
        toast.success(`${channel.name} channel enabled`, {
          description: "WhatsApp is now active. You can communicate with your agent using WhatsApp.",
        });
        onComplete();
        onClose();
      } finally {
        waWhatsAppFinalizeInFlightRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run only on first transition to ok
  }, [testResult, open, channel.id, step, testStep, beginWhatsAppFinalize, restartWhatsAppGatewayWithNewSession, bumpMessagingProbe, channel.name, onComplete, onClose]);

  /**
   * Wipe a channel's leftover state so the user can start clean.
   * Stops the gateway, removes env keys (env file + secrets store), and for
   * WhatsApp also clears Hermes session + Baileys bridge auth folders that
   * survive uninstalling Ronbot when ~/.hermes lives in WSL.
   */
  const resetChannel = async () => {
    if (resetInFlightRef.current) return;
    resetInFlightRef.current = true;
    setResetting(true);
    try {
      const keys = (channel.resetEnvVars && channel.resetEnvVars.length > 0)
        ? channel.resetEnvVars
        : channel.credentials.map((c) => c.envVar);

      if (channel.id === "whatsapp") {
        const rr = await systemAPI.resetWhatsAppChannel();
        if (!rr.success) {
          toast.error("Could not reset WhatsApp", {
            description: rr.error || "Try again or check file permissions.",
          });
          return;
        }
      } else {
        // Stop any running gateway so it doesn't recreate state mid-reset.
        await systemAPI.stopGateway().catch(() => undefined);

        // Strip env keys from ~/.hermes/.env and from secure secrets storage.
        const stripped = await systemAPI.removeChannelEnvKeys(keys);
        if (!stripped.success) {
          toast.error("Could not remove env keys", {
            description: stripped.error || "Check ~/.hermes/.env permissions and try again.",
          });
          return;
        }
        for (const k of keys) {
          await systemAPI.secrets.delete(k).catch(() => false);
        }
        await systemAPI.materializeEnv().catch(() => undefined);
      }

      bumpMessagingProbe();

      // Reset wizard local state.
      setHadExistingConfig(false);
      setValues((prev) => {
        const next = { ...prev };
        for (const k of keys) next[k] = "";
        // Re-apply hidden defaults for WhatsApp etc.
        for (const cred of channel.credentials) {
          if (cred.kind === "hidden" && cred.defaultValue) next[cred.envVar] = cred.defaultValue;
          if (cred.kind === "choice" && cred.defaultValue) next[cred.envVar] = cred.defaultValue;
        }
        return next;
      });
      setWaPaired(false);
      setWaPairedChecked(false);
      setWaAwaitingResetConfirm(false);
      setWaStaleSessionDetected(false);
      setWaPairingError("");
      setTestResult("idle");
      setTestError("");

      toast.success(`${channel.name} reset`, {
        description: "Stale credentials removed. Restart setup from step 1.",
      });
      // Send the user back to step 1 so they re-enter credentials cleanly.
      setStep(1);
      setResetConfirmOpen(false);
      onComplete();
    } finally {
      resetInFlightRef.current = false;
      setResetting(false);
    }
  };

  /**
   * WhatsApp escape hatch: when pairing stalls because Baileys found a stale
   * session, clear ALL local session/auth files and restart pairing without
   * requiring the user to redo any earlier steps.
   */
  const forceFreshWhatsAppPairing = async () => {
    if (forceFreshInFlightRef.current) return;
    forceFreshInFlightRef.current = true;
    setWaForceFreshBusy(true);
    try {
      const cleared = await systemAPI.clearWhatsAppSession();
      if (!cleared.success) {
        toast.error("Could not clear WhatsApp session files", {
          description: cleared.stderr?.split("\n")[0] || "Try again or check WSL file permissions.",
        });
        return;
      }
      setWaPaired(false);
      setWaPairedChecked(true);
      setWaStaleSessionDetected(false);
      setWaPairingError("");
      setWaAwaitingResetConfirm(false);
      setWaRetryReady(false);
      toast.success("Cleared previous WhatsApp session", {
        description: "Starting a fresh QR pairing now…",
      });
      await startWaPairing(false);
    } finally {
      forceFreshInFlightRef.current = false;
      setWaForceFreshBusy(false);
    }
  };

  const next = async () => {
    if (step === credStep) {
      const ok = await saveCredentials();
      if (!ok) return;
    }
    setStep((s) => Math.min(maxStep, s + 1) as Step);
  };
  const back = () => setStep((s) => Math.max(0, s - 1) as Step);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className={
          channel.id === "whatsapp" ? "w-[94vw] max-w-5xl max-h-[88vh] overflow-y-auto" : "max-w-xl max-h-[85vh] overflow-y-auto"
        }
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Set up {channel.name}</DialogTitle>
          <DialogDescription>
            Step {step + 1} of {totalSteps} · {channel.difficulty} setup
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
          {Array.from({ length: totalSteps }, (_, i) => i).map((i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </div>

        {/* Step 0 — what this does */}
        {step === 0 && channel.id === "whatsapp" && (
          <div className="space-y-3 py-2">
            <h3 className="text-sm font-semibold text-foreground">Connect WhatsApp to your agent</h3>
            <p className="text-sm text-muted-foreground">{channel.tagline}</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Hermes links WhatsApp through the official <code className="text-xs font-mono">hermes whatsapp</code>{" "}
              flow inside the same environment as your agent (on Windows, that is your WSL Linux distro). Ronbot runs
              pairing here with a live QR — no terminal.
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1.5 pl-0.5">
              <li>A phone with WhatsApp installed and camera access for “Link a device”.</li>
              <li>
                Default is <strong className="text-foreground">self-chat</strong> (your own number): in WhatsApp,{" "}
                <strong className="text-foreground">message yourself</strong> to talk to the agent — that is how Hermes
                routes your thread.
              </li>
              <li>
                Access control defaults to <strong className="text-foreground">open testing (*)</strong>; tighten to
                your E.164 number on the next step when you are ready for production.
              </li>
              <li>After that, you scan one QR code; Hermes saves the session under ~/.hermes/platforms/whatsapp/session.</li>
            </ul>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() =>
                openExternal("https://hermes-agent.nousresearch.com/docs/user-guide/messaging/whatsapp/")
              }
            >
              <ExternalLink className="w-3 h-3 mr-1.5" /> Hermes WhatsApp documentation
            </Button>
          </div>
        )}

        {step === 0 && channel.id !== "whatsapp" && (
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

        {/* Step 1 — get credentials (non–WhatsApp only) */}
        {!waShortWizard && step === 1 && (
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

        {/* Credentials step (WhatsApp: step 1; other channels: step 2) */}
        {step === credStep && (
          <div className="space-y-3 py-2">
            <h3 className="text-sm font-semibold text-foreground">
              {channel.id === "whatsapp" ? "WhatsApp settings" : "Paste your credentials"}
            </h3>
            {channel.id === "whatsapp" ? (
              <>
                <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
                  <p>
                    <strong className="text-foreground">Next step:</strong> QR pairing here (no terminal). Changing
                    mode or access rules later may require a quick re-link when Ronbot prompts you.
                  </p>
                </div>
                <div className="rounded-lg border border-border/60 bg-background/30 p-4 space-y-4">
                  <div className="space-y-1">
                    <Label htmlFor="wa-phone-e164" className="text-xs">
                      Allowed WhatsApp numbers (E.164, comma-separated) <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="wa-phone-e164"
                      type="text"
                      inputMode="text"
                      value={values.WHATSAPP_ALLOWED_USERS || ""}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^\d,\s]/g, "");
                        setValues((v) => ({ ...v, WHATSAPP_ALLOWED_USERS: raw }));
                      }}
                      placeholder="15551234567,447700900123"
                      autoComplete="off"
                      spellCheck={false}
                      className="bg-background/50 font-mono text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Digits only per number (country code first, no +). Use commas to allow multiple numbers.
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                These are stored in your OS keychain — never in plain text.
              </p>
            )}
            {hadExistingConfig && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-foreground">
                      Existing {channel.name} setup detected
                    </p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Values from <code className="font-mono">~/.hermes/.env</code> are pre-filled. If you
                      reinstalled Ronbot or want to start clean, click Reset to wipe stored credentials
                      {channel.id === "whatsapp" ? " and the local WhatsApp session" : ""}.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-1 h-7 text-xs"
                      disabled={resetting}
                      onClick={() => setResetConfirmOpen(true)}
                    >
                      {resetting ? (
                        <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> Resetting…</>
                      ) : (
                        <><RotateCcw className="w-3 h-3 mr-1.5" /> Reset {channel.name}</>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}
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

        {/* Test & enable (WhatsApp: step 2; other channels: step 3) */}
        {step === testStep && (
          <div className="space-y-4 py-2">
            <h3 className="text-sm font-semibold text-foreground">Test &amp; enable</h3>
            {channel.id !== "whatsapp" && (
              <p className="text-sm text-muted-foreground">{channel.testHint}</p>
            )}

            {hadExistingConfig && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
                <span className="min-w-[12rem] flex-1 text-[11px] text-muted-foreground leading-relaxed">
                  Test failing with stale credentials? Reset {channel.name} to wipe what's saved
                  {channel.id === "whatsapp" ? " and the local WhatsApp session" : ""} and rerun setup.
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={resetting}
                  onClick={() => setResetConfirmOpen(true)}
                >
                  {resetting ? (
                    <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> Resetting…</>
                  ) : (
                    <><RotateCcw className="w-3 h-3 mr-1.5" /> Reset {channel.name}</>
                  )}
                </Button>
              </div>
            )}

            {step === testStep &&
              setupToolsChecked &&
              setupToolsOk &&
              channel.id !== "whatsapp" &&
              ["telegram", "slack", "discord", "signal"].includes(channel.id) && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-background/30 px-3 py-2 text-[11px] text-muted-foreground">
                  <span className="min-w-[12rem] flex-1">
                    After installing curl, Python, or Node, or changing PATH, refresh the gateway service so Ronbot snapshots PATH.
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

            {step === testStep && setupToolsChecked && !setupToolsOk && (
              <ActionableError
                title="A system tool is missing for the connection test"
                summary={
                  channel.id === "signal"
                    ? "Ronbot uses curl to ping the signal-cli health URL. Python is not required for this channel test."
                    : "Ronbot uses curl and Python 3 to verify your bot tokens directly."
                }
                details={
                  setupToolsDetail ||
                  (channel.id === "signal"
                    ? "Install curl in the same environment Ronbot uses. On Windows with WSL, install curl inside that Linux distro."
                    : "Install curl and Python 3 in the same environment Ronbot uses. On Windows with WSL, install them inside that Linux distro.")
                }
                fixLabel={channel.id === "signal" ? "cURL downloads" : "Python downloads"}
                onFix={() => {
                  openExternal(
                    channel.id === "signal"
                      ? "https://curl.se/download.html"
                      : "https://www.python.org/downloads/",
                  );
                }}
              />
            )}

            {channel.id === "whatsapp" && waPairPrereqChecked && !waPairPrereqOk && (
              <ActionableError
                title="WhatsApp pairing needs npm and script"
                summary="Ronbot uses a managed Node runtime for WhatsApp bridge dependencies and needs script(1) to allocate a PTY so the QR can render in this window."
                details={
                  waPairPrereqDetail ||
                  "Use Auto-fix to prepare the managed runtime and missing tools. The gateway is the long-running service; this step only links and saves the session."
                }
                fixLabel="Auto-fix now"
                fixing={waAutoFixing}
                onFix={() => void autoFixWhatsAppPairingTools()}
              />
            )}

            {channel.id === "whatsapp" && setupToolsOk && waPairPrereqOk && waPairedChecked && (!waPaired || waRequiresSessionReset || waAwaitingResetConfirm) && (
              <div className="rounded-lg border border-border/60 bg-background/30 p-4 space-y-3">
                <h4 className="text-sm font-medium text-foreground">
                  {waPaired ? "Relink WhatsApp" : "Link WhatsApp"}
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  On your phone: WhatsApp → Settings → Linked devices → Link a device. Then start pairing here
                  and scan the QR code when it appears in the log below.
                </p>
                {waRequiresSessionReset && (
                  <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 space-y-2">
                    <p className="text-xs text-foreground">
                      Re-linking will remove your current local WhatsApp session and create a new one.
                    </p>
                    {(waHasModeChange || waHasAllowlistChange) && (
                      <p className="text-[11px] text-muted-foreground">
                        {[
                          waHasModeChange ? "mode changed" : "",
                          waHasAllowlistChange ? "allowed numbers changed" : "",
                        ].filter(Boolean).join(" + ")}
                      </p>
                    )}
                    {waAwaitingResetConfirm ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void requestWaPairingStart()}
                          disabled={waPairingActive || waAutoFixing || testing}
                          className="gradient-primary text-primary-foreground"
                        >
                          Proceed and relink
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={waPairingActive}
                          onClick={() => {
                            setWaAwaitingResetConfirm(false);
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">
                        Start pairing to continue with a fresh WhatsApp session.
                      </p>
                    )}
                  </div>
                )}
                {waPairingError && (
                  <p className="text-xs text-destructive font-mono whitespace-pre-wrap">{waPairingError}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={() => void requestWaPairingStart()}
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
                      waRetryReady
                        ? "Retry QR pairing"
                        : waRequiresSessionReset
                          ? waAwaitingResetConfirm
                            ? "Confirm and start fresh QR pairing"
                            : "Start fresh QR pairing"
                          : "Start QR pairing"
                    )}
                  </Button>
                  {waPairingActive && (
                    <Button type="button" variant="outline" onClick={() => void cancelWaPairing()}>
                      Cancel pairing
                    </Button>
                  )}
                  {(waStaleSessionDetected || (waRetryReady && waPairingError)) && !waPairingActive && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void forceFreshWhatsAppPairing()}
                      disabled={waForceFreshBusy || waPairingActive || waAutoFixing}
                      title="Wipe local WhatsApp session and bridge auth folders, then start a fresh QR pairing."
                    >
                      {waForceFreshBusy ? (
                        <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Clearing…</>
                      ) : (
                        <><Trash2 className="w-4 h-4 mr-1.5" /> Force fresh QR pairing</>
                      )}
                    </Button>
                  )}
                </div>
                {waStaleSessionDetected && !waPairingActive && (
                  <p className="text-[11px] text-amber-500/90 leading-relaxed">
                    Looks like an old WhatsApp session is being resumed instead of pairing fresh. This often
                    happens after reinstalling Ronbot because local agent data survives uninstall on Windows/WSL. Use
                    "Force fresh QR pairing" to wipe the cached session and bridge auth files.
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Tip: Hold your phone about 20-30 cm away, keep screen brightness high, and avoid glare while scanning.
                </p>
                {waStatusHint && (
                  <p className="text-[11px] text-muted-foreground">{waStatusHint}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {waBridgeInactiveHint ? (
                    <>
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        className="h-8 text-xs"
                        disabled={waRePairRestartBusy || waPairingActive || waRuntimeRepairBusy}
                        onClick={() => void handleRePairAndRestart()}
                      >
                        {waRePairRestartBusy ? (
                          <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                        ) : null}
                        Re-pair + Restart
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        disabled={waRuntimeRepairBusy || waPairingActive || waRePairRestartBusy}
                        title="Re-install Node v20 shim, drop systemd PATH override, patch the WhatsApp adapter, and restart the gateway — without clearing your linked WhatsApp session."
                        onClick={() => void handleRepairRuntimeOnly()}
                      >
                        {waRuntimeRepairBusy ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : null}
                        Repair runtime only
                      </Button>
                    </>
                  ) : null}
                </div>
                {waBridgeInactiveHint ? (
                  <pre className="text-[10px] leading-snug font-mono text-muted-foreground max-h-32 overflow-y-auto rounded border border-border/50 bg-background/50 p-2 whitespace-pre-wrap">
                    {waBridgeInactiveHint}
                  </pre>
                ) : null}
                <div className="rounded-md border border-border/50 bg-background/50 h-[62vh] min-h-[26rem] overflow-hidden p-2">
                  <WhatsAppTerminal
                    content={waTerminalRaw}
                    resetKey={waTerminalResetTick}
                    onReadyChange={setWaTerminalReady}
                    className="h-full w-full rounded-md border border-border/50 bg-black/90"
                  />
                </div>
                {!waTerminalReady && (
                  <div className="rounded-md border border-border/50 bg-background/50 h-[38vh] min-h-[12rem] overflow-x-auto overflow-y-auto p-2">
                    <pre
                      className="text-[10px] leading-[10px] font-mono text-foreground/90 whitespace-pre min-w-max"
                      style={{ letterSpacing: "0", fontVariantLigatures: "none", fontFeatureSettings: '"liga" 0, "calt" 0' }}
                    >
                      {(waPairingLines.length > 0 || waLogBuffer.current)
                        ? [...waPairingLines, ...(waLogBuffer.current ? [waLogBuffer.current] : [])].join("\n")
                        : waPairingActive
                          ? "Starting…"
                          : "Output from Ronbot will appear here."}
                    </pre>
                    <div ref={waLogEndRef} />
                  </div>
                )}
                {waTerminalReady && (
                  <p className="text-[11px] text-muted-foreground">
                    Pairing completes automatically after WhatsApp is linked on your phone.
                  </p>
                )}
                {!waTerminalReady && (
                  <p className="text-[11px] text-muted-foreground">
                    Terminal renderer is unavailable, using plain-text fallback output for diagnostics.
                  </p>
                )}
              </div>
            )}

            <div className="rounded-lg border border-border/60 bg-background/30 p-4">
              {!setupToolsChecked ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                  Checking tools for this step…
                </div>
              ) : !setupToolsOk ? (
                <p className="text-sm text-muted-foreground">Fix the missing tools above, then run the test.</p>
              ) : testResult === "idle" ? (
                channel.id !== "whatsapp" ? (
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
                ) : null
              ) : null}
              {testResult === "ok" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-success">
                    <CheckCircle2 className="w-4 h-4" /> Credentials verified. Finalizing automatically.
                  </div>
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
          {step > 0 && !(channel.id === "whatsapp" && step === testStep) && (
            <Button variant="ghost" onClick={back} disabled={saving || (channel.id === "whatsapp" && step === testStep && waPairingActive)}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
          )}
          <div className="flex-1" />
          {step < maxStep ? (
            <Button
              onClick={next}
              disabled={saving || (step === credStep && !requiredFilled)}
              className="gradient-primary text-primary-foreground"
            >
              {saving ? (
                <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Saving…</>
              ) : (
                <>Next <ArrowRight className="w-4 h-4 ml-1" /></>
              )}
            </Button>
          ) : channel.id !== "whatsapp" ? (
            <Button
              onClick={() => {
                void (async () => {
                  await systemAPI.materializeEnv().catch(() => undefined);
                  const r = await systemAPI.startGateway();
                  if (!r.success) {
                    const detail = r.stderr?.split("\n")[0] || "Check Logs for details.";
                    setFormError(detail);
                    toast.error("Failed to start gateway", { description: detail });
                    return;
                  }
                  setFormError("");
                  toast.success(`${channel.name} channel enabled`, {
                    description: "Your agent is now reachable here.",
                  });
                  onComplete();
                  onClose();
                })();
              }}
              disabled={testResult !== "ok"}
              className="gradient-primary text-primary-foreground"
            >
              Enable {channel.name}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground px-1">Finalizing Whatsapp connection</p>
          )}
        </DialogFooter>
      </DialogContent>

      {/* Reset confirmation — uniform across all 5 channels */}
      <Dialog open={resetConfirmOpen} onOpenChange={(v) => !resetting && setResetConfirmOpen(v)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reset {channel.name}?</DialogTitle>
            <DialogDescription>
              This wipes Ronbot's saved credentials for {channel.name} so you can start setup from scratch.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="rounded-md border border-border/60 bg-background/30 p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Ronbot will:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Stop the {channel.name} gateway if it's running</li>
                <li>
                  Remove these keys from <code className="font-mono">~/.hermes/.env</code>:
                  {" "}
                  <span className="font-mono">
                    {(channel.resetEnvVars ?? channel.credentials.map((c) => c.envVar)).join(", ")}
                  </span>
                </li>
                <li>Delete the matching entries from your OS keychain</li>
                {channel.id === "whatsapp" && (
                  <li>Wipe local WhatsApp session and Baileys bridge auth folders</li>
                )}
              </ul>
            </div>
            {channel.resetCaveat && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-[11px] text-foreground/90 leading-relaxed">
                <strong className="text-amber-600 dark:text-amber-400">Heads up:</strong>{" "}
                {channel.resetCaveat}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setResetConfirmOpen(false)} disabled={resetting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void resetChannel()}
              disabled={resetting}
            >
              {resetting ? (
                <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Resetting…</>
              ) : (
                <><Trash2 className="w-4 h-4 mr-1.5" /> Reset {channel.name}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </Dialog>
  );
};

export default ChannelWizard;
