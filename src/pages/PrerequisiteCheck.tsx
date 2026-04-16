import { useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { systemAPI } from "@/lib/systemAPI";

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
  { id: "python", name: "Python 3.11+", description: "Required runtime", status: "pending", required: true },
  { id: "pip", name: "pip", description: "Python package manager", status: "pending", required: true },
  { id: "curl", name: "curl", description: "Required to download the installer", status: "pending", required: true },
  { id: "git", name: "Git", description: "Version control", status: "pending", required: true },
];

const PrerequisiteCheck = ({ onComplete }: { onComplete: () => void }) => {
  const [prereqs, setPrereqs] = useState(initialPrereqs);
  const [scanning, setScanning] = useState(false);
  const [scanComplete, setScanComplete] = useState(false);

  const updatePrereq = (id: string, updates: Partial<Prerequisite>) => {
    setPrereqs((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  };

  const runScan = async () => {
    setScanning(true);

    updatePrereq("os", { status: "checking", description: "Detecting platform..." });
    try {
      const osInfo = await systemAPI.detectOS();
      updatePrereq("os", { status: "found", version: osInfo.name, description: "Platform detected" });
    } catch {
      updatePrereq("os", { status: "error", description: "Failed to detect OS" });
    }

    const platform = await systemAPI.getPlatform();
    if (platform.isWindows) {
      updatePrereq("wsl2", { status: "checking", description: "Checking WSL2 installation..." });
      const wsl = await systemAPI.checkWSL();
      if (wsl.installed) {
        updatePrereq("wsl2", {
          status: "found",
          version: wsl.version,
          description: wsl.distro ? `${wsl.version} with ${wsl.distro}` : wsl.version,
        });
      } else {
        updatePrereq("wsl2", { status: "missing", description: "WSL2 required — native Windows is not supported" });
      }
    } else {
      updatePrereq("wsl2", { status: "found", description: "Not required on this platform", version: "N/A" });
    }

    updatePrereq("python", { status: "checking", description: "Searching for Python 3.11+..." });
    const python = await systemAPI.checkPython();
    if (python.installed) {
      updatePrereq("python", { status: "found", version: python.version, description: `Python ${python.version} found` });
    } else {
      updatePrereq("python", { status: "missing", description: "Python 3.11+ not found" });
    }

    updatePrereq("pip", { status: "checking", description: "Checking pip..." });
    const pip = await systemAPI.checkPip();
    if (pip.installed) {
      updatePrereq("pip", { status: "found", version: pip.version, description: `pip ${pip.version} available` });
    } else {
      updatePrereq("pip", { status: "missing", description: "pip not found" });
    }

    updatePrereq("curl", { status: "checking", description: "Checking curl..." });
    const curl = await systemAPI.checkCurl();
    if (curl.installed) {
      updatePrereq("curl", { status: "found", version: curl.version, description: `curl ${curl.version} available` });
    } else {
      updatePrereq("curl", { status: "missing", description: "curl not found" });
    }

    updatePrereq("git", { status: "checking", description: "Checking Git..." });
    const git = await systemAPI.checkGit();
    if (git.installed) {
      updatePrereq("git", { status: "found", version: git.version, description: `Git ${git.version} installed` });
    } else {
      updatePrereq("git", { status: "missing", description: "Git not found" });
    }

    setScanning(false);
    setScanComplete(true);
  };

  const installPrereq = async (id: string) => {
    updatePrereq(id, { status: "installing", installProgress: 10 });

    const interval = setInterval(() => {
      updatePrereq(id, { installProgress: Math.min(90, (Math.random() * 20) + 50) });
    }, 500);

    let result;
    switch (id) {
      case "wsl2":
        result = await systemAPI.installWSL();
        break;
      case "python":
        result = await systemAPI.installPython();
        break;
      case "pip":
        result = await systemAPI.installPython();
        break;
      case "git":
        result = await systemAPI.installGit();
        break;
      case "curl":
        result = await systemAPI.installCurl();
        break;
      default:
        clearInterval(interval);
        return;
    }

    clearInterval(interval);

    if (result?.success) {
      updatePrereq(id, { status: "installed", installProgress: 100, description: "Successfully installed" });
    } else {
      updatePrereq(id, {
        status: "error",
        installProgress: 0,
        description: `Installation failed: ${result?.stderr || 'Unknown error'}`,
      });
    }
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
          We'll scan your system and install everything needed to run the agent.
        </p>
      </div>

      {!scanning && !scanComplete && (
        <Button onClick={runScan} className="gradient-primary text-primary-foreground w-full">
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
              <p className="text-sm text-success">All prerequisites are met!</p>
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

export default PrerequisiteCheck;
