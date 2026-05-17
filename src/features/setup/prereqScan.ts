// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { systemAPI } from "@/lib/systemAPI";
import { probeAgent } from "./setupService";

export type PrereqTier = "required" | "recommended" | "auto";
export type PrereqStatus =
  | "pending"
  | "checking"
  | "found"
  | "missing"
  | "installing"
  | "installed"
  | "error"
  | "reboot_required";

export type PrereqItem = {
  id: string;
  name: string;
  description: string;
  tier: PrereqTier;
  status: PrereqStatus;
  version?: string;
  windowsOnly?: boolean;
};

const BASE: PrereqItem[] = [
  { id: "os", name: "Operating System", description: "Detecting…", tier: "required", status: "pending" },
  { id: "wsl2", name: "WSL2", description: "Windows only", tier: "required", status: "pending", windowsOnly: true },
  { id: "git", name: "Git", description: "Required by installer", tier: "required", status: "pending" },
  { id: "python", name: "Python 3.11+", description: "Required runtime", tier: "required", status: "pending" },
  { id: "ripgrep", name: "ripgrep", description: "Recommended", tier: "recommended", status: "pending" },
  { id: "curl", name: "curl", description: "Recommended", tier: "recommended", status: "pending" },
];

export type PrereqScanResult = {
  items: PrereqItem[];
  agentReady: boolean;
  agentVersion?: string;
};

export async function runPrereqScan(): Promise<PrereqScanResult> {
  const probe = await probeAgent();
  if (probe.ready) {
    return {
      items: [],
      agentReady: true,
      agentVersion: probe.versionSummary?.split("\n")[0],
    };
  }

  const items: PrereqItem[] = [...BASE];
  const patch = (id: string, partial: Partial<PrereqItem>) => {
    const i = items.findIndex((p) => p.id === id);
    if (i >= 0) items[i] = { ...items[i], ...partial };
  };

  patch("os", { status: "checking" });
  try {
    const os = await systemAPI.detectOS();
    patch("os", { status: "found", version: os.name, description: os.name });
  } catch {
    patch("os", { status: "error", description: "Could not detect OS" });
  }

  const platform = await systemAPI.getPlatform();
  if (!platform.isWindows) {
    const idx = items.findIndex((p) => p.id === "wsl2");
    if (idx >= 0) items.splice(idx, 1);
  } else {
    patch("wsl2", { status: "checking" });
    const wsl = await systemAPI.checkWSL();
    patch(
      "wsl2",
      wsl.installed
        ? { status: "found", version: wsl.version, description: wsl.distro ?? wsl.version }
        : { status: "missing", description: "WSL2 required on Windows" },
    );
  }

  patch("python", { status: "checking" });
  const py = await systemAPI.checkPython();
  patch(
    "python",
    py.installed
      ? { status: "found", version: py.version, description: `Python ${py.version}` }
      : { status: "missing", description: "Python 3.11+ not found" },
  );

  patch("git", { status: "checking" });
  const git = await systemAPI.checkGit();
  patch(
    "git",
    git.installed
      ? { status: "found", version: git.version, description: `Git ${git.version}` }
      : { status: "missing", description: "Git not found" },
  );

  patch("ripgrep", { status: "checking" });
  const rg = await systemAPI.checkRipgrep();
  patch(
    "ripgrep",
    rg.installed
      ? { status: "found", version: rg.version }
      : { status: "missing", description: "Optional — install later from Skills" },
  );

  patch("curl", { status: "checking" });
  const curl = await systemAPI.checkCurl();
  patch(
    "curl",
    curl.installed
      ? { status: "found", version: curl.version }
      : { status: "missing", description: "Optional — used for updates" },
  );

  return { items, agentReady: false };
}

export function requiredPrereqsMet(items: PrereqItem[]): boolean {
  return items
    .filter((p) => p.tier === "required")
    .every((p) => p.status === "found" || p.status === "installed");
}

export async function installPrereqItem(id: string): Promise<Partial<PrereqItem>> {
  switch (id) {
    case "wsl2": {
      const r = await systemAPI.installWSL();
      return r.success
        ? { status: "reboot_required", description: "Reboot required, then scan again." }
        : { status: "error", description: r.stderr || "WSL install failed" };
    }
    case "python": {
      const r = await systemAPI.installPython();
      return r.success ? { status: "installed" } : { status: "error", description: r.stderr || "Failed" };
    }
    case "git": {
      const r = await systemAPI.installGit();
      return r.success ? { status: "installed" } : { status: "error", description: r.stderr || "Failed" };
    }
    case "curl": {
      const r = await systemAPI.installCurl();
      return r.success ? { status: "installed" } : { status: "error", description: r.stderr || "Failed" };
    }
    case "ripgrep": {
      const r = await systemAPI.installRipgrep();
      return r.success ? { status: "installed" } : { status: "error", description: r.stderr || "Failed" };
    }
    default:
      return { status: "error", description: "Unsupported" };
  }
}
