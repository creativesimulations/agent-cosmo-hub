// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { createContext, useContext, useRef, useState, ReactNode, useCallback, useMemo, useEffect } from "react";
import { systemAPI } from "@/lib/systemAPI";
import { sudoAPI, promptForPasswordMac } from "@/lib/systemAPI/sudo";
import { useAgentConnection } from "./AgentConnectionContext";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type Mode = "choose" | "connect" | "install" | "guard";
export type InstallStep = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type InstallSource = "bundled" | "local";

export interface OptionalFeature {
  id: string;
  label: string;
  description: string;
  pipExtra: string;
}

export const OPTIONAL_FEATURES: OptionalFeature[] = [
  { id: "voice", label: "Voice / TTS", description: "Enable text-to-speech voice messages (requires ffmpeg)", pipExtra: "voice" },
  { id: "messaging", label: "Messaging Gateways", description: "Telegram, Discord, and other messaging integrations", pipExtra: "messaging" },
  { id: "cron", label: "Scheduled Tasks", description: "Cron-based task scheduling and automation", pipExtra: "cron" },
  { id: "web", label: "Web tools (search + extract)", description: "Built-in web_search and web_extract — recommended; basic browsing works without a backend", pipExtra: "web" },
];

/** Pip extras passed to every official / local-folder Hermes install (no UI toggles). */
const ALL_HERMES_PIP_EXTRAS = OPTIONAL_FEATURES.map((o) => o.pipExtra);

const ALLOWED_STEP_TRANSITIONS: Record<InstallStep, InstallStep[]> = {
  0: [1],
  1: [0, 2],
  2: [1, 3],
  3: [2, 4],
  4: [3, 5],
  5: [4, 6],
  6: [5],
};

interface InstallContextValue {
  // Top-level mode
  mode: Mode;
  setMode: (m: Mode) => void;

  // Wizard step
  installStep: InstallStep;
  setInstallStep: (s: InstallStep) => void;

  // Install source — "bundled" runs the official Hermes installer script,
  // "local" pip-installs from a folder the user already has on disk.
  installSource: InstallSource;
  setInstallSource: (s: InstallSource) => void;
  localAgentPath: string;
  setLocalAgentPath: (p: string) => void;

  /** Local-folder install only: if true, back up SOUL/MEMORY/PERSONALITY/USER and replace with Ronbot defaults. */
  replaceWithRonbotPersonalityTemplates: boolean;
  setReplaceWithRonbotPersonalityTemplates: (v: boolean) => void;

  // Install run state
  installing: boolean;
  installComplete: boolean;
  installProgress: number;
  installOutput: string[];

  // Actions
  handleInstallAgent: () => Promise<void>;
  cancelInstall: () => void;

  // Sudo prompt (shown when we need to install apt packages inside WSL/Linux)
  sudoPrompt: { open: boolean; reason: string };
  closeSudoPrompt: () => void;
  submitSudoPassword: (password: string) => void;
  sudoPasswordless: () => void;

  // Identity & config
  agentName: string;
  setAgentName: (n: string) => void;
  selectedProvider: string;
  setSelectedProvider: (p: string) => void;
  apiKey: string;
  setApiKey: (k: string) => void;
  keySaved: boolean;
  setKeySaved: (b: boolean) => void;
  selectedModel: string;
  setSelectedModel: (m: string) => void;

  // Doctor / launch
  doctorRunning: boolean;
  doctorOutput: string[];
  doctorProgress: number;
  doctorPassed: boolean;
  runDoctor: () => Promise<void>;

  launching: boolean;
  launchOutput: string[];
  runLaunch: () => Promise<void>;
}

const InstallContext = createContext<InstallContextValue | null>(null);

export const InstallProvider = ({ children }: { children: ReactNode }) => {
  const { markConnected, refresh: refreshConnection } = useAgentConnection();
  const [mode, setMode] = useState<Mode>("choose");
  const [installStep, setInstallStepState] = useState<InstallStep>(0);
  const setInstallStep = useCallback((next: InstallStep) => {
    setInstallStepState((prev) => {
      if (next === prev) return prev;
      const allowed = ALLOWED_STEP_TRANSITIONS[prev] ?? [];
      if (allowed.includes(next)) return next;
      // Allow explicit restart from any step after failures/cancel/retries.
      if (next === 0) return next;
      return prev;
    });
  }, []);
  const [installSource, setInstallSource] = useState<InstallSource>("bundled");
  const [localAgentPath, setLocalAgentPath] = useState<string>("");
  const [replaceWithRonbotPersonalityTemplates, setReplaceWithRonbotPersonalityTemplates] = useState(true);

  useEffect(() => {
    setReplaceWithRonbotPersonalityTemplates(installSource !== "local");
    bundledForceReinstallRef.current = false;
  }, [installSource]);

  const [installing, setInstalling] = useState(false);
  const [installComplete, setInstallComplete] = useState(false);
  const [installProgress, setInstallProgress] = useState(0);
  const [installOutput, setInstallOutput] = useState<string[]>([]);
  const installIdRef = useRef(0);
  /** User confirmed running the official installer again while v0.13.x is already detected. */
  const bundledForceReinstallRef = useRef(false);
  const [bundledReinstallDialogOpen, setBundledReinstallDialogOpen] = useState(false);

  const [agentName, setAgentName] = useState("Ron");
  const [selectedProvider, setSelectedProvider] = useState("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [selectedModel, setSelectedModel] = useState("openrouter/auto");

  const [doctorRunning, setDoctorRunning] = useState(false);
  const [doctorOutput, setDoctorOutput] = useState<string[]>([]);
  const [doctorProgress, setDoctorProgress] = useState(0);
  const [doctorPassed, setDoctorPassed] = useState(false);

  const [launching, setLaunching] = useState(false);
  const [launchOutput, setLaunchOutput] = useState<string[]>([]);

  // Sudo dialog state — when set, the dialog is rendered by AppLayout.
  const [sudoPrompt, setSudoPrompt] = useState<{ open: boolean; reason: string }>({
    open: false,
    reason: "",
  });
  const sudoResolverRef = useRef<((password: string | null) => void) | null>(null);

  const closeSudoPrompt = useCallback(() => {
    sudoResolverRef.current?.(null);
    sudoResolverRef.current = null;
    setSudoPrompt({ open: false, reason: "" });
  }, []);

  const submitSudoPassword = useCallback((password: string) => {
    sudoResolverRef.current?.(password);
    sudoResolverRef.current = null;
    setSudoPrompt({ open: false, reason: "" });
  }, []);

  const sudoPasswordless = useCallback(() => {
    sudoResolverRef.current?.("");
    sudoResolverRef.current = null;
    setSudoPrompt({ open: false, reason: "" });
  }, []);

  /** Opens the sudo dialog and awaits a password (or "" passwordless / null cancel). */
  const requestSudoPassword = useCallback((reason: string): Promise<string | null> => {
    return new Promise((resolve) => {
      sudoResolverRef.current = resolve;
      setSudoPrompt({ open: true, reason });
    });
  }, []);

  const handleInstallAgent = useCallback(async () => {
    if (installSource === "bundled" && !bundledForceReinstallRef.current) {
      try {
        const probe = await systemAPI.getHermesCliVersionSummary();
        if (probe.looksLikeV013 && probe.text.length > 0) {
          setInstallOutput((prev) => [
            ...prev,
            "Checking installed Hermes version…",
            `Detected: ${probe.text.split("\n")[0] ?? probe.text}`,
            "Hermes v0.13.x is already installed. The official script is safe to re-run.",
            "Use “Reinstall latest” in the dialog to continue, or cancel and use Connect if you only need the dashboard.",
          ]);
          setBundledReinstallDialogOpen(true);
          return;
        }
      } catch {
        /* continue with install */
      }
    }

    const myInstallId = ++installIdRef.current;
    setInstalling(true);
    setInstallComplete(false);
    setInstallProgress(0);
    setInstallOutput((prev) => [
      ...prev.filter((l) => !l.includes("Use “Reinstall latest”")),
      installSource === "bundled"
        ? "Starting official Hermes install (curl … | bash from GitHub)…"
        : `Starting local-folder install with extras: ${ALL_HERMES_PIP_EXTRAS.join(", ")}…`,
    ]);

    // ─── Step 1: detect needed apt packages ─────────────────────
    const needFfmpeg =
      installSource === "local" && ALL_HERMES_PIP_EXTRAS.includes("voice");
    const aptPackages: string[] = [];

    if (needFfmpeg) {
      setInstallOutput((prev) => [...prev, "Checking for ffmpeg (required for Voice / TTS)..."]);
      const ffCheck = await systemAPI.checkFfmpeg();
      if (installIdRef.current !== myInstallId) return;
      if (ffCheck.found) {
        setInstallOutput((prev) => [...prev, `✓ ffmpeg already installed (${ffCheck.version ?? "ok"})`]);
      } else {
        aptPackages.push("ffmpeg");
      }
    }

    setInstallOutput((prev) => [...prev, "Checking for Python venv support..."]);
    const venvCheck = await systemAPI.checkPythonVenv();
    if (installIdRef.current !== myInstallId) return;
    const pythonVenvPackage = venvCheck.packageName ?? "python3-venv";
    if (venvCheck.installed) {
      setInstallOutput((prev) => [...prev, `✓ ${pythonVenvPackage} is ready`]);
    } else {
      aptPackages.push(pythonVenvPackage);
    }

    // ─── Step 2: install via sudo if needed ─────────────────────
    if (aptPackages.length > 0) {
      setInstallOutput((prev) => [...prev, `Need to install system packages: ${aptPackages.join(", ")}`]);
      const probe = await sudoAPI.probe();
      if (installIdRef.current !== myInstallId) return;

      let password: string | null = "";
      if (probe.kind === "passwordless") {
        setInstallOutput((prev) => [...prev, "✓ Passwordless sudo detected — installing automatically"]);
      } else if (probe.kind === "no-sudo") {
        setInstallOutput((prev) => [
          ...prev,
          "⚠ sudo is not available — cannot install system packages.",
        ]);
        password = null;
      } else {
        setInstallOutput((prev) => [...prev, "Requesting administrator password..."]);
        const needsPythonVenv = aptPackages.some((pkg) => pkg.endsWith("-venv"));
        const reason =
          aptPackages.includes("ffmpeg") && needsPythonVenv
            ? `install ffmpeg and ${pythonVenvPackage} (needed to set up the agent)`
            : aptPackages.includes("ffmpeg")
            ? "install ffmpeg (needed for Voice / TTS)"
            : `install ${pythonVenvPackage} (needed to set up the agent)`;

        // macOS: try the native osascript GUI prompt first — feels native and
        // keeps the password out of any renderer field. Fall back to the in-app
        // dialog if the user dismisses it or osascript is missing.
        const platform = await systemAPI.getPlatform();
        if (platform.isMac) {
          const macPw = await promptForPasswordMac(`Ronbot needs to ${reason}.`);
          if (installIdRef.current !== myInstallId) return;
          if (macPw) {
            password = macPw;
          } else {
            password = await requestSudoPassword(reason);
          }
        } else {
          password = await requestSudoPassword(reason);
        }

        if (installIdRef.current !== myInstallId) return;
        if (password === null) {
          setInstallOutput((prev) => [...prev, "✗ Cancelled — system packages not installed."]);
          setInstalling(false);
          return;
        }
      }

      if (password !== null) {
        setInstallOutput((prev) => [...prev, `Installing ${aptPackages.join(", ")} via apt...`]);
        const aptResult = await sudoAPI.aptInstall(aptPackages, password);
        if (installIdRef.current !== myInstallId) return;
        if (aptResult.success) {
          setInstallOutput((prev) => [...prev, `✓ Installed: ${aptPackages.join(", ")}`]);
        } else {
          const tail = (aptResult.stderr || aptResult.stdout || "unknown error")
            .trim().split("\n").slice(-5).join("\n");
          setInstallOutput((prev) => [...prev, `⚠ apt install failed: ${tail}`]);
        }
      }
    }

    // ─── Step 3: run the Hermes installer ───────────────────────
    setInstallOutput((prev) => [
      ...prev,
      installSource === "bundled"
        ? "Running the official Hermes installer (this may take several minutes)…"
        : "Verifying Python and pip…",
      "Live output will appear below.",
    ]);

    // Slowly creep the bar up to 90% so the user sees movement even before
    // the first streamed line arrives.
    const progressInterval = setInterval(() => {
      if (installIdRef.current !== myInstallId) {
        clearInterval(progressInterval);
        return;
      }
      setInstallProgress((prev) => Math.min(prev + 2, 90));
    }, 800);

    // Heartbeat: every 15s, append an elapsed-time line so the user knows
    // the process is alive even when pip is silent for long stretches.
    const startedAt = Date.now();
    const heartbeatInterval = setInterval(() => {
      if (installIdRef.current !== myInstallId) {
        clearInterval(heartbeatInterval);
        return;
      }
      const secs = Math.round((Date.now() - startedAt) / 1000);
      const mm = String(Math.floor(secs / 60)).padStart(2, "0");
      const ss = String(secs % 60).padStart(2, "0");
      setInstallOutput((prev) => [...prev, `… still working (elapsed ${mm}:${ss})`]);
    }, 15000);

    try {
      // Stream installer output line-by-line so the log keeps moving.
      let buffered = "";
      const handleOutput = (event: { type: string; data?: string; code?: number }) => {
        if ((event.type !== "stdout" && event.type !== "stderr") || !event.data) return;
        buffered += event.data.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        const parts = buffered.split("\n");
        buffered = parts.pop() ?? "";
        const lines = parts.map((l) => l.trimEnd()).filter(Boolean);
        if (lines.length === 0) return;
        if (installIdRef.current !== myInstallId) return;
        setInstallOutput((prev) => [...prev, ...lines]);
        // Once real output is flowing, nudge the bar past 90% to show progress.
        setInstallProgress((prev) => Math.min(Math.max(prev, 92), 97));
      };

      const result = installSource === "local" && localAgentPath
        ? await systemAPI.installHermesFromLocalFolder(
            localAgentPath,
            ALL_HERMES_PIP_EXTRAS,
            handleOutput,
          )
        : await systemAPI.installHermes(undefined, handleOutput);

      // Flush any trailing partial line.
      if (buffered.trim() && installIdRef.current === myInstallId) {
        setInstallOutput((prev) => [...prev, buffered.trim()]);
      }

      if (installIdRef.current !== myInstallId) return;

      setInstallProgress(100);

      if (result.success) {
        setInstallOutput((prev) => [...prev, "✓ Agent installed successfully!"]);

        const shouldSeedPersona = installSource !== "local" || replaceWithRonbotPersonalityTemplates;
        const nameForSeed = agentName.trim() || "Ron";
        if (shouldSeedPersona) {
          setInstallOutput((prev) => [...prev, "Saving Ronbot personality files (SOUL, PERSONALITY, MEMORY, USER)…"]);
          try {
            const seed = await systemAPI.seedRonbotPersonalityAfterInstall(nameForSeed);
            if (installIdRef.current !== myInstallId) return;
            if (seed.success) {
              const updated = seed.filesMoved ?? 0;
              setInstallOutput((prev) => [
                ...prev,
                updated > 0
                  ? `✓ Updated ${updated} persona file(s); prior copies saved under ~/.hermes/.ronbot-personality-backup/`
                  : "✓ Core persona files left unchanged (already customized or match Ronbot defaults). Refreshed guides and Saved Personalities snapshot.",
                "✓ Ronbot SOUL.md, PERSONALITY.md, memories/MEMORY.md, memories/USER.md, ELECTRON_APP_GUIDE.md, AGENTS.md / app guide, and personalities/Default preset.",
              ]);
            } else {
              setInstallOutput((prev) => [
                ...prev,
                `⚠ Personality seed did not complete: ${seed.error ?? "unknown error"}`,
              ]);
              toast.warning("Personality files may be incomplete", {
                description: seed.error ?? "Check install log.",
                duration: 10000,
              });
            }
          } catch (e) {
            if (installIdRef.current !== myInstallId) return;
            const msg = e instanceof Error ? e.message : String(e);
            setInstallOutput((prev) => [...prev, `⚠ Personality seed crashed: ${msg}`]);
            toast.warning("Personality seed failed", { description: msg, duration: 10000 });
          }
        } else {
          setInstallOutput((prev) => [
            ...prev,
            "ℹ Left your agent’s existing SOUL.md, MEMORY.md, PERSONALITY.md, and USER.md unchanged (per your choice).",
          ]);
        }

        setInstallOutput((prev) => [...prev, "Stopping any Hermes gateway / CLI left over from install…"]);
        try {
          await systemAPI.stopHermesAgentRuntime();
          if (installIdRef.current !== myInstallId) return;
          setInstallOutput((prev) => [
            ...prev,
            "✓ Hermes runtime stopped — the next launch will load files from disk (including any new persona seed).",
          ]);
        } catch (e) {
          if (installIdRef.current !== myInstallId) return;
          const msg = e instanceof Error ? e.message : String(e);
          setInstallOutput((prev) => [...prev, `⚠ Could not fully stop Hermes runtime: ${msg}`]);
        }

        setInstallComplete(true);
        // Mark the agent as connected immediately and re-verify in the
        // background so every screen flips out of the "No Agent Connected"
        // state without requiring the user to click "Connect".
        markConnected("~/.hermes");
        void refreshConnection();
        toast.success("Agent installed and connected", {
          description: "You can now chat with your agent in the Agent Chat tab.",
          duration: 8000,
        });
        setTimeout(() => {
          if (installIdRef.current === myInstallId) setInstallStepState(2);
        }, 1000);
      } else {
        const stderr = (result.stderr || "").trim();
        const stdout = (result.stdout || "").trim();
        const tail = (text: string, n = 20) => text.split("\n").slice(-n).join("\n");
        const lines: string[] = [`✗ Installation failed (exit code ${result.code ?? "?"})`];
        if (stderr) lines.push("--- stderr ---", tail(stderr));
        if (stdout) lines.push("--- stdout (last 20 lines) ---", tail(stdout));
        if (!stderr && !stdout) {
          lines.push("No output was captured from the installer.");
        }
        setInstallOutput((prev) => [...prev, ...lines]);
      }
      bundledForceReinstallRef.current = false;
    } finally {
      clearInterval(progressInterval);
      clearInterval(heartbeatInterval);
    }
    setInstalling(false);
  }, [
    requestSudoPassword,
    markConnected,
    refreshConnection,
    installSource,
    localAgentPath,
    agentName,
    replaceWithRonbotPersonalityTemplates,
  ]);

  const confirmBundledHermesReinstall = useCallback(() => {
    bundledForceReinstallRef.current = true;
    setBundledReinstallDialogOpen(false);
    void handleInstallAgent();
  }, [handleInstallAgent]);

  const cancelInstall = useCallback(() => {
    installIdRef.current++;
    sudoResolverRef.current?.(null);
    sudoResolverRef.current = null;
    setSudoPrompt({ open: false, reason: "" });
    setInstalling(false);
    setInstallComplete(false);
    setInstallProgress(0);
    setInstallOutput((prev) => [...prev, "✗ Installation cancelled by user."]);
  }, []);

  const runDoctor = useCallback(async () => {
    if (doctorRunning) return;

    setDoctorRunning(true);
    setDoctorPassed(false);
    setDoctorProgress(8);
    setDoctorOutput(["Running diagnostics...", "Collecting live output..."]);

    let bufferedLine = "";

    const appendLines = (lines: string[]) => {
      if (lines.length === 0) return;
      setDoctorOutput((prev) => [...prev, ...lines]);
      setDoctorProgress((prev) => Math.min(prev + Math.max(lines.length * 4, 4), 92));
    };

    const appendChunk = (chunk: string) => {
      bufferedLine += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const parts = bufferedLine.split("\n");
      bufferedLine = parts.pop() ?? "";
      appendLines(parts.map((line) => line.trimEnd()).filter(Boolean));
    };

    const flushBufferedLine = () => {
      const finalLine = bufferedLine.trimEnd();
      bufferedLine = "";
      if (finalLine) appendLines([finalLine]);
    };

    const progressTimer = window.setInterval(() => {
      setDoctorProgress((prev) => {
        if (prev >= 88) return prev;
        if (prev < 32) return prev + 8;
        if (prev < 60) return prev + 5;
        return prev + 2;
      });
    }, 1200);

    try {
      const result = await systemAPI.hermesDoctor((event: { type: string; data?: string; code?: number }) => {
        if ((event.type === "stdout" || event.type === "stderr") && event.data) {
          appendChunk(event.data);
        }
      });

      flushBufferedLine();
      const parsed = await systemAPI.analyzeDoctorIssues([result.stdout, result.stderr].filter(Boolean).join("\n")).catch(() => null);
      if (parsed?.issues?.length) {
        setDoctorOutput((prev) => [
          ...prev,
          "",
          "── Normalized startup issues ─────────────────",
          ...parsed.issues.map((i: { severity: string; title: string; detail: string }) => `${i.severity.toUpperCase()}: ${i.title} — ${i.detail}`),
        ]);
      }

      // Post-doctor verification per Hermes docs:
      //   1. `hermes config check` — schema validation
      //   2. `hermes chat -p "ping"` — real round-trip
      // Each is reported as a separate row so the user knows exactly what
      // passed/failed.
      let configOk = true;
      let pingOk = true;
      if (result.success) {
        setDoctorOutput((prev) => [...prev, "", "── Post-install verification ─────────────────"]);
        setDoctorProgress(94);
        try {
          const cfg = await systemAPI.configCheck();
          configOk = !!cfg.success;
          setDoctorOutput((prev) => [
            ...prev,
            configOk ? "✓ config check — schema valid" : `✗ config check failed (exit ${cfg.code ?? "?"})`,
            ...(cfg.stdout || cfg.stderr || "").trim().split("\n").filter(Boolean).slice(0, 8).map((l) => `  ${l}`),
          ]);
        } catch (e) {
          configOk = false;
          setDoctorOutput((prev) => [...prev, `✗ config check crashed: ${e instanceof Error ? e.message : String(e)}`]);
        }

        setDoctorProgress(97);
        try {
          const ping = await systemAPI.chatPing();
          pingOk = !!ping.success;
          setDoctorOutput((prev) => [
            ...prev,
            pingOk
              ? `✓ chat round-trip — agent replied (${ping.reply.length} chars)`
              : `✗ chat round-trip failed${ping.error ? `: ${ping.error}` : ""}`,
          ]);
        } catch (e) {
          pingOk = false;
          setDoctorOutput((prev) => [...prev, `✗ chat round-trip crashed: ${e instanceof Error ? e.message : String(e)}`]);
        }
      }

      // Browser self-test — non-blocking, informational only.
      if (result.success) {
        setDoctorProgress(99);
        try {
          const bst = await systemAPI.runBrowserSelfTest();
          setDoctorOutput((prev) => [
            ...prev,
            "",
            "── Browser stack ──────────────────────────────",
            bst.hermesCliToolsetLoaded
              ? "✓ Browser tool registered (hermes-cli toolset loaded)"
              : "✗ Browser tool NOT registered — run App Diagnostics → Repair config",
            bst.cdpUrl
              ? bst.cdpReachable
                ? `✓ CDP reachable at ${bst.cdpUrl}${bst.cdpVersion ? ` (${bst.cdpVersion})` : ""}`
                : `✗ CDP set to ${bst.cdpUrl} but not responding`
              : "ℹ No CDP backend configured — set up Camofox or local Chrome from Skills if Ron needs deep web access",
            ...(bst.navigateOk === true ? ["✓ Real browser navigation works"] : []),
            ...(bst.navigateOk === false ? [`⚠ Browser navigation probe failed: ${bst.navigateError ?? "unknown"}`] : []),
            bst.webSearchBackend
              ? `✓ Web-search backend configured (${bst.webSearchBackend.toUpperCase()})`
              : "ℹ No web-search backend (Tavily/Exa/Firecrawl) — Ron can read URLs but can't discover new ones",
          ]);
        } catch (e) {
          setDoctorOutput((prev) => [...prev, `⚠ Browser self-test crashed: ${e instanceof Error ? e.message : String(e)}`]);
        }
      }

      setDoctorProgress(100);

      if (result.success && configOk && pingOk) {
        setDoctorPassed(true);
        setDoctorOutput((prev) => [...prev, "", "✓ All verification checks passed."]);
      } else if (result.success) {
        setDoctorOutput((prev) => [...prev, "", "⚠ Doctor passed but post-install verification found issues — see above."]);
      } else {
        setDoctorOutput((prev) => {
          const next = [...prev, `✗ Diagnostics failed${typeof result.code === "number" ? ` (exit code ${result.code})` : ""}.`];
          if (!result.stdout.trim() && !result.stderr.trim()) {
            next.push("No diagnostics output was returned.");
          }
          return next;
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown diagnostics error";
      setDoctorProgress(100);
      setDoctorOutput((prev) => [...prev, `✗ Diagnostics crashed: ${message}`]);
    } finally {
      window.clearInterval(progressTimer);
      setDoctorRunning(false);
    }
  }, [doctorRunning]);

  const runLaunch = useCallback(async () => {
    setLaunching(true);
    setLaunchOutput(["Starting agent..."]);
    const result = await systemAPI.startAgent();
    if (result.success) {
      setLaunchOutput((prev) => [
        ...prev,
        `✓ ${agentName} is ready!`,
        "✓ Agent is running",
        "✓ All systems operational",
      ]);
    } else {
      setLaunchOutput((prev) => [...prev, `✗ Failed to start: ${result.stderr || "Unknown error"}`]);
    }
    setLaunching(false);
  }, [agentName]);

  const installContextValue = useMemo(
    () => ({
      mode,
      setMode,
      installStep,
      setInstallStep,
      installSource,
      setInstallSource,
      localAgentPath,
      setLocalAgentPath,
      replaceWithRonbotPersonalityTemplates,
      setReplaceWithRonbotPersonalityTemplates,
      installing,
      installComplete,
      installProgress,
      installOutput,
      handleInstallAgent,
      cancelInstall,
      sudoPrompt,
      closeSudoPrompt,
      submitSudoPassword,
      sudoPasswordless,
      agentName,
      setAgentName,
      selectedProvider,
      setSelectedProvider,
      apiKey,
      setApiKey,
      keySaved,
      setKeySaved,
      selectedModel,
      setSelectedModel,
      doctorRunning,
      doctorOutput,
      doctorProgress,
      doctorPassed,
      runDoctor,
      launching,
      launchOutput,
      runLaunch,
    }),
    [
      mode,
      installStep,
      installSource,
      localAgentPath,
      replaceWithRonbotPersonalityTemplates,
      installing,
      installComplete,
      installProgress,
      installOutput,
      handleInstallAgent,
      cancelInstall,
      sudoPrompt,
      closeSudoPrompt,
      submitSudoPassword,
      sudoPasswordless,
      agentName,
      selectedProvider,
      apiKey,
      keySaved,
      selectedModel,
      doctorRunning,
      doctorOutput,
      doctorProgress,
      doctorPassed,
      runDoctor,
      launching,
      launchOutput,
      runLaunch,
    ],
  );

  return (
    <>
      <InstallContext.Provider value={installContextValue}>
        {children}
      </InstallContext.Provider>
      <AlertDialog open={bundledReinstallDialogOpen} onOpenChange={setBundledReinstallDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reinstall Hermes?</AlertDialogTitle>
            <AlertDialogDescription>
              Hermes v0.13.x is already installed. Running the official installer again will re-run the latest GitHub script
              (safe, but may take several minutes). Cancel if you only wanted to open the app.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmBundledHermesReinstall}>Reinstall latest</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export const useInstall = () => {
  const ctx = useContext(InstallContext);
  if (!ctx) throw new Error("useInstall must be used within InstallProvider");
  return ctx;
};
