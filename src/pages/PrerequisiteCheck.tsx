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
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { systemAPI } from "@/lib/systemAPI";

type CheckStatus = "pending" | "checking" | "found" | "missing" | "installing" | "installed" | "error" | "reboot_required";
type Tier = "required" | "recommended" | "auto";

interface Prerequisite {
  id: string;
  name: string;
  description: string;
  status: CheckStatus;
  version?: string;
  installProgress?: number;
  tier: Tier;
  windowsOnly?: boolean;
}

/**
 * Per the official Hermes docs (https://hermes-agent.nousresearch.com/docs/getting-started/quickstart):
 *  - Required (block install): OS, Git, Python 3.11+, WSL2 on Windows.
 *  - Recommended (warn, don't block): ripgrep, curl, ffmpeg.
 *  - Auto-installed by the Hermes installer (uv): pip, python-venv, Node.
 */
const initialPrereqs: Prerequisite[] = [
  { id: "os", name: "Operating System", description: "Detecting platform...", status: "pending", tier: "required" },
  { id: "wsl2", name: "WSL2 (Windows)", description: "Windows Subsystem for Linux 2", status: "pending", tier: "required", windowsOnly: true },
  { id: "git", name: "Git", description: "Version control — required by the installer", status: "pending", tier: "required" },
  { id: "python", name: "Python 3.11+", description: "Required runtime", status: "pending", tier: "required" },
  // Recommended
  { id: "ripgrep", name: "ripgrep (rg)", description: "Fast file search — used by the agent's file tools", status: "pending", tier: "recommended" },
  { id: "curl", name: "curl", description: "Used to download the installer and updates", status: "pending", tier: "recommended" },
  // Auto-installed
  { id: "pip", name: "pip", description: "Auto-installed by Hermes (uv) into its own venv", status: "pending", tier: "auto" },
];

const PrerequisiteCheck = ({ onComplete }: { onComplete: () => void }) => {
  const [prereqs, setPrereqs] = useState(initialPrereqs);
  const [scanning, setScanning] = useState(false);
  const [scanComplete, setScanComplete] = useState(false);
  const [hermesInstalled, setHermesInstalled] = useState<{ installed: boolean; version?: string } | null>(null);

  const updatePrereq = (id: string, updates: Partial<Prerequisite>) => {
    setPrereqs((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  };

  const runScan = async () => {
    setScanning(true);

    // First — short-circuit if Hermes is already installed.
    try {
      const hermes = await systemAPI.checkHermes();
      if (hermes.installed) {
        setHermesInstalled(hermes);
        setScanning(false);
        setScanComplete(true);
        return;
      }
    } catch {
      /* keep scanning */
    }

    updatePrereq("os", { status: "checking", description: "Detecting platform..." });
    try {
      const osInfo = await systemAPI.detectOS();
      const macCodename = (v: string): string => {
        const major = parseInt(v.split(".")[0] || "0", 10);
        const map: Record<number, string> = {
          15: "Sequoia", 14: "Sonoma", 13: "Ventura", 12: "Monterey", 11: "Big Sur",
        };
        return map[major] ? ` ${map[major]}` : "";
      };
      const friendly = osInfo.name.startsWith("macOS")
        ? `${osInfo.name}${macCodename(osInfo.version)} ${osInfo.version}`
        : osInfo.name;
      updatePrereq("os", { status: "found", version: friendly, description: "Platform detected" });
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
      // Hide the WSL2 row entirely on macOS/Linux.
      setPrereqs((prev) => prev.filter((p) => p.id !== "wsl2"));
    }

    updatePrereq("python", { status: "checking", description: "Searching for Python 3.11+..." });
    const python = await systemAPI.checkPython();
    if (python.installed) {
      updatePrereq("python", { status: "found", version: python.version, description: `Python ${python.version} found` });
    } else {
      updatePrereq("python", { status: "missing", description: "Python 3.11+ not found" });
    }

    updatePrereq("git", { status: "checking", description: "Checking Git..." });
    const git = await systemAPI.checkGit();
    if (git.installed) {
      updatePrereq("git", { status: "found", version: git.version, description: `Git ${git.version} installed` });
    } else {
      updatePrereq("git", { status: "missing", description: "Git not found" });
    }

    updatePrereq("ripgrep", { status: "checking", description: "Checking ripgrep..." });
    const rg = await systemAPI.checkRipgrep();
    if (rg.installed) {
      updatePrereq("ripgrep", { status: "found", version: rg.version, description: `ripgrep ${rg.version} installed` });
    } else {
      updatePrereq("ripgrep", { status: "missing", description: "Recommended for fast file search — install later if you skip" });
    }

    updatePrereq("curl", { status: "checking", description: "Checking curl..." });
    const curl = await systemAPI.checkCurl();
    if (curl.installed) {
      updatePrereq("curl", { status: "found", version: curl.version, description: `curl ${curl.version} available` });
    } else {
      updatePrereq("curl", { status: "missing", description: "Recommended — used to fetch updates" });
    }

    updatePrereq("pip", { status: "checking", description: "Checking pip (auto-installed by Hermes if missing)..." });
    const pip = await systemAPI.checkPip();
    if (pip.installed) {
      updatePrereq("pip", { status: "found", version: pip.version, description: `pip ${pip.version}` });
    } else {
      updatePrereq("pip", { status: "found", description: "Will be auto-installed by Hermes (uv) — no action needed" });
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
        clearInterval(interval);
        if (result?.success) {
          updatePrereq(id, {
            status: "reboot_required",
            installProgress: 100,
            description: "WSL installed — a system reboot is required to complete setup. Please restart your computer, then re-run this scan.",
          });
        } else {
          updatePrereq(id, {
            status: "error",
            installProgress: 0,
            description: `Installation failed: ${result?.stderr || 'Unknown error'}`,
          });
        }
        return;
      case "python":
        result = await systemAPI.installPython();
        break;
      case "pip":
        result = await systemAPI.installPip();
        break;
      case "git":
        result = await systemAPI.installGit();
        break;
      case "curl":
        result = await systemAPI.installCurl();
        break;
      case "ripgrep":
        result = await systemAPI.installRipgrep();
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

  // Block install only on truly required items (the ones Hermes docs list).
  const allRequiredMet = prereqs
    .filter((p) => p.tier === "required")
    .every((p) => p.status === "found" || p.status === "installed");

  const needsReboot = prereqs.some((p) => p.status === "reboot_required");

  const required = prereqs.filter((p) => p.tier === "required");
  const recommended = prereqs.filter((p) => p.tier === "recommended");
  const auto = prereqs.filter((p) => p.tier === "auto");

  // Hermes already installed — collapse the screen.
  if (hermesInstalled?.installed) {
    return (
      <div className="space-y-4">
        <div className="glass-subtle rounded-lg p-4 flex items-start gap-3 border border-success/20">
          <CheckCircle2 className="w-5 h-5 text-success shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">
              Hermes is already installed
              {hermesInstalled.version && (
                <span className="ml-2 text-xs font-mono text-accent">v{hermesInstalled.version}</span>
              )}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Skip ahead — no system prerequisites needed.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setHermesInstalled(null); setScanComplete(false); }}
          >
            <RotateCcw className="w-3 h-3 mr-1" /> Re-scan
          </Button>
          <Button onClick={onComplete} className="gradient-primary text-primary-foreground flex-1">
            Continue <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Monitor className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-semibold text-foreground">System Prerequisites</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          We'll scan your system. Only the items marked <span className="text-foreground font-medium">Required</span> block installation —
          recommended packages can be added later.
        </p>
      </div>

      {!scanning && !scanComplete && (
        <Button onClick={runScan} className="gradient-primary text-primary-foreground w-full">
          <Monitor className="w-4 h-4 mr-2" /> Scan System
        </Button>
      )}

      {(scanning || scanComplete) && (
        <div className="space-y-5">
          <PrereqGroup
            title="Required"
            subtitle="Hermes won't install without these"
            items={required}
            onInstall={installPrereq}
          />
          {recommended.length > 0 && (
            <PrereqGroup
              title="Recommended"
              subtitle="Improves the agent's capabilities — not required"
              items={recommended}
              onInstall={installPrereq}
            />
          )}
          {auto.length > 0 && (
            <PrereqGroup
              title="Auto-installed by Hermes"
              subtitle="Bundled by the official installer (uv) — informational only"
              items={auto}
              onInstall={installPrereq}
              dimmed
            />
          )}
        </div>
      )}

      {scanComplete && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          {needsReboot ? (
            <div className="glass-subtle rounded-lg p-3 flex items-center gap-2 border border-warning/20">
              <RotateCcw className="w-4 h-4 text-warning" />
              <p className="text-sm text-warning">
                A system reboot is required to finish WSL setup. Please restart your computer, then re-open this app and scan again.
              </p>
            </div>
          ) : allRequiredMet ? (
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
            disabled={!allRequiredMet || needsReboot}
            className="gradient-primary text-primary-foreground w-full mt-4"
          >
            Continue <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </motion.div>
      )}
    </div>
  );
};

const PrereqGroup = ({
  title,
  subtitle,
  items,
  onInstall,
  dimmed,
}: {
  title: string;
  subtitle: string;
  items: Prerequisite[];
  onInstall: (id: string) => void;
  dimmed?: boolean;
}) => {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2 px-1">
        <h3 className={`text-xs font-semibold uppercase tracking-wide ${dimmed ? "text-muted-foreground" : "text-foreground"}`}>
          {title}
        </h3>
        <span className="text-[11px] text-muted-foreground">{subtitle}</span>
      </div>
      <div className="space-y-2">
        {items.map((prereq, i) => (
          <motion.div
            key={prereq.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
          >
            <div className={`glass-subtle rounded-lg p-3 flex items-start justify-between gap-2 ${dimmed ? "opacity-70" : ""}`}>
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className="mt-0.5">
                  <StatusIcon status={prereq.status} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-foreground">{prereq.name}</p>
                    {prereq.version && (
                      <span className="text-xs font-mono text-accent">{prereq.version}</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground break-words">{prereq.description}</p>
                  {prereq.status === "installing" && prereq.installProgress !== undefined && (
                    <Progress value={prereq.installProgress} className="h-1 mt-2" />
                  )}
                </div>
              </div>
              {prereq.status === "missing" && prereq.id !== "pip" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-primary hover:text-primary shrink-0"
                  onClick={() => onInstall(prereq.id)}
                >
                  <Download className="w-3 h-3 mr-1" /> Install
                </Button>
              )}
              {prereq.status === "reboot_required" && (
                <span className="text-xs font-medium text-warning shrink-0 flex items-center gap-1">
                  <RotateCcw className="w-3 h-3" /> Reboot needed
                </span>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

const StatusIcon = ({ status }: { status: CheckStatus }) => {
  switch (status) {
    case "found":
    case "installed":
      return <CheckCircle2 className="w-4 h-4 text-success shrink-0" />;
    case "reboot_required":
      return <RotateCcw className="w-4 h-4 text-warning shrink-0" />;
    case "missing":
      return <XCircle className="w-4 h-4 text-warning shrink-0" />;
    case "error":
      return <XCircle className="w-4 h-4 text-destructive shrink-0" />;
    case "checking":
    case "installing":
      return <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />;
    default:
      return <Sparkles className="w-4 h-4 text-muted-foreground shrink-0 opacity-40" />;
  }
};

export default PrerequisiteCheck;
