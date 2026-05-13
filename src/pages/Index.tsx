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
  XCircle,
  FolderOpen,
  HardDrive,
  Package,
  ExternalLink,
} from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import ActionableError from "@/components/ui/ActionableError";
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
import { IndexGuardPanel } from "@/components/install/IndexGuardPanel";
import { StreamingLogPanel } from "@/components/install/StreamingLogPanel";
import InstallPreflight from "@/components/install/InstallPreflight";
import { systemAPI } from "@/lib/systemAPI";
import { useInstall, InstallStep } from "@/contexts/InstallContext";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import ronbotLogo from "@/assets/ronbot-logo.png";
import { LLM_PROVIDERS, MODEL_OPTIONS } from "@/lib/llmCatalog";
import { INSTALL_WIZARD_STEPS } from "@/pages/install/constants";

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
    replaceWithRonbotPersonalityTemplates,
    setReplaceWithRonbotPersonalityTemplates,
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
  /** True while probing ~/.hermes before opening bundled install or guard (IPC + shell). */
  const [bundledInstallBusy, setBundledInstallBusy] = useState(false);

  // Guard-screen state (shown when ~/.hermes already exists)
  const [existingAgentName, setExistingAgentName] = useState<string | null>(null);
  const [pendingSource, setPendingSource] = useState<"bundled" | "local">("bundled");
  const [pendingLocalPath, setPendingLocalPath] = useState<string>("");
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetOutput, setResetOutput] = useState<string[]>([]);
  const [wizardError, setWizardError] = useState<string>("");

  const navigate = useNavigate();
  const { refresh: refreshConnection, markConnected } = useAgentConnection();

  const handleConnect = async () => {
    setConnecting(true);
    const ok = await refreshConnection();
    setConnecting(false);
    if (ok) {
      markConnected("~/.hermes");
      navigate("/dashboard");
    } else {
      toast.error("No agent detected", {
        description:
          "Ronbot needs a Hermes CLI on PATH and a ~/.hermes directory. If Hermes works in your terminal but not here, ensure the same PATH (e.g. Homebrew) is available to GUI apps.",
      });
    }
  };

  /** Wizard prereq screen: Hermes CLI detected — same verification as Home → Connect. */
  const handleWizardConnectExisting = async () => {
    const ok = await refreshConnection();
    if (ok) {
      markConnected("~/.hermes");
      navigate("/dashboard");
      toast.success("Connected to your agent");
    } else {
      toast.error("Could not verify ~/.hermes", {
        description:
          "Ronbot needs the Hermes CLI plus a ~/.hermes directory. If you use a custom layout, run the official installer once or use Detect & Connect from the home screen after fixing PATH.",
      });
    }
  };

  /** Probe ~/.hermes; if a real install is there, route the user to the
   *  guard screen so a single-agent app never silently overwrites their
   *  existing agent's persona, secrets, and chat history. */
  const beginInstallFlow = async (source: "bundled" | "local", localPath = "") => {
    setPendingSource(source);
    setPendingLocalPath(localPath);
    // User already chose a source directory — do not send them to the
    // "~/.hermes exists" guard (that applies to bundled overwrite risk).
    if (source === "local" && localPath) {
      setInstallSource("local");
      setLocalAgentPath(localPath);
      setMode("install");
      setInstallStep(0);
      return;
    }
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
    const pickToastId = "ronbot-select-agent-folder";
    toast.loading("Opening system folder picker…", {
      id: pickToastId,
      description:
        "On Linux or WSL, the dialog can open behind Ronbot—check other windows or the taskbar.",
    });
    try {
      const res = await systemAPI.selectFolder({ title: "Select your agent folder" });
      if (!res.success) {
        toast.error("Could not open folder picker", {
          id: pickToastId,
          description: res.error ?? "Unknown error",
        });
        return;
      }
      if (res.canceled || !res.path) {
        toast.info("No folder selected", {
          id: pickToastId,
          description:
            'The picker was canceled or closed with no folder. Click "Use My Own Agent" again when you are ready.',
        });
        return;
      }
      toast.success("Local agent folder selected", {
        id: pickToastId,
        description: res.path,
        duration: 8000,
      });
      await beginInstallFlow("local", res.path);
    } catch (e) {
      toast.error("Could not open folder picker", {
        id: pickToastId,
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const handleStartBundledInstall = () => {
    setBundledInstallBusy(true);
    void (async () => {
      try {
        await beginInstallFlow("bundled");
      } finally {
        setBundledInstallBusy(false);
      }
    })();
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
        setWizardError("Could not rename agent");
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
    if (!saved) {
      setWizardError(`Could not save ${provider.envVar}. Check key format and try again.`);
    } else {
      setWizardError("");
    }
  };

  const handleSaveModel = async () => {
    const r = await systemAPI.writeInitialConfig({ model: selectedModel, name: agentName });
    if (!r.success) {
      setWizardError(r.error || "Could not save model config");
      return;
    }
    setWizardError("");
    await refreshConnection();
    setInstallStep(5);
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
                className={cn(
                  "cursor-pointer hover:border-accent/30 transition-all group",
                  bundledInstallBusy && "pointer-events-none cursor-wait opacity-80",
                )}
                onClick={handleStartBundledInstall}
              >
                <div className="space-y-3">
                  <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center group-hover:bg-accent/20 transition-colors">
                    {bundledInstallBusy ? (
                      <Loader2 className="w-6 h-6 text-accent animate-spin" aria-hidden />
                    ) : (
                      <Package className="w-6 h-6 text-accent" />
                    )}
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">Install Ronbot Agent</h3>
                  <p className="text-sm text-muted-foreground">
                    {bundledInstallBusy
                      ? "Checking for an existing install…"
                      : "Download and install the bundled Ronbot agent"}
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
          <IndexGuardPanel
            existingAgentName={existingAgentName}
            renameValue={renameValue}
            onRenameValueChange={setRenameValue}
            renaming={renaming}
            resetting={resetting}
            resetOutput={resetOutput}
            onBack={() => setMode("choose")}
            onConnect={handleGuardConnect}
            onRename={handleGuardRename}
            onRequestReset={() => setShowResetConfirm(true)}
          />
        )}

        {mode === "install" && (
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
              {INSTALL_WIZARD_STEPS.map((_, i) => (
                <div key={i} className="flex-1">
                  <div className={cn("h-1 rounded-full transition-all", i <= installStep ? "gradient-primary" : "bg-white/10")} />
                </div>
              ))}
            </div>

            <GlassCard className="space-y-5">
              {wizardError && (
                <ActionableError
                  title="Setup step failed"
                  summary={wizardError}
                  details={wizardError}
                  onFix={() => setWizardError("")}
                  fixLabel="Dismiss"
                />
              )}

              <div className="space-y-1">
                <p className="text-xs text-primary font-mono">Step {installStep + 1} of {INSTALL_WIZARD_STEPS.length}</p>
                <h2 className="text-xl font-semibold text-foreground">{INSTALL_WIZARD_STEPS[installStep].title}</h2>
                <p className="text-sm text-muted-foreground">{INSTALL_WIZARD_STEPS[installStep].desc}</p>
              </div>

              <div className="glass-subtle rounded-lg p-4 space-y-3">
                {/* Step 0: Prerequisites */}
                {installStep === 0 && (
                  <PrerequisiteCheck
                    onComplete={() => setInstallStep(1)}
                    onConnectExisting={handleWizardConnectExisting}
                  />
                )}

                {/* Step 1: Install Agent */}
                {installStep === 1 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Download className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium text-foreground">Install Agent</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {installSource === "local"
                        ? "This will pip-install your local agent folder with extras (voice, messaging, cron, web)."
                        : "This will run the official Hermes installer from GitHub (curl … | bash), matching Hermes v0.13+."}
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

                    {installSource === "local" && !installing && !installComplete && (
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/10 bg-background/30 p-3 text-left">
                        <Checkbox
                          checked={replaceWithRonbotPersonalityTemplates}
                          onCheckedChange={(v) => setReplaceWithRonbotPersonalityTemplates(v === true)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm font-medium text-foreground">Use Ronbot personality templates</p>
                          <p className="text-xs text-muted-foreground">
                            If checked, any existing <code className="text-foreground/90">SOUL.md</code>,{" "}
                            <code className="text-foreground/90">PERSONALITY.md</code>,{" "}
                            <code className="text-foreground/90">memories/MEMORY.md</code>, and{" "}
                            <code className="text-foreground/90">memories/USER.md</code> are moved into{" "}
                            <code className="text-foreground/90">~/.hermes/.ronbot-personality-backup/&lt;timestamp&gt;/</code>{" "}
                            before Ronbot's curated files are written. Leave unchecked to keep your agent's
                            current persona files.
                          </p>
                        </div>
                      </label>
                    )}

                    {!installing && !installComplete && (
                      <InstallPreflight onReadyChange={setPreflightReady} />
                    )}

                    <StreamingLogPanel lines={installOutput} variant="install" scrollRef={installLogRef} />

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

                {/* Step 2: Name Your Agent */}
                {installStep === 2 && (
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
                      onClick={async () => {
                        const name = agentName.trim() || "Ron";
                        const r = await systemAPI.setAgentName(name);
                        if (!r.success) {
                          toast.error("Could not save agent name", { description: "Check ~/.hermes permissions and try again." });
                          return;
                        }
                        setInstallStep(3);
                      }}
                      className="w-full gradient-primary text-primary-foreground"
                    >
                      Continue <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                )}

                {/* Step 3: API Keys */}
                {installStep === 3 && (
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
                        {currentProvider.docsUrl && (
                          <a
                            href={currentProvider.docsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-2 inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            Provider docs <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
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
                          onClick={() => setInstallStep(4)}
                          className="flex-1 gradient-primary text-primary-foreground"
                        >
                          Continue <ArrowRight className="w-4 h-4 ml-1" />
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* Step 4: Choose Model */}
                {installStep === 4 && (
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

                {/* Step 5: Verify */}
                {installStep === 5 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Stethoscope className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium text-foreground">Verify Installation</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Run diagnostics to verify everything is configured correctly.
                    </p>

                    <StreamingLogPanel lines={doctorOutput} variant="doctor" scrollRef={doctorLogRef} />

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
                          onClick={() => setInstallStep(6)}
                          className="w-full gradient-primary text-primary-foreground"
                        >
                          Continue to Launch <ArrowRight className="w-4 h-4 ml-1" />
                        </Button>
                      </>
                    )}
                  </div>
                )}

                {/* Step 6: Launch */}
                {installStep === 6 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Terminal className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium text-foreground">Launch {agentName}</span>
                    </div>

                    <StreamingLogPanel lines={launchOutput} variant="launch" scrollRef={launchLogRef} />

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
                  {!installing && !doctorRunning && installStep !== 2 && installStep !== 5 && installStep !== 6 ? (
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
                  {installStep === 6 && launchOutput.some((l) => l.includes("All systems operational")) && (
                    <Button
                      size="sm"
                      onClick={() => navigate("/")}
                      className="gradient-primary text-primary-foreground"
                    >
                      Start chatting with Ron <ArrowRight className="w-4 h-4 ml-1" />
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

      <AlertDialog open={showResetConfirm} onOpenChange={(open) => !resetting && setShowResetConfirm(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset {existingAgentName} and install fresh?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <code>~/.hermes</code> — including the agent persona, configuration, secrets, skills, sub-agent state, and chat history. This cannot be undone. After the reset, the install wizard will run from scratch.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleGuardReset}
              disabled={resetting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {resetting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Resetting...</> : "Yes, delete and reinstall"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Index;
