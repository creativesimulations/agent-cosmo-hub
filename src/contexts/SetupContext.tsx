// Hermes v0.13.0 sync — May 2026 (Ronbot)
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { useAgentConnection } from "./AgentConnectionContext";
import { probeAgent } from "@/features/setup/setupService";
import { runAgentInstall } from "@/features/setup/runAgentInstall";
import { DEFAULT_AGENT_NAME } from "@/features/setup/constants";
import type { InstallSource, SetupPhase, WizardStep } from "@/features/setup/types";
import { systemAPI } from "@/lib/systemAPI";

type SetupContextValue = {
  phase: SetupPhase;
  wizardStep: WizardStep;
  installSource: InstallSource;
  localPath: string;
  replacePersona: boolean;
  setReplacePersona: (v: boolean) => void;
  busy: boolean;
  installing: boolean;
  installSucceeded: boolean;
  installProgress: number;
  logLines: string[];
  guardAgentName: string | null;
  existingProbe: { agentName?: string } | null;

  goHub: () => void;
  goConnect: () => void;
  startBundledInstall: () => Promise<void>;
  pickLocalFolder: () => Promise<void>;
  goWizardPrereqs: (source: InstallSource, localPath?: string) => void;
  setWizardStep: (step: WizardStep) => void;
  runInstall: () => Promise<void>;
  cancelInstall: () => void;
  finishConnect: () => Promise<boolean>;
  guardConnect: () => Promise<boolean>;
  guardRename: (name: string) => Promise<boolean>;
  guardResetAndReinstall: (onLog: (lines: string[]) => void) => Promise<boolean>;

  sudoPrompt: { open: boolean; reason: string };
  closeSudoPrompt: () => void;
  submitSudoPassword: (password: string) => void;
  sudoPasswordless: () => void;
};

const SetupContext = createContext<SetupContextValue | null>(null);

export function SetupProvider({ children }: { children: ReactNode }) {
  const { refresh: refreshConnection } = useAgentConnection();

  const [phase, setPhase] = useState<SetupPhase>("hub");
  const [wizardStep, setWizardStep] = useState<WizardStep>("prereqs");
  const [installSource, setInstallSource] = useState<InstallSource>("bundled");
  const [localPath, setLocalPath] = useState("");
  const [replacePersona, setReplacePersona] = useState(false);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installSucceeded, setInstallSucceeded] = useState(false);
  const [installProgress, setInstallProgress] = useState(0);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [guardAgentName, setGuardAgentName] = useState<string | null>(null);
  const [existingProbe, setExistingProbe] = useState<{ agentName?: string } | null>(null);

  const installGenRef = useRef(0);
  const probeGenRef = useRef(0);
  const sudoResolverRef = useRef<((password: string | null) => void) | null>(null);
  const [sudoPrompt, setSudoPrompt] = useState({ open: false, reason: "" });

  const appendLog = useCallback((lines: string[]) => {
    setLogLines((prev) => [...prev, ...lines]);
  }, []);

  const resetWizard = useCallback((source: InstallSource, path = "") => {
    setInstallSource(source);
    setLocalPath(path);
    setReplacePersona(source !== "local");
    setLogLines([]);
    setInstallProgress(0);
    setInstallSucceeded(false);
    setWizardStep("prereqs");
    setPhase("wizard");
  }, []);

  const goHub = useCallback(() => {
    probeGenRef.current += 1;
    installGenRef.current += 1;
    setPhase("hub");
    setGuardAgentName(null);
    setExistingProbe(null);
  }, []);

  const goConnect = useCallback(() => setPhase("connect"), []);

  const finishConnect = useCallback(async () => {
    const ok = await refreshConnection();
    if (!ok) {
      toast.error("No agent detected", {
        description: "Ronbot needs a working Hermes CLI and ~/.hermes directory.",
      });
    }
    return ok;
  }, [refreshConnection]);

  const probeForExisting = useCallback(async () => {
    const gen = ++probeGenRef.current;
    const probe = await probeAgent();
    if (probeGenRef.current !== gen) return null;
    if (probe.ready) {
      setGuardAgentName(probe.agentName ?? "your agent");
      setExistingProbe({ agentName: probe.agentName });
      setPhase("guard");
      return probe;
    }
    return null;
  }, []);

  const startBundledInstall = useCallback(async () => {
    setBusy(true);
    resetWizard("bundled");
    try {
      const existing = await probeForExisting();
      if (!existing) setWizardStep("prereqs");
    } finally {
      setBusy(false);
    }
  }, [probeForExisting, resetWizard]);

  const pickLocalFolder = useCallback(async () => {
    const toastId = "setup-pick-folder";
    toast.loading("Opening folder picker…", {
      id: toastId,
      description: "On Linux/WSL the dialog may appear behind Ronbot.",
    });
    try {
      const res = await systemAPI.selectFolder({ title: "Select your agent folder" });
      if (!res.success) {
        toast.error("Could not open folder picker", { id: toastId, description: res.error });
        return;
      }
      if (res.canceled || !res.path) {
        toast.info("No folder selected", { id: toastId });
        return;
      }
      toast.success("Folder selected", { id: toastId, description: res.path, duration: 6000 });
      resetWizard("local", res.path);
    } catch (e) {
      toast.error("Folder picker failed", {
        id: toastId,
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }, [resetWizard]);

  const goWizardPrereqs = useCallback(
    (source: InstallSource, path = "") => resetWizard(source, path),
    [resetWizard],
  );

  const requestSudo = useCallback((reason: string) => {
    return new Promise<string | null>((resolve) => {
      sudoResolverRef.current = resolve;
      setSudoPrompt({ open: true, reason });
    });
  }, []);

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

  const runInstall = useCallback(async () => {
    const gen = ++installGenRef.current;
    setInstalling(true);
    setInstallSucceeded(false);
    setInstallProgress(5);
    setLogLines([]);

    const progressTimer = window.setInterval(() => {
      if (installGenRef.current !== gen) return;
      setInstallProgress((p) => Math.min(p + 2, 90));
    }, 800);

    const seedPersona = installSource === "bundled" || replacePersona;
    const result = await runAgentInstall({
      source: installSource,
      localPath: localPath || undefined,
      seedPersona,
      agentName: DEFAULT_AGENT_NAME,
      log: (lines) => {
        if (installGenRef.current === gen) appendLog(lines);
      },
      requestSudo,
      isAborted: () => installGenRef.current !== gen,
    });

    window.clearInterval(progressTimer);
    if (installGenRef.current !== gen) return;

    setInstalling(false);
    if (result.ok) {
      setInstallProgress(100);
      const connected = await refreshConnection();
      if (connected) {
        setInstallSucceeded(true);
        setWizardStep("done");
        toast.success("Agent installed");
      } else {
        appendLog(["✗ Install completed but connection verification failed."]);
        toast.error("Could not verify connection after install");
      }
    } else if (!result.cancelled) {
      toast.error("Installation failed", { description: result.message });
    }
  }, [installSource, localPath, replacePersona, appendLog, requestSudo, refreshConnection]);

  const cancelInstall = useCallback(() => {
    installGenRef.current += 1;
    closeSudoPrompt();
    void systemAPI.killStream();
    setInstalling(false);
    appendLog(["✗ Installation cancelled."]);
  }, [closeSudoPrompt, appendLog]);

  const guardConnect = useCallback(() => finishConnect(), [finishConnect]);

  const guardRename = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return false;
      const res = await systemAPI.setAgentName(trimmed);
      if (!res.success) {
        toast.error("Could not rename agent");
        return false;
      }
      return finishConnect();
    },
    [finishConnect],
  );

  const guardResetAndReinstall = useCallback(
    async (onLog: (lines: string[]) => void) => {
      onLog(["Uninstalling existing Hermes…"]);
      const result = await systemAPI.hermesUninstall((event) => {
        if (event.data) onLog([event.data.trim()].filter(Boolean));
      });
      if (!result.success) {
        onLog([`✗ Uninstall failed: ${result.stderr || result.stdout || "unknown"}`]);
        return false;
      }
      onLog(["✓ Uninstalled. Starting fresh install wizard."]);
      goWizardPrereqs("bundled");
      return true;
    },
    [goWizardPrereqs],
  );

  const value = useMemo<SetupContextValue>(
    () => ({
      phase,
      wizardStep,
      installSource,
      localPath,
      replacePersona,
      setReplacePersona,
      busy,
      installing,
      installSucceeded,
      installProgress,
      logLines,
      guardAgentName,
      existingProbe,
      goHub,
      goConnect,
      startBundledInstall,
      pickLocalFolder,
      goWizardPrereqs,
      setWizardStep,
      runInstall,
      cancelInstall,
      finishConnect,
      guardConnect,
      guardRename,
      guardResetAndReinstall,
      sudoPrompt,
      closeSudoPrompt,
      submitSudoPassword,
      sudoPasswordless,
    }),
    [
      phase,
      wizardStep,
      installSource,
      localPath,
      replacePersona,
      busy,
      installing,
      installSucceeded,
      installProgress,
      logLines,
      guardAgentName,
      existingProbe,
      goHub,
      goConnect,
      startBundledInstall,
      pickLocalFolder,
      goWizardPrereqs,
      runInstall,
      cancelInstall,
      finishConnect,
      guardConnect,
      guardRename,
      guardResetAndReinstall,
      sudoPrompt,
      closeSudoPrompt,
      submitSudoPassword,
      sudoPasswordless,
    ],
  );

  return <SetupContext.Provider value={value}>{children}</SetupContext.Provider>;
}

export function useSetup() {
  const ctx = useContext(SetupContext);
  if (!ctx) throw new Error("useSetup must be used within SetupProvider");
  return ctx;
}
