import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Download,
  Monitor,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type CheckStatus = "pending" | "checking" | "found" | "missing" | "installing" | "installed" | "error";

interface Prerequisite {
  id: string;
  name: string;
  description: string;
  status: CheckStatus;
  version?: string;
  installProgress?: number;
  required: boolean;
  windowsOnly?: boolean;
}

const initialPrereqs: Prerequisite[] = [
  { id: "os", name: "Operating System", description: "Detecting platform...", status: "pending", required: true },
  { id: "wsl2", name: "WSL2 (Windows)", description: "Windows Subsystem for Linux 2", status: "pending", required: true, windowsOnly: true },
  { id: "python", name: "Python 3.11+", description: "Required runtime for Hermes", status: "pending", required: true },
  { id: "pip", name: "pip / pipx", description: "Python package manager", status: "pending", required: true },
  { id: "git", name: "Git", description: "Version control for cloning Hermes repo", status: "pending", required: true },
  { id: "ollama", name: "Ollama", description: "Local model runtime (optional)", status: "pending", required: false },
];

const PrerequisiteCheck = ({ onComplete }: { onComplete: () => void }) => {
  const [prereqs, setPrereqs] = useState(initialPrereqs);
  const [detectedOS, setDetectedOS] = useState<string>("Detecting...");
  const [scanning, setScanning] = useState(false);
  const [scanComplete, setScanComplete] = useState(false);

  const updatePrereq = (id: string, updates: Partial<Prerequisite>) => {
    setPrereqs((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  };

  const simulateScan = async () => {
    setScanning(true);

    // Detect OS
    await delay(600);
    const os = "Windows 11 (x64)";
    setDetectedOS(os);
    updatePrereq("os", { status: "found", version: os, description: "Platform detected" });

    // Check WSL2
    await delay(800);
    updatePrereq("wsl2", { status: "checking", description: "Checking WSL2 installation..." });
    await delay(1200);
    updatePrereq("wsl2", { status: "found", version: "WSL 2.0.14", description: "WSL2 with Ubuntu 22.04" });

    // Check Python
    await delay(500);
    updatePrereq("python", { status: "checking", description: "Searching for Python..." });
    await delay(1000);
    updatePrereq("python", { status: "found", version: "3.11.5", description: "Python 3.11.5 found in PATH" });

    // Check pip
    await delay(400);
    updatePrereq("pip", { status: "checking", description: "Checking pip..." });
    await delay(800);
    updatePrereq("pip", { status: "found", version: "23.3.1", description: "pip 23.3.1 available" });

    // Check Git
    await delay(400);
    updatePrereq("git", { status: "checking", description: "Checking Git..." });
    await delay(900);
    updatePrereq("git", { status: "found", version: "2.43.0", description: "Git 2.43.0 installed" });

    // Check Ollama
    await delay(400);
    updatePrereq("ollama", { status: "checking", description: "Checking for Ollama..." });
    await delay(1000);
    updatePrereq("ollama", { status: "missing", description: "Not installed (optional)" });

    setScanning(false);
    setScanComplete(true);
  };

  const installPrereq = async (id: string) => {
    updatePrereq(id, { status: "installing", installProgress: 0 });
    for (let i = 0; i <= 100; i += 5) {
      await delay(150);
      updatePrereq(id, { installProgress: i });
    }
    updatePrereq(id, { status: "installed", installProgress: 100, description: "Successfully installed" });
  };

  const allRequiredMet = prereqs
    .filter((p) => p.required)
    .every((p) => p.status === "found" || p.status === "installed");

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Monitor className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-semibold text-foreground">System Prerequisites</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          We'll scan your system and install everything Hermes needs to run.
        </p>
      </div>

      {!scanning && !scanComplete && (
        <Button onClick={simulateScan} className="gradient-primary text-primary-foreground w-full">
          <Monitor className="w-4 h-4 mr-2" /> Scan System
        </Button>
      )}

      <div className="space-y-2">
        {prereqs.map((prereq, i) => (
          <motion.div
            key={prereq.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <div className="glass-subtle rounded-lg p-3 flex items-center justify-between">
              <div className="flex items-center gap-3 flex-1">
                <StatusIcon status={prereq.status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{prereq.name}</p>
                    {!prereq.required && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">
                        Optional
                      </span>
                    )}
                    {prereq.version && (
                      <span className="text-xs font-mono text-accent">{prereq.version}</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{prereq.description}</p>
                  {prereq.status === "installing" && prereq.installProgress !== undefined && (
                    <Progress value={prereq.installProgress} className="h-1 mt-2" />
                  )}
                </div>
              </div>
              {prereq.status === "missing" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-primary hover:text-primary shrink-0"
                  onClick={() => installPrereq(prereq.id)}
                >
                  <Download className="w-3 h-3 mr-1" /> Install
                </Button>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {scanComplete && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          {allRequiredMet ? (
            <div className="glass-subtle rounded-lg p-3 flex items-center gap-2 border border-success/20">
              <CheckCircle2 className="w-4 h-4 text-success" />
              <p className="text-sm text-success">All required prerequisites are met!</p>
            </div>
          ) : (
            <div className="glass-subtle rounded-lg p-3 flex items-center gap-2 border border-warning/20">
              <AlertTriangle className="w-4 h-4 text-warning" />
              <p className="text-sm text-warning">Some required prerequisites are missing. Install them to continue.</p>
            </div>
          )}
          <Button
            onClick={onComplete}
            disabled={!allRequiredMet}
            className="gradient-primary text-primary-foreground w-full mt-4"
          >
            Continue <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </motion.div>
      )}
    </div>
  );
};

const StatusIcon = ({ status }: { status: CheckStatus }) => {
  switch (status) {
    case "found":
    case "installed":
      return <CheckCircle2 className="w-4 h-4 text-success shrink-0" />;
    case "missing":
      return <XCircle className="w-4 h-4 text-warning shrink-0" />;
    case "error":
      return <XCircle className="w-4 h-4 text-destructive shrink-0" />;
    case "checking":
    case "installing":
      return <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />;
    default:
      return <div className="w-4 h-4 rounded-full bg-white/10 shrink-0" />;
  }
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default PrerequisiteCheck;
