import { createContext, useContext, useRef, useState, ReactNode, useCallback } from "react";
import { systemAPI } from "@/lib/systemAPI";
import { sudoAPI } from "@/lib/systemAPI/sudo";

export type Mode = "choose" | "connect" | "install";
export type InstallStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

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
  { id: "web", label: "Web Interface", description: "Built-in web UI for the agent", pipExtra: "web" },
];

interface InstallContextValue {
  // Top-level mode
  mode: Mode;
  setMode: (m: Mode) => void;

  // Wizard step
  installStep: InstallStep;
  setInstallStep: (s: InstallStep) => void;

  // Optional features
  selectedFeatures: string[];
  toggleFeature: (id: string) => void;

  // Install run state
  installing: boolean;
  installComplete: boolean;
  installProgress: number;
  installOutput: string[];

  // Actions
  handleInstallAgent: () => Promise<void>;
  cancelInstall: () => void;

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
  doctorPassed: boolean;
  runDoctor: () => Promise<void>;

  launching: boolean;
  launchOutput: string[];
  runLaunch: () => Promise<void>;
}

const InstallContext = createContext<InstallContextValue | null>(null);

export const InstallProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setMode] = useState<Mode>("choose");
  const [installStep, setInstallStep] = useState<InstallStep>(0);

  const [selectedFeatures, setSelectedFeatures] = useState<string[]>(["voice", "messaging"]);

  const [installing, setInstalling] = useState(false);
  const [installComplete, setInstallComplete] = useState(false);
  const [installProgress, setInstallProgress] = useState(0);
  const [installOutput, setInstallOutput] = useState<string[]>([]);
  const installIdRef = useRef(0);

  const [agentName, setAgentName] = useState("Ron");
  const [selectedProvider, setSelectedProvider] = useState("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [selectedModel, setSelectedModel] = useState("openrouter/nous/hermes-3-llama-3.1-70b");

  const [doctorRunning, setDoctorRunning] = useState(false);
  const [doctorOutput, setDoctorOutput] = useState<string[]>([]);
  const [doctorPassed, setDoctorPassed] = useState(false);

  const [launching, setLaunching] = useState(false);
  const [launchOutput, setLaunchOutput] = useState<string[]>([]);

  const toggleFeature = useCallback((featureId: string) => {
    setSelectedFeatures((prev) =>
      prev.includes(featureId) ? prev.filter((f) => f !== featureId) : [...prev, featureId]
    );
  }, []);

  const handleInstallAgent = useCallback(async () => {
    const myInstallId = ++installIdRef.current;
    setInstalling(true);
    setInstallComplete(false);
    setInstallProgress(0);
    const extrasLabel = selectedFeatures.length > 0 ? ` with extras: ${selectedFeatures.join(", ")}` : "";
    setInstallOutput([`Starting agent installation${extrasLabel}...`]);

    if (selectedFeatures.includes("voice")) {
      setInstallOutput((prev) => [...prev, "Checking for ffmpeg (required for Voice / TTS)..."]);
      const ffCheck = await systemAPI.checkFfmpeg();
      if (installIdRef.current !== myInstallId) return;
      if (ffCheck.found) {
        setInstallOutput((prev) => [...prev, `✓ ffmpeg already installed (${ffCheck.version ?? "ok"})`]);
      } else {
        setInstallOutput((prev) => [
          ...prev,
          "ffmpeg not found — installing via your OS package manager...",
          "(Windows: winget · macOS: brew · you may see a UAC prompt)",
        ]);
        const ffInstall = await systemAPI.installFfmpeg();
        if (installIdRef.current !== myInstallId) return;
        if (ffInstall.success) {
          setInstallOutput((prev) => [...prev, "✓ ffmpeg installed successfully"]);
        } else {
          setInstallOutput((prev) => [
            ...prev,
            "⚠ Could not install ffmpeg automatically — Voice / TTS will be limited.",
            (ffInstall.stderr || "").trim() || "(no error message)",
            "You can install it manually later and restart the agent.",
          ]);
        }
      }
    }

    setInstallOutput((prev) => [...prev, "Verifying Python and pip...", "Downloading installer script..."]);

    const progressInterval = setInterval(() => {
      if (installIdRef.current !== myInstallId) {
        clearInterval(progressInterval);
        return;
      }
      setInstallProgress((prev) => Math.min(prev + 2, 90));
    }, 800);

    const extras = selectedFeatures.map((f) => OPTIONAL_FEATURES.find((o) => o.id === f)?.pipExtra).filter(Boolean);
    const result = await systemAPI.installHermes(extras.length > 0 ? extras as string[] : undefined);

    clearInterval(progressInterval);

    if (installIdRef.current !== myInstallId) return;

    setInstallProgress(100);

    if (result.success) {
      setInstallOutput((prev) => [...prev, "✓ Agent installed successfully!"]);
      setInstallComplete(true);
      setTimeout(() => {
        if (installIdRef.current === myInstallId) setInstallStep(3);
      }, 1000);
    } else {
      const stderr = (result.stderr || "").trim();
      const stdout = (result.stdout || "").trim();
      const tail = (text: string, n = 20) => text.split("\n").slice(-n).join("\n");
      const lines: string[] = [`✗ Installation failed (exit code ${result.code ?? "?"})`];
      if (stderr) lines.push("--- stderr ---", tail(stderr));
      if (stdout) lines.push("--- stdout (last 20 lines) ---", tail(stdout));
      if (!stderr && !stdout) {
        lines.push(
          "No output was captured from the installer.",
          "Likely cause: the install script could not be reached (network/proxy), curl/bash missing, or it exited before printing anything.",
          "Try running this manually in a terminal to see the real error:",
          "  curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash"
        );
      }
      setInstallOutput((prev) => [...prev, ...lines]);
    }
    setInstalling(false);
  }, [selectedFeatures]);

  const cancelInstall = useCallback(() => {
    installIdRef.current++;
    setInstalling(false);
    setInstallComplete(false);
    setInstallProgress(0);
    setInstallOutput((prev) => [...prev, "✗ Installation cancelled by user."]);
  }, []);

  const runDoctor = useCallback(async () => {
    setDoctorRunning(true);
    setDoctorOutput(["Running diagnostics..."]);
    const result = await systemAPI.hermesDoctor();
    const lines = result.stdout.split("\n").filter(Boolean);
    setDoctorOutput((prev) => [...prev, ...lines]);
    setDoctorPassed(result.success);
    setDoctorRunning(false);
  }, []);

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

  return (
    <InstallContext.Provider
      value={{
        mode,
        setMode,
        installStep,
        setInstallStep,
        selectedFeatures,
        toggleFeature,
        installing,
        installComplete,
        installProgress,
        installOutput,
        handleInstallAgent,
        cancelInstall,
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
        doctorPassed,
        runDoctor,
        launching,
        launchOutput,
        runLaunch,
      }}
    >
      {children}
    </InstallContext.Provider>
  );
};

export const useInstall = () => {
  const ctx = useContext(InstallContext);
  if (!ctx) throw new Error("useInstall must be used within InstallProvider");
  return ctx;
};
