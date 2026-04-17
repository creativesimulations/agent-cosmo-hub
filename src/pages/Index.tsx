import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
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
} from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import PrerequisiteCheck from "./PrerequisiteCheck";
import { systemAPI } from "@/lib/systemAPI";
import ronbotLogo from "@/assets/ronbot-logo.png";

type Mode = "choose" | "connect" | "install";
type InstallStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

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

interface OptionalFeature {
  id: string;
  label: string;
  description: string;
  pipExtra: string;
}

const OPTIONAL_FEATURES: OptionalFeature[] = [
  { id: "voice", label: "Voice / TTS", description: "Enable text-to-speech voice messages (requires ffmpeg)", pipExtra: "voice" },
  { id: "messaging", label: "Messaging Gateways", description: "Telegram, Discord, and other messaging integrations", pipExtra: "messaging" },
  { id: "cron", label: "Scheduled Tasks", description: "Cron-based task scheduling and automation", pipExtra: "cron" },
  { id: "web", label: "Web Interface", description: "Built-in web UI for the agent", pipExtra: "web" },
];

// Provider definitions with their env var names and key prefixes
const LLM_PROVIDERS = [
  { id: "openrouter", label: "OpenRouter", envVar: "OPENROUTER_API_KEY", prefix: "sk-or-", hint: "200+ models via a single API. Get a key at openrouter.ai", defaultModel: "openrouter/nous/hermes-3-llama-3.1-70b" },
  { id: "openai", label: "OpenAI", envVar: "OPENAI_API_KEY", prefix: "sk-", hint: "GPT-4o and more. Get a key at platform.openai.com", defaultModel: "openai/gpt-4o" },
  { id: "anthropic", label: "Anthropic", envVar: "ANTHROPIC_API_KEY", prefix: "sk-ant-", hint: "Claude models. Get a key at console.anthropic.com", defaultModel: "anthropic/claude-3.5-sonnet" },
  { id: "nous", label: "Nous Portal", envVar: "NOUS_API_KEY", prefix: "", hint: "Nous Research portal. Get a key at portal.nousresearch.com", defaultModel: "nous/hermes-3-llama-3.1-70b" },
  { id: "ollama", label: "Ollama (Local)", envVar: "", prefix: "", hint: "Run models locally — no API key needed. Install Ollama first.", defaultModel: "ollama/llama3.1" },
];

const MODEL_OPTIONS: Record<string, { id: string; label: string }[]> = {
  openrouter: [
    { id: "openrouter/nous/hermes-3-llama-3.1-70b", label: "Hermes 3 Llama 3.1 70B" },
    { id: "openrouter/anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
    { id: "openrouter/openai/gpt-4o", label: "GPT-4o" },
    { id: "openrouter/meta-llama/llama-3.1-70b-instruct", label: "Llama 3.1 70B" },
  ],
  openai: [
    { id: "openai/gpt-4o", label: "GPT-4o" },
    { id: "openai/gpt-4o-mini", label: "GPT-4o Mini" },
    { id: "openai/o1", label: "o1" },
  ],
  anthropic: [
    { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
    { id: "anthropic/claude-3-haiku", label: "Claude 3 Haiku" },
  ],
  nous: [
    { id: "nous/hermes-3-llama-3.1-70b", label: "Hermes 3 Llama 3.1 70B" },
  ],
  ollama: [
    { id: "ollama/llama3.1", label: "Llama 3.1" },
    { id: "ollama/mistral", label: "Mistral 7B" },
    { id: "ollama/hermes-3", label: "Hermes 3 (if pulled)" },
  ],
};

const Index = () => {
  const [mode, setMode] = useState<Mode>("choose");
  const [connectUrl, setConnectUrl] = useState("http://localhost:8000");
  const [connecting, setConnecting] = useState(false);
  const [installStep, setInstallStep] = useState<InstallStep>(0);

  // Optional features
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>(["voice", "messaging"]);

  // Install state
  const [installProgress, setInstallProgress] = useState(0);
  const [installing, setInstalling] = useState(false);
  const [installOutput, setInstallOutput] = useState<string[]>([]);
  const [installComplete, setInstallComplete] = useState(false);

  // Agent name
  const [agentName, setAgentName] = useState("Ron");

  // API keys
  const [selectedProvider, setSelectedProvider] = useState("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [keySaved, setKeySaved] = useState(false);

  // Model
  const [selectedModel, setSelectedModel] = useState("openrouter/nous/hermes-3-llama-3.1-70b");

  // Doctor / launch
  const [doctorRunning, setDoctorRunning] = useState(false);
  const [doctorOutput, setDoctorOutput] = useState<string[]>([]);
  const [doctorPassed, setDoctorPassed] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchOutput, setLaunchOutput] = useState<string[]>([]);

  const navigate = useNavigate();

  const handleConnect = () => {
    setConnecting(true);
    setTimeout(() => {
      setConnecting(false);
      navigate("/dashboard");
    }, 2000);
  };

  // ─── Step 1: Toggle optional feature ─────────────────────
  const toggleFeature = (featureId: string) => {
    setSelectedFeatures((prev) =>
      prev.includes(featureId) ? prev.filter((f) => f !== featureId) : [...prev, featureId]
    );
  };

  // ─── Step 2: Install Agent ───────────────────────────────
  const handleInstallAgent = async () => {
    setInstalling(true);
    setInstallProgress(0);
    const extrasLabel = selectedFeatures.length > 0 ? ` with extras: ${selectedFeatures.join(", ")}` : "";
    setInstallOutput([`Starting agent installation${extrasLabel}...`]);

    const progressInterval = setInterval(() => {
      setInstallProgress((prev) => Math.min(prev + 2, 90));
      setInstallOutput((prev) => {
        const messages = [
          "Verifying Python and pip...",
          "Downloading installer script...",
          "Installing agent framework and dependencies...",
          ...(selectedFeatures.includes("voice") ? ["Installing ffmpeg for voice support..."] : []),
          "Setting up PATH...",
        ];
        const idx = Math.min(Math.floor(prev.length / 2), messages.length - 1);
        if (!prev.includes(messages[idx])) return [...prev, messages[idx]];
        return prev;
      });
    }, 800);

    // Build pip extras string from selected features
    const extras = selectedFeatures.map((f) => OPTIONAL_FEATURES.find((o) => o.id === f)?.pipExtra).filter(Boolean);
    const result = await systemAPI.installHermes(extras.length > 0 ? extras as string[] : undefined);

    clearInterval(progressInterval);
    setInstallProgress(100);

    if (result.success) {
      setInstallOutput((prev) => [...prev, "✓ Agent installed successfully!"]);
      setInstallComplete(true);
      setTimeout(() => setInstallStep(3), 1000);
    } else {
      setInstallOutput((prev) => [...prev, `✗ Installation failed: ${result.stderr || "Unknown error"}`]);
    }
    setInstalling(false);
  };

  // ─── Step 3: Save API Key ────────────────────────────────
  const handleSaveApiKey = async () => {
    const provider = LLM_PROVIDERS.find((p) => p.id === selectedProvider);
    if (!provider || !provider.envVar) {
      // Ollama — no key needed
      setKeySaved(true);
      return;
    }
    await systemAPI.setEnvVar(provider.envVar, apiKey);
    setKeySaved(true);
  };

  // ─── Step 5: Save Model ──────────────────────────────────
  const handleSaveModel = async () => {
    await systemAPI.writeInitialConfig({ model: selectedModel });
    setInstallStep(6);
  };

  // ─── Step 5: Run Doctor ──────────────────────────────────
  const handleDoctor = async () => {
    setDoctorRunning(true);
    setDoctorOutput(["Running diagnostics..."]);

    const result = await systemAPI.hermesDoctor();

    const lines = result.stdout.split("\n").filter(Boolean);
    setDoctorOutput((prev) => [...prev, ...lines]);
    setDoctorPassed(result.success);
    setDoctorRunning(false);
  };

  // ─── Step 6: Launch ──────────────────────────────────────
  const handleLaunch = async () => {
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
  };

  const currentProvider = LLM_PROVIDERS.find((p) => p.id === selectedProvider);
  const needsApiKey = currentProvider?.envVar !== "";

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

            <div className="grid grid-cols-2 gap-4">
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
                    Connect to a running agent instance
                  </p>
                </div>
              </GlassCard>

              <GlassCard
                className="cursor-pointer hover:border-accent/30 transition-all group"
                onClick={() => setMode("install")}
              >
                <div className="space-y-3">
                  <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center group-hover:bg-accent/20 transition-colors">
                    <Download className="w-6 h-6 text-accent" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">Install & Setup</h3>
                  <p className="text-sm text-muted-foreground">
                    Full automated agent installation — no terminal needed
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
                  Connect to Agent
                </h2>
                <p className="text-sm text-muted-foreground">Enter the URL of your running agent</p>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Agent URL</label>
                  <Input
                    value={connectUrl}
                    onChange={(e) => setConnectUrl(e.target.value)}
                    placeholder="http://localhost:8000"
                    className="bg-background/50 border-white/10 focus:border-primary/50"
                  />
                </div>
                <div className="glass-subtle rounded-lg p-3 flex items-start gap-2">
                  <Globe className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    We'll scan for running agent instances on localhost automatically.
                  </p>
                </div>
                <Button onClick={handleConnect} disabled={connecting} className="w-full gradient-primary text-primary-foreground hover:opacity-90">
                  {connecting ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Connecting...</>
                  ) : (
                    <><ArrowRight className="w-4 h-4 mr-2" /> Connect</>
                  )}
                </Button>
              </div>
            </GlassCard>
          </motion.div>
        )}

        {mode === "install" && (
          <motion.div
            key="install"
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            className="max-w-lg w-full space-y-6"
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setMode("choose"); setInstallStep(0); }}
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>

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
                      This will download and install the AI agent framework
                      {selectedFeatures.length > 0 && ` with ${selectedFeatures.map(f => OPTIONAL_FEATURES.find(o => o.id === f)?.label).filter(Boolean).join(", ")}`}.
                    </p>

                    <div className="font-mono text-xs space-y-1 max-h-40 overflow-y-auto">
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
                        <Progress value={installProgress} className="h-1" />
                        <p className="text-xs text-muted-foreground text-right">{installProgress}%</p>
                      </div>
                    )}

                    {!installing && !installComplete && (
                      <Button onClick={handleInstallAgent} className="w-full gradient-primary text-primary-foreground">
                        Install Agent <ArrowRight className="w-4 h-4 ml-1" />
                      </Button>
                    )}
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

                    <div className="font-mono text-xs space-y-1 max-h-40 overflow-y-auto">
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
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" /> Running diagnostics...
                      </div>
                    )}

                    {!doctorRunning && !doctorPassed && (
                      <Button onClick={handleDoctor} className="w-full gradient-primary text-primary-foreground">
                        Run Diagnostics <Stethoscope className="w-4 h-4 ml-1" />
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

                    <div className="font-mono text-xs space-y-1">
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
                      <Button onClick={handleLaunch} className="w-full gradient-primary text-primary-foreground">
                        Launch {agentName} <Zap className="w-4 h-4 ml-1" />
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* Nav buttons */}
              {installStep > 0 && (
                <div className="flex justify-between">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setInstallStep((s) => (s - 1) as InstallStep)}
                    className="text-muted-foreground"
                  >
                    Previous
                  </Button>
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
    </div>
  );
};

export default Index;
