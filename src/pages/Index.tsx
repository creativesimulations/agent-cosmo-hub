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
  GitBranch,
  FolderGit2,
  User,
} from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import PrerequisiteCheck from "./PrerequisiteCheck";
import { systemAPI } from "@/lib/systemAPI";

type Mode = "choose" | "connect" | "install";
type InstallStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

const installSteps = [
  { title: "System Prerequisites", desc: "Detect & install required dependencies" },
  { title: "Git Authentication", desc: "Configure Git access for repo cloning" },
  { title: "Clone Agent", desc: "Clone the agent repository" },
  { title: "Python Environment", desc: "Create virtual environment & install agent" },
  { title: "Name Your Agent", desc: "Give your AI agent a name you'll enjoy talking to" },
  { title: "Configure Provider", desc: "Set up your LLM provider" },
  { title: "Initial Config", desc: "Configure agent settings" },
  { title: "Launch Agent", desc: "Start your AI agent" },
];

const Index = () => {
  const [mode, setMode] = useState<Mode>("choose");
  const [connectUrl, setConnectUrl] = useState("http://localhost:8000");
  const [connecting, setConnecting] = useState(false);
  const [installStep, setInstallStep] = useState<InstallStep>(0);
  const [gitToken, setGitToken] = useState("");
  const [cloneProgress, setCloneProgress] = useState(0);
  const [cloning, setCloning] = useState(false);
  const [pipProgress, setPipProgress] = useState(0);
  const [installing, setInstalling] = useState(false);
  const [cloneOutput, setCloneOutput] = useState<string[]>([]);
  const [pipOutput, setPipOutput] = useState<string[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("openai");
  const [agentName, setAgentName] = useState("Ron");
  const navigate = useNavigate();

  const handleConnect = () => {
    setConnecting(true);
    setTimeout(() => {
      setConnecting(false);
      navigate("/dashboard");
    }, 2000);
  };

  const handleClone = async () => {
    setCloning(true);
    setCloneProgress(0);
    setCloneOutput(["$ git clone https://github.com/ainoval/agent.git"]);

    // Simulate progress while the real command runs
    const progressInterval = setInterval(() => {
      setCloneProgress((prev) => Math.min(prev + 3, 90));
    }, 200);

    const result = await systemAPI.cloneRepo(gitToken);

    clearInterval(progressInterval);
    setCloneProgress(100);
    setCloneOutput((prev) => [
      ...prev,
      result.success ? "✓ Repository cloned successfully" : `✗ ${result.stderr || 'Clone failed'}`,
    ]);
    setCloning(false);
    if (result.success) setInstallStep(3);
  };

  const handlePipInstall = async () => {
    setInstalling(true);
    setPipProgress(0);
    setPipOutput(["$ python3 -m venv .venv", "$ pip install -e ."]);

    const progressInterval = setInterval(() => {
      setPipProgress((prev) => Math.min(prev + 2, 90));
    }, 250);

    const result = await systemAPI.setupPythonEnv();

    clearInterval(progressInterval);
    setPipProgress(100);
    setPipOutput((prev) => [
      ...prev,
      result.success ? "✓ Agent installed successfully" : `✗ ${result.stderr || 'Install failed'}`,
    ]);
    setInstalling(false);
    if (result.success) setInstallStep(4);
  };

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
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="inline-flex items-center justify-center w-20 h-20 rounded-2xl gradient-primary glow-primary mx-auto"
              >
                <Zap className="w-10 h-10 text-primary-foreground" />
              </motion.div>
              <motion.h1
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-4xl font-bold text-foreground tracking-tight"
              >
                Ainoval
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
                <p className="text-sm text-muted-foreground">Enter the URL of your running agent gateway</p>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Gateway URL</label>
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
                    Auto-detection: We'll also scan localhost for running instances
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

                {/* Step 1: Git Authentication */}
                {installStep === 1 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                      <GitBranch className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium text-foreground">GitHub Access Token</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Enter a GitHub Personal Access Token (PAT) to clone the agent repository. 
                      You can generate one at github.com → Settings → Developer settings → Personal access tokens.
                    </p>
                    <Input
                      type="password"
                      value={gitToken}
                      onChange={(e) => setGitToken(e.target.value)}
                      placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                      className="bg-background/50 border-white/10 font-mono text-sm"
                    />
                    <div className="glass-subtle rounded-lg p-2 text-xs text-muted-foreground">
                      Required scopes: <code className="text-accent">repo</code> (read access)
                    </div>
                    <Button
                      onClick={() => setInstallStep(2)}
                      disabled={!gitToken}
                      className="w-full gradient-primary text-primary-foreground"
                    >
                      Save & Continue <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                )}

                {/* Step 2: Clone Repo */}
                {installStep === 2 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                      <FolderGit2 className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium text-foreground">Clone Repository</span>
                    </div>
                    <div className="font-mono text-sm space-y-1">
                      <p className="text-muted-foreground">$ git clone https://github.com/ainoval/agent.git</p>
                      {cloning && (
                        <>
                          <p className="text-foreground/70">Cloning into 'ainoval-agent'...</p>
                          <Progress value={cloneProgress} className="h-1 mt-2" />
                          <p className="text-xs text-muted-foreground">{cloneProgress}% complete</p>
                        </>
                      )}
                      {!cloning && cloneProgress >= 100 && (
                        <p className="text-success">✓ Repository cloned successfully</p>
                      )}
                    </div>
                    {!cloning && cloneProgress === 0 && (
                      <Button onClick={handleClone} className="w-full gradient-primary text-primary-foreground">
                        Clone Repository <ArrowRight className="w-4 h-4 ml-1" />
                      </Button>
                    )}
                  </div>
                )}

                {/* Step 3: Python Environment */}
                {installStep === 3 && (
                  <div className="space-y-3">
                    <div className="font-mono text-sm space-y-1">
                      <p className="text-muted-foreground">$ python3 -m venv agent-env</p>
                      <p className="text-success">✓ Virtual environment created</p>
                      <p className="text-muted-foreground">$ pip install -e ./ainoval-agent</p>
                      {installing && (
                        <>
                          <p className="text-foreground/70">Installing agent and dependencies...</p>
                          <Progress value={pipProgress} className="h-1 mt-2" />
                          <p className="text-xs text-muted-foreground">{pipProgress}% complete</p>
                        </>
                      )}
                      {!installing && pipProgress >= 100 && (
                        <p className="text-success">✓ Agent installed successfully</p>
                      )}
                    </div>
                    {!installing && pipProgress === 0 && (
                      <Button onClick={handlePipInstall} className="w-full gradient-primary text-primary-foreground">
                        Install Agent <ArrowRight className="w-4 h-4 ml-1" />
                      </Button>
                    )}
                  </div>
                )}

                {/* Step 4: Name Your Agent */}
                {installStep === 4 && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                      <User className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium text-foreground">Name Your Agent</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Give your AI agent a personal name. This is who you'll be chatting with — pick something you're comfortable talking to!
                    </p>
                    <Input
                      value={agentName}
                      onChange={(e) => setAgentName(e.target.value)}
                      placeholder="Ron"
                      className="bg-background/50 border-white/10 text-lg font-semibold text-center"
                    />
                    <div className="glass-subtle rounded-lg p-3 text-center">
                      <p className="text-sm text-muted-foreground">
                        Your agent will greet you as: <span className="text-primary font-semibold">{agentName || "Ron"}</span>
                      </p>
                    </div>
                    <Button
                      onClick={() => setInstallStep(5)}
                      className="w-full gradient-primary text-primary-foreground"
                    >
                      Continue <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                )}

                {/* Step 5: Configure Provider */}
                {installStep === 5 && (
                  <div className="space-y-3">
                    <label className="text-sm font-medium text-foreground">Default LLM Provider</label>
                    <div className="grid grid-cols-2 gap-2">
                      {["OpenAI", "Anthropic", "Ollama (Local)", "vLLM"].map((p) => (
                        <button
                          key={p}
                          className="px-3 py-2 rounded-lg border border-white/10 text-sm text-foreground hover:border-primary/30 hover:bg-primary/5 transition-all text-left"
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Step 6: Agent Config */}
                {installStep === 6 && (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">Agent Name</label>
                      <Input value={agentName} onChange={(e) => setAgentName(e.target.value)} className="bg-background/50 border-white/10" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">Gateway Port</label>
                      <Input defaultValue="8000" className="bg-background/50 border-white/10" />
                    </div>
                  </div>
                )}

                {/* Step 7: Launch */}
                {installStep === 7 && (
                  <div className="space-y-2 font-mono text-sm">
                    <p className="text-muted-foreground">$ ainoval start --name "{agentName}"</p>
                    <p className="text-foreground/70">Starting {agentName}...</p>
                    <p className="text-success">✓ {agentName} is running on http://localhost:8000</p>
                    <p className="text-success">✓ Gateway API active</p>
                    <p className="text-success">✓ All systems operational</p>
                  </div>
                )}
              </div>

              {/* Nav buttons (skip for step 0 which has its own continue) */}
              {installStep > 0 && (
                <div className="flex justify-between">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={installStep === 0}
                    onClick={() => setInstallStep((s) => (s - 1) as InstallStep)}
                    className="text-muted-foreground"
                  >
                    Previous
                  </Button>
                  {installStep >= 5 && (
                    <Button
                      size="sm"
                      onClick={() => {
                        if (installStep === 7) {
                          navigate("/dashboard");
                        } else {
                          setInstallStep((s) => (s + 1) as InstallStep);
                        }
                      }}
                      className="gradient-primary text-primary-foreground"
                    >
                      {installStep === 7 ? "Open Dashboard" : "Next"}
                      <ArrowRight className="w-4 h-4 ml-1" />
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
