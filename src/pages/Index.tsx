import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useChat } from "@/contexts/ChatContext";
import {
  Zap,
  Link2,
  Download,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Server,
  Globe,
  KeyRound,
  User,
  Cpu,
  Terminal,
  Stethoscope,
  Settings2,
  XCircle,
  FolderOpen,
  HardDrive,
  Package,
} from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
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
import PrerequisiteCheck from "./PrerequisiteCheck";
import InstallPreflight from "@/components/install/InstallPreflight";
import { systemAPI } from "@/lib/systemAPI";
import { useInstall, OPTIONAL_FEATURES, InstallStep } from "@/contexts/InstallContext";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import ronbotLogo from "@/assets/ronbot-logo.png";
import { LLM_PROVIDERS, MODEL_OPTIONS } from "@/lib/llmCatalog";

const installSteps = [
  { title: "System Prerequisites", desc: "Detect & install required dependencies" },
  { title: "Optional Features", desc: "Choose which extras to install" },
  { title: "Install Agent", desc: "Download and install the AI agent framework" },
  { title: "Name Your Agent", desc: "Give your AI agent a name" },
  { title: "API Keys", desc: "Configure your LLM provider credentials" },
  { title: "Choose Model", desc: "Select your preferred AI model" },
  { title: "Verify Installation", desc: "Run diagnostics to confirm everything works" },
  { title: "Launch", desc: "Start your AI agent" },
];

// Provider definitions and model lists are sourced from src/lib/llmCatalog.ts
// to keep installation and the LLM tab in sync.

const Index = () => {
  // Persistent install/wizard state lives in context so navigating
  // away and back never loses progress.
  const {
    mode, setMode,
    installStep, setInstallStep,
    installSource, setInstallSource,
    localAgentPath, setLocalAgentPath,
    selectedFeatures, toggleFeature,
    installing, installComplete, installProgress, installOutput,
    handleInstallAgent, cancelInstall,
    agentName, setAgentName,
    selectedProvider, setSelectedProvider,
    apiKey, setApiKey,
    keySaved, setKeySaved,
    selectedModel, setSelectedModel,
    doctorRunning, doctorOutput, doctorProgress, doctorPassed, runDoctor,
    launching, launchOutput, runLaunch,
  } = useInstall();
  const { clearAll: clearChatHistory, startNewSession } = useChat();

  // Purely local UI state — fine to reset on remount
  const [connecting, setConnecting] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [preflightReady, setPreflightReady] = useState(false);

  // Guard-screen state (shown when ~/.hermes already exists)
  const [existingAgentName, setExistingAgentName] = useState<string | null>(null);
  const [pendingSource, setPendingSource] = useState<"bundled" | "local">("bundled");
  const [pendingLocalPath, setPendingLocalPath] = useState<string>("");
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetOutput, setResetOutput] = useState<string[]>([]);

  const navigate = useNavigate();
  const { refresh: refreshConnection, markConnected } = useAgentConnection();

  const handleConnect = async () => {
    setConnecting(true);
    const ok = await refreshConnection();
    setConnecting(false);
    if (ok) {
      markConnected("~/.hermes");
      navigate("/dashboard");
    }
  };

  /** Probe ~/.hermes; if a real install is there, route the user to the
   *  guard screen so a single-agent app never silently overwrites their
   *  existing agent's persona, secrets, and chat history. */
  const beginInstallFlow = async (source: "bundled" | "local", localPath = "") => {
    setPendingSource(source);
    setPendingLocalPath(localPath);
    try {
      const installed = await systemAPI.isConfigured();
      if (installed) {
        const name = (await systemAPI.getAgentName()) || "your agent";
        setExistingAgentName(name);
        setRenameValue(name);
        setMode("guard");
        return;
      }
    } catch { /* fall through to normal install */ }
    setInstallSource(source);
    setLocalAgentPath(localPath);
    setMode("install");
    setInstallStep(0);
  };

  const handlePickLocalAgent = async () => {
    const res = await systemAPI.selectFolder({ title: "Select your agent folder" });
    if (!res.success || res.canceled || !res.path) return;
    await beginInstallFlow("local", res.path);
  };

  const handleStartBundledInstall = () => {
    void beginInstallFlow("bundled");
  };

  const handleGuardConnect = async () => {
    markConnected("~/.hermes");
    await refreshConnection();
    navigate("/dashboard");
  };

  const handleGuardRename = async () => {
    const name = renameValue.trim();
    if (!name) return;
    setRenaming(true);
    try {
      const res = await systemAPI.setAgentName(name);
      if (!res.success) {
        toast.error("Could not rename agent");
        return;
      }
      // The running agent caches persona on the session — drop history + session
      // so the next message starts fresh under the new name.
      clearChatHistory();
      startNewSession();
      markConnected("~/.hermes");
      await refreshConnection();
      toast.success(`Renamed to ${name}`, { description: "Chat history was cleared so the new persona takes effect." });
      navigate("/dashboard");
    } finally {
      setRenaming(false);
    }
  };

  const handleGuardReset = async () => {
    setResetting(true);
    setResetOutput(["Removing existing agent..."]);
    try {
      const res = await systemAPI.hermesUninstall((event) => {
        if ((event.type === "stdout" || event.type === "stderr") && event.data) {
          const lines = event.data.replace(/\r/g, "\n").split("\n").map((l) => l.trimEnd()).filter(Boolean);
          if (lines.length) setResetOutput((prev) => [...prev, ...lines]);
        }
      });
      if (!res.success) {
        setResetOutput((prev) => [...prev, `✗ Uninstall failed (exit ${res.code ?? "?"}). You can still try the install — it may overwrite the existing folder.`]);
      } else {
        setResetOutput((prev) => [...prev, "✓ Existing agent removed."]);
      }
      clearChatHistory();
      startNewSession();
      setExistingAgentName(null);
      setShowResetConfirm(false);
      setInstallSource(pendingSource);
      setLocalAgentPath(pendingLocalPath);
      setMode("install");
      setInstallStep(0);
    } finally {
      setResetting(false);
    }
  };

  const handleSaveApiKey = async () => {
    const provider = LLM_PROVIDERS.find((p) => p.id === selectedProvider);
    if (!provider || !provider.envVar) {
      setKeySaved(true);
      return;
    }
    const saved = await systemAPI.secrets.set(provider.envVar, apiKey);
    setKeySaved(saved);
  };

  const handleSaveModel = async () => {
    await systemAPI.writeInitialConfig({ model: selectedModel, name: agentName });
    await refreshConnection();
    setInstallStep(6);
  };

  const handleConfirmCancel = () => {
    cancelInstall();
    setShowCancelDialog(false);
  };

  const currentProvider = LLM_PROVIDERS.find((p) => p.id === selectedProvider);
  const needsApiKey = currentProvider?.envVar !== "";
  const installLogRef = useRef<HTMLDivElement>(null);
  const doctorLogRef = useRef<HTMLDivElement>(null);
  const launchLogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (installLogRef.current) {
      installLogRef.current.scrollTop = installLogRef.current.scrollHeight;
    }
  }, [installOutput]);

  useEffect(() => {
    if (doctorLogRef.current) {
      doctorLogRef.current.scrollTop = doctorLogRef.current.scrollHeight;
    }
  }, [doctorOutput]);

  useEffect(() => {
    if (launchLogRef.current) {
      launchLogRef.current.scrollTop = launchLogRef.current.scrollHeight;
    }
  }, [launchOutput]);

  return (
    <div className="flex-1 flex items-center justify-center min-h-screen p-8">
      <AnimatePresence mode="wait">
        {mode === "choose" && (
          <motion.div
            key="choose"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="max-w-2xl w-full space-y-8"
          >
            <div className="text-center space-y-4">
              <motion.img
                src={ronbotLogo}
                alt="Ronbot"
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="w-20 h-20 mx-auto"
              />
              <motion.h1
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-4xl font-bold text-foreground tracking-tight"
              >
                Ronbot
              </motion.h1>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="text-muted-foreground text-lg"
              >
                AI Agent Control Panel
              </motion.p>
            </div>

            <div className="grid sm:grid-cols-3 grid-cols-1 gap-4">
              <GlassCard
                className="cursor-pointer hover:border-primary/30 transition-all group"
                onClick={() => setMode("connect")}
              >
                <div className="space-y-3">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                    <Link2 className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">Connect</h3>
                  <p className="text-sm text-muted-foreground">
                    Detect an agent already installed at <code className="text-foreground text-xs">~/.hermes</code>
                  </p>
                </div>
              </GlassCard>

              <GlassCard
                className="cursor-pointer hover:border-accent/30 transition-all group"
                onClick={handleStartBundledInstall}
              >
                <div className="space-y-3">
                  <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center group-hover:bg-accent/20 transition-colors">
                    <Package className="w-6 h-6 text-accent" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">Install Ronbot Agent</h3>
                  <p className="text-sm text-muted-foreground">
                    Download and install the bundled Ronbot agent
                  </p>
                </div>
              </GlassCard>

              <GlassCard
                className="cursor-pointer hover:border-primary/30 transition-all group"
                onClick={handlePickLocalAgent}
              >
                <div className="space-y-3">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                    <FolderOpen className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">Use My Own Agent</h3>
                  <p className="text-sm text-muted-foreground">
                    Pick a folder containing an agent you already have
                  </p>
                </div>
              </GlassCard>
            </div>
          </motion.div>
        )}

        {mode === "connect" && (
          <motion.div
            key="connect"
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            className="max-w-md w-full space-y-6"
          >
            <Button variant="ghost" size="sm" onClick={() => setMode("choose")} className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>

            <GlassCard className="space-y-6">
              <div className="space-y-2">
                <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
                  <Server className="w-5 h-5 text-primary" />
                  Connect to Local Agent
                </h2>
                <p className="text-sm text-muted-foreground">
                  Detect an agent already installed on this machine. Your agent runs locally as a CLI in <code className="text-foreground">~/.hermes</code> — no URL is needed.
                </p>
              </div>
              <div className="space-y-4">
                <div className="glass-subtle rounded-lg p-3 flex items-start gap-2">
                  <Globe className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    We&apos;ll look for a local Hermes install in <code className="text-foreground">~/.hermes</code> and verify that the CLI is available. If nothing is found, head back and choose <strong>Install &amp; Setup</strong>.
                  </p>
                </div>
                <Button onClick={handleConnect} disabled={connecting} className="w-full gradient-primary text-primary-foreground hover:opacity-90">
                  {connecting ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Detecting...</>
                  ) : (
                    <><ArrowRight className="w-4 h-4 mr-2" /> Detect &amp; Connect</>
                  )}
                </Button>
              </div>
            </GlassCard>
          </motion.div>
        )}

        {mode === "guard" && (
          <motion.div
            key="guard"
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            className="max-w-md w-full space-y-6"
          >
            <Button variant="ghost" size="sm" onClick={() => setMode("choose")} className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>

            <GlassCard className="space-y-5">
              <div className="space-y-2">
                <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-success" />
                  You already have an agent
                </h2>
                <p className="text-sm text-muted-foreground">
                  An agent named <span className="text-primary font-semibold">{existingAgentName}</span> is already installed at <code className="text-foreground text-xs">~/.hermes</code>. Ronbot is built for a single agent — pick how you want to continue.
                </p>
              </div>

              <div className="space-y-3">
                <Button
                  onClick={handleGuardConnect}
                  className="w-full gradient-primary text-primary-foreground"
                >
                  <Link2 className="w-4 h-4 mr-2" /> Connect to {existingAgentName}
                </Button>

                <div className="glass-subtle rounded-lg p-3 space-y-2">
                  <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-primary" /> Rename this agent
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Updates the persona file and clears chat history so the new name takes effect on the next message. Keeps secrets, skills, and the venv.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      placeholder="New name"
                      disabled={renaming}
                      className="bg-background/50 border-white/10 text-sm"
                    />
                    <Button
                      onClick={handleGuardRename}
                      disabled={renaming || !renameValue.trim() || renameValue.trim() === existingAgentName}
                      size="sm"
                      variant="secondary"
                    >
                      {renaming ? <Loader2 className="w-4 h-4 animate-spin" /> : "Rename"}
                    </Button>
                  </div>
                </div>

                <Button
                  onClick={() => setShowResetConfirm(true)}
                  variant="ghost"
                  className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <XCircle className="w-4 h-4 mr-2" /> Reset & install fresh
                </Button>
              </div>

              {resetting && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" /> Removing existing agent...
                  </div>
                  <div className="font-mono text-xs space-y-1 max-h-32 overflow-y-auto pr-1 glass-subtle rounded-lg p-2">
                    {resetOutput.map((line, i) => (
                      <p key={i} className={
                        line.startsWith("✓") ? "text-success" :
                        line.startsWith("✗") ? "text-destructive" :
                        "text-foreground/70"
                      }>{line}</p>
                    ))}
                  </div>
                </div>
              )}
            </GlassCard>
          </motion.div>
        )}


          <motion.div
            key="install"
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            className="max-w-lg w-full space-y-6"
          >
            {installing ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowCancelDialog(true)}
                className="text-destructive hover:text-destructive"
              >
                <XCircle className="w-4 h-4 mr-1" /> Cancel installation
              </Button>
            ) : doctorRunning ? (
              <div className="h-9 flex items-center text-xs text-muted-foreground">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Diagnostics in progress...
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setMode("choose"); setInstallStep(0); }}
                className="text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
            )}

            {/* Step Indicator */}
            <div className="flex items-center gap-1">
              {installSteps.map((_, i) => (
                <div key={i} className="flex-1">
                  <div className={cn("h-1 rounded-full transition-all", i <= installStep ? "gradient-primary" : "bg-white/10")} />
                </div>
              ))}
            </div>

            <GlassCard className="space-y-5">
              <div className="space-y-1">
                <p className="text-xs text-primary font-mono">Step {installStep + 1} of {installSteps.length}</p>
                <h2 className="text-xl font-semibold text-foreground">{installSteps[installStep].title}</h2>
                <p className="text-sm text-muted-foreground">{installSteps[installStep].desc}</p>
              </div>

              <div className="glass-subtle rounded-lg p-4 space-y-3">
                {/* Step 0: Prerequisites */}
                {installStep === 0 && (
                  <PrerequisiteCheck onComplete={() => setInstallStep(1)} />
                )}

                {/* Step 1: Optional Features */}
                {installStep === 1 && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Settings2 className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium text-foreground">Optional Features</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Select which optional features to include. You can change these later.
                    </p>

                    <div className="space-y-2">
                      {OPTIONAL_FEATURES.map((feature) => (
                        <button
                          key={feature.id}
                          onClick={() => toggleFeature(feature.id)}
                          className={cn(
                            "w-full text-left glass-subtle rounded-lg p-3 transition-all flex items-start gap-3",
                            selectedFeatures.includes(feature.id)
                              ? "border border-primary/20 bg-primary/5"
                              : "border border-transparent"
                          )}
                        >
                          <Checkbox
                            checked={selectedFeatures.includes(feature.id)}
                            onCheckedChange={() => toggleFeature(feature.id)}
                            className="mt-0.5"
                          />
                          <div>
                            <p className="text-sm font-medium text-foreground">{feature.label}</p>
                            <p className="text-xs text-muted-foreground">{feature.description}</p>
                          </div>
                        </button>
                      ))}
                    </div>

                    <Button
                      onClick={() => setInstallStep(2)}
                      className="w-full gradient-primary text-primary-foreground"
                    >
                      Continue <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                )}

                {/* Step 2: Install Agent */}
                {installStep === 2 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Download className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium text-foreground">Install Agent</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      This will {installSource === "local" ? "install your local agent folder" : "download and install the Ronbot agent framework"}
                      {selectedFeatures.length > 0 && ` with ${selectedFeatures.map(f => OPTIONAL_FEATURES.find(o => o.id === f)?.label).filter(Boolean).join(", ")}`}.
                    </p>

                    <div className="glass-subtle rounded-lg p-3 flex items-start gap-2 border border-white/5">
                      {installSource === "local" ? (
                        <>
                          <HardDrive className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-foreground font-medium">Source: local folder</p>
                            <p className="text-xs text-muted-foreground font-mono truncate">{localAgentPath || "(no folder selected)"}</p>
                            {!installing && (
                              <button
                                onClick={handlePickLocalAgent}
                                className="text-xs text-primary hover:underline mt-1"
                              >
                                Change folder
                              </button>
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          <Package className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-foreground font-medium">Source: Ronbot bundled agent</p>
                            <p className="text-xs text-muted-foreground">Downloaded from the official Ronbot repository</p>
                          </div>
                        </>
                      )}
                    </div>

                    {!installing && !installComplete && (
                      <InstallPreflight onReadyChange={setPreflightReady} />
                    )}

                    <div ref={installLogRef} className="font-mono text-xs space-y-1 max-h-40 overflow-y-auto pr-1">
                      {installOutput.map((line, i) => (
                        <p key={i} className={
                          line.startsWith("✓") ? "text-success" :
                          line.startsWith("✗") ? "text-destructive" :
                          line.startsWith("$") ? "text-muted-foreground" :
                          "text-foreground/70"
                        }>
                          {line}
                        </p>
                      ))}
                    </div>

                    {installing && (
                      <div className="space-y-1">
                        <div className="relative">
                          <Progress value={installProgress} className="h-1" />
                          {installProgress >= 90 && (
                            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
                              <div className="h-full w-1/3 bg-primary/40 animate-[install-shimmer_1.6s_ease-in-out_infinite]" />
                            </div>
                          )}
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            {installProgress >= 90
                              ? "Installing dependencies — this can take a few minutes…"
                              : "Working…"}
                          </span>
                          <span>{installProgress}%</span>
                        </div>
                      </div>
                    )}

                    {!installing && !installComplete && (() => {
                      const missingLocalPath = installSource === "local" && !localAgentPath;
                      const disabled = !preflightReady || missingLocalPath;
                      return (
                        <Button
                          onClick={handleInstallAgent}
                          disabled={disabled}
                          className="w-full gradient-primary text-primary-foreground disabled:opacity-50"
                        >
                          {!preflightReady
                            ? "Insufficient resources"
                            : missingLocalPath
                            ? "Select a folder first"
                            : installOutput.length > 0
                            ? "Retry Installation"
                            : installSource === "local"
                            ? "Install From Folder"
                            : "Install Agent"}
                          {!disabled && <ArrowRight className="w-4 h-4 ml-1" />}
                        </Button>
                      );
                    })()}
                  </div>
                )}

                {/* Step 3: Name Your Agent */}
                {installStep === 3 && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                      <User className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium text-foreground">Name Your Agent</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Give your AI agent a personal name. This is who you'll be chatting with!
                    </p>
                    <Input
                      value={agentName}
                      onChange={(e) => setAgentName(e.target.value)}
                      placeholder="Ron"
                      className="bg-background/50 border-white/10 text-lg font-semibold text-center"
                    />
                    <div className="glass-subtle rounded-lg p-3 text-center">
                      <p className="text-sm text-muted-foreground">
                        Your agent will be called: <span className="text-primary font-semibold">{agentName || "Ron"}</span>
                      </p>
                    </div>
                    <Button
                      onClick={() => setInstallStep(4)}
                      className="w-full gradient-primary text-primary-foreground"
                    >
                      Continue <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                )}

                {/* Step 4: API Keys */}
                {installStep === 4 && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                      <KeyRound className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium text-foreground">LLM Provider API Key</span>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Choose your LLM provider and enter your API key. This will be stored securely on your machine.
                    </p>

                    <div className="grid grid-cols-2 gap-2">
                      {LLM_PROVIDERS.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => {
                            setSelectedProvider(p.id);
                            setApiKey("");
                            setKeySaved(false);
                            setSelectedModel(p.defaultModel);
                          }}
                          className={cn(
                            "px-3 py-2 rounded-lg border text-sm text-foreground transition-all text-left",
                            selectedProvider === p.id
                              ? "border-primary/50 bg-primary/10"
                              : "border-white/10 hover:border-primary/30 hover:bg-primary/5"
                          )}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>

                    {currentProvider && (
                      <div className="glass-subtle rounded-lg p-3 text-xs text-muted-foreground">
                        {currentProvider.hint}
                      </div>
                    )}

                    {needsApiKey && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">{currentProvider?.envVar}</label>
                        <Input
                          type="password"
                          value={apiKey}
                          onChange={(e) => { setApiKey(e.target.value); setKeySaved(false); }}
                          placeholder={currentProvider?.prefix ? `${currentProvider.prefix}...` : "Enter API key"}
                          className="bg-background/50 border-white/10 font-mono text-sm"
                        />
                      </div>
                    )}

                    {keySaved && (
                      <div className="glass-subtle rounded-lg p-2 border border-success/20">
                        <p className="text-xs text-success flex items-center gap-2">
                          <CheckCircle2 className="w-3 h-3" /> API key saved securely
                        </p>
                      </div>
                    )}

                    <div className="flex gap-2">
                      {!keySaved && (
                        <Button
                          onClick={handleSaveApiKey}
                          disabled={needsApiKey && !apiKey}
                          className="flex-1 gradient-primary text-primary-foreground"
                        >
                          {needsApiKey ? "Save Key" : "Skip (No Key Needed)"} <CheckCircle2 className="w-4 h-4 ml-1" />
                        </Button>
                      )}
                      {keySaved && (
                        <Button
                          onClick={() => setInstallStep(5)}
                          className="flex-1 gradient-primary text-primary-foreground"
                        >
                          Continue <ArrowRight className="w-4 h-4 ml-1" />
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* Step 5: Choose Model */}
                {installStep === 5 && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Cpu className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium text-foreground">Choose Model</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Select the default model for your agent. You can change this anytime from the settings.
                    </p>

                    <div className="space-y-2">
                      {(MODEL_OPTIONS[selectedProvider] || []).map((model) => (
                        <button
                          key={model.id}
                          onClick={() => setSelectedModel(model.id)}
                          className={cn(
                            "w-full px-3 py-2 rounded-lg border text-sm text-foreground transition-all text-left font-mono",
                            selectedModel === model.id
                              ? "border-primary/50 bg-primary/10"
                              : "border-white/10 hover:border-primary/30 hover:bg-primary/5"
                          )}
                        >
                          {model.label}
                        </button>
                      ))}
                    </div>

                    <Button
                      onClick={handleSaveModel}
                      className="w-full gradient-primary text-primary-foreground"
                    >
                      Save & Continue <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                )}

                {/* Step 6: Verify */}
                {installStep === 6 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Stethoscope className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium text-foreground">Verify Installation</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Run diagnostics to verify everything is configured correctly.
                    </p>

                    <div ref={doctorLogRef} className="font-mono text-xs space-y-1 max-h-40 overflow-y-auto pr-1">
                      {doctorOutput.map((line, i) => (
                        <p key={i} className={
                          line.startsWith("✓") ? "text-success" :
                          line.startsWith("✗") ? "text-destructive" :
                          line.startsWith("$") ? "text-muted-foreground" :
                          "text-foreground/70"
                        }>
                          {line}
                        </p>
                      ))}
                    </div>

                    {doctorRunning && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="w-4 h-4 animate-spin" /> Running diagnostics...
                        </div>
                        <div className="space-y-1">
                          <Progress value={doctorProgress} className="h-1" />
                          <p className="text-xs text-muted-foreground text-right">{doctorProgress}%</p>
                        </div>
                      </div>
                    )}

                    {!doctorPassed && (
                      <Button onClick={runDoctor} disabled={doctorRunning} className="w-full gradient-primary text-primary-foreground disabled:opacity-50">
                        {doctorRunning ? (
                          <><Loader2 className="w-4 h-4 animate-spin" /> Diagnostics Running...</>
                        ) : (
                          <>Run Diagnostics <Stethoscope className="w-4 h-4 ml-1" /></>
                        )}
                      </Button>
                    )}

                    {doctorPassed && (
                      <>
                        <div className="glass-subtle rounded-lg p-2 border border-success/20">
                          <p className="text-xs text-success flex items-center gap-2">
                            <CheckCircle2 className="w-3 h-3" /> All checks passed!
                          </p>
                        </div>
                        <Button
                          onClick={() => setInstallStep(7)}
                          className="w-full gradient-primary text-primary-foreground"
                        >
                          Continue to Launch <ArrowRight className="w-4 h-4 ml-1" />
                        </Button>
                      </>
                    )}
                  </div>
                )}

                {/* Step 7: Launch */}
                {installStep === 7 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Terminal className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium text-foreground">Launch {agentName}</span>
                    </div>

                    <div ref={launchLogRef} className="font-mono text-xs space-y-1 max-h-40 overflow-y-auto pr-1">
                      {launchOutput.map((line, i) => (
                        <p key={i} className={
                          line.startsWith("✓") ? "text-success" :
                          line.startsWith("✗") ? "text-destructive" :
                          "text-muted-foreground"
                        }>
                          {line}
                        </p>
                      ))}
                    </div>

                    {launching && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" /> Starting {agentName}...
                      </div>
                    )}

                    {launchOutput.length === 0 && !launching && (
                      <Button onClick={runLaunch} className="w-full gradient-primary text-primary-foreground">
                        Launch {agentName} <Zap className="w-4 h-4 ml-1" />
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* Nav buttons */}
              {installStep > 0 && (
                <div className="flex justify-between">
                  {!installing && !doctorRunning && installStep !== 3 && installStep !== 6 && installStep !== 7 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setInstallStep((installStep - 1) as InstallStep)}
                      className="text-muted-foreground"
                    >
                      Previous
                    </Button>
                  ) : (
                    <span />
                  )}
                  {installStep === 7 && launchOutput.some((l) => l.includes("All systems operational")) && (
                    <Button
                      size="sm"
                      onClick={() => navigate("/dashboard")}
                      className="gradient-primary text-primary-foreground"
                    >
                      Open Dashboard <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  )}
                </div>
              )}
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel agent installation?</AlertDialogTitle>
            <AlertDialogDescription>
              The installation is currently in progress. Cancelling will stop tracking
              the install and let you start over. Any files already downloaded by the
              installer may remain on your system.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep installing</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmCancel}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Yes, cancel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Index;
