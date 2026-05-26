// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { systemAPI } from "@/lib/systemAPI";
import { sudoAPI } from "@/lib/systemAPI/sudo";
import { probeAgent } from "./setupService";
import type { AgentProbe } from "./types";
import { evaluateInstallContract, type InstallContractCheck } from "./installContract";

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
  blocker?: boolean;
  manualCommand?: string;
  autoInstallId?: string;
};

const BASE: PrereqItem[] = [
  { id: "desktop-bridge", name: "Desktop bridge", description: "Checking Electron IPC bridge…", tier: "required", status: "pending", blocker: true },
  { id: "os", name: "Operating System", description: "Detecting…", tier: "required", status: "pending", blocker: true },
  { id: "arch", name: "CPU Architecture", description: "Detecting…", tier: "required", status: "pending", blocker: true },
  { id: "wsl2", name: "WSL2", description: "Windows only", tier: "required", status: "pending", windowsOnly: true, blocker: true },
  { id: "wsl-distro", name: "WSL Ubuntu distro", description: "Windows only", tier: "required", status: "pending", windowsOnly: true, blocker: true },
  { id: "git", name: "Git", description: "Required by installer", tier: "required", status: "pending", blocker: true },
  { id: "fetcher", name: "curl/wget", description: "Required for installer fetch", tier: "required", status: "pending", blocker: true },
  { id: "network", name: "Installer connectivity", description: "Checking network reachability…", tier: "required", status: "pending", blocker: true },
  { id: "disk", name: "Disk space", description: "Checking free space…", tier: "required", status: "pending", blocker: true },
  { id: "python-discoverability", name: "Python discoverability", description: "Advisory only", tier: "auto", status: "pending" },
  { id: "sudo", name: "Sudo capability", description: "Advisory only", tier: "auto", status: "pending" },
  { id: "ripgrep", name: "ripgrep", description: "Recommended", tier: "recommended", status: "pending" },
  { id: "curl", name: "curl", description: "Recommended", tier: "recommended", status: "pending" },
];

export type PrereqScanResult = {
  items: PrereqItem[];
  /** Full connectable install at ~/.hermes */
  agentReady: boolean;
  /** Hermes CLI on PATH but no Ronbot workspace */
  cliOnly: boolean;
  agentVersion?: string;
  probe?: AgentProbe;
};

export type PrereqScanOptions = {
  /** Reuse probe from setup context to avoid duplicate shell round-trips */
  cachedProbe?: AgentProbe | null;
};

export async function runPrereqScan(options?: PrereqScanOptions): Promise<PrereqScanResult> {
  const probe = options?.cachedProbe ?? (await probeAgent());

  if (probe.reason === "ready" && probe.ready) {
    return {
      items: [],
      agentReady: true,
      cliOnly: false,
      agentVersion: probe.versionSummary?.split("\n")[0],
      probe,
    };
  }

  if (probe.reason === "cli_only") {
    const items = await scanDependencyItems();
    return { items, agentReady: false, cliOnly: true, probe };
  }

  const items = await scanDependencyItems();
  return { items, agentReady: false, cliOnly: false, probe };
}

async function scanDependencyItems(): Promise<PrereqItem[]> {
  const items: PrereqItem[] = BASE.map((p) => ({ ...p }));

  const patch = (id: string, partial: Partial<PrereqItem>) => {
    const i = items.findIndex((p) => p.id === id);
    if (i >= 0) items[i] = { ...items[i], ...partial };
  };

  const platform = await systemAPI.getPlatform();

  for (const id of ["desktop-bridge", "os", "arch", "wsl2", "wsl-distro", "git", "fetcher", "network", "disk", "python-discoverability", "sudo", "ripgrep", "curl"]) {
    patch(id, { status: "checking" });
  }

  const contract = await evaluateInstallContract();
  applyContract(items, contract.checks, patch, platform.isWindows);

  const bridgeOk = contract.checks.find((check) => check.id === "desktop-bridge")?.status === "ok";
  if (!bridgeOk) {
    patch("ripgrep", {
      status: "pending",
      description: "Optional — verification requires desktop bridge.",
    });
    patch("curl", {
      status: "pending",
      description: "Optional — verification requires desktop bridge.",
    });
    return items;
  }

  await Promise.all([
    systemAPI.checkRipgrep().then((rg) =>
      patch(
        "ripgrep",
        rg.installed
          ? { status: "found", version: rg.version }
          : { status: "missing", description: "Optional — install later from Skills" },
      ),
    ),
    systemAPI.checkCurl().then((curl) =>
      patch(
        "curl",
        curl.installed
          ? { status: "found", version: curl.version }
          : { status: "missing", description: "Optional — used for updates" },
      ),
    ),
  ]);
  return items;
}

export function requiredPrereqsMet(items: PrereqItem[]): boolean {
  return items
    .filter((p) => p.blocker)
    .every((p) => p.status === "found" || p.status === "installed");
}

export async function installPrereqItem(id: string): Promise<Partial<PrereqItem>> {
  const platform = await systemAPI.getPlatform();
  switch (id) {
    case "wsl2": {
      const r = await systemAPI.installWSL();
      return r.success
        ? { status: "reboot_required", description: "Reboot required, then scan again." }
        : { status: "error", description: r.stderr || "WSL install failed" };
    }
    case "python": {
      if (platform.isLinux || platform.isWindows) {
        const apt = await installAptWithCapability(["python3.11", "python3.11-venv", "python3-pip"]);
        return apt;
      }
      const r = await systemAPI.installPython();
      return r.success ? { status: "installed" } : { status: "error", description: r.stderr || "Failed" };
    }
    case "git": {
      if (platform.isLinux || platform.isWindows) {
        return installAptWithCapability(["git"]);
      }
      const r = await systemAPI.installGit();
      return r.success ? { status: "installed" } : { status: "error", description: r.stderr || "Failed" };
    }
    case "fetcher":
    case "curl": {
      if (platform.isLinux || platform.isWindows) {
        return installAptWithCapability(["curl"]);
      }
      const r = await systemAPI.installCurl();
      return r.success ? { status: "installed" } : { status: "error", description: r.stderr || "Failed" };
    }
    case "ripgrep": {
      if (platform.isLinux || platform.isWindows) {
        return installAptWithCapability(["ripgrep"]);
      }
      const r = await systemAPI.installRipgrep();
      return r.success ? { status: "installed" } : { status: "error", description: r.stderr || "Failed" };
    }
    default:
      return { status: "error", description: "Unsupported" };
  }
}

async function installAptWithCapability(packages: string[]): Promise<Partial<PrereqItem>> {
  const probe = await sudoAPI.probe();
  if (probe.kind === "passwordless") {
    const result = await sudoAPI.aptInstall(packages, "");
    return result.success
      ? { status: "installed", description: `Installed ${packages.join(", ")}` }
      : { status: "error", description: result.stderr || "apt install failed" };
  }
  if (probe.kind === "needs-password" || probe.kind === "no-password-set") {
    return {
      status: "error",
      description: `Needs elevated access. Run manually: sudo apt-get install -y ${packages.join(" ")}`,
      manualCommand: `sudo apt-get install -y ${packages.join(" ")}`,
    };
  }
  return {
    status: "error",
    description: `sudo unavailable. Run manually as admin: apt-get install -y ${packages.join(" ")}`,
    manualCommand: `sudo apt-get install -y ${packages.join(" ")}`,
  };
}

function applyContract(
  items: PrereqItem[],
  checks: InstallContractCheck[],
  patch: (id: string, partial: Partial<PrereqItem>) => void,
  isWindows: boolean,
) {
  const toPrereqStatus = (status: InstallContractCheck["status"]): PrereqStatus => {
    if (status === "ok") return "found";
    if (status === "fixable_auto") return "missing";
    return "error";
  };

  for (const check of checks) {
    patch(check.id, {
      status: toPrereqStatus(check.status),
      description: check.detail,
      blocker: check.severity === "hard",
      autoInstallId: check.autoInstallId,
      manualCommand: check.manualCommand,
    });
  }

  if (!isWindows) {
    for (const id of ["wsl2", "wsl-distro"]) {
      const idx = items.findIndex((item) => item.id === id);
      if (idx >= 0) items.splice(idx, 1);
    }
  }
}
