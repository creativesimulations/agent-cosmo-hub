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
  { id: "network", name: "Installer connectivity", description: "Checking network reachability…", tier: "auto", status: "pending" },
  { id: "disk", name: "Disk space", description: "Checking free space…", tier: "auto", status: "pending" },
  { id: "sudo", name: "Sudo capability", description: "Advisory only", tier: "auto", status: "pending" },
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

export type SudoPasswordRequester = (reason: string) => Promise<string | null>;

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

  for (const id of ["desktop-bridge", "os", "arch", "wsl2", "wsl-distro", "git", "fetcher", "network", "disk", "sudo"]) {
    patch(id, { status: "checking" });
  }

  const contract = await evaluateInstallContract();
  applyContract(items, contract.checks, patch, platform.isWindows);
  return items;
}

export function requiredPrereqsMet(items: PrereqItem[]): boolean {
  return items
    .filter((p) => p.blocker)
    .every((p) => p.status === "found" || p.status === "installed");
}

export async function installPrereqItem(id: string, requestSudo?: SudoPasswordRequester): Promise<Partial<PrereqItem>> {
  const platform = await systemAPI.getPlatform();
  switch (id) {
    case "wsl2": {
      const r = await systemAPI.installWSL();
      return r.success
        ? { status: "reboot_required", description: "Reboot required, then scan again." }
        : { status: "error", description: r.stderr || "WSL install failed" };
    }
    case "wsl-distro": {
      const r = await systemAPI.installWSL();
      return r.success
        ? { status: "reboot_required", description: "Ubuntu setup may require a reboot or first-launch account setup." }
        : { status: "error", description: r.stderr || "Ubuntu WSL setup failed" };
    }
    case "git": {
      if (platform.isLinux || platform.isWindows) {
        return installAptWithCapability(["git"], requestSudo);
      }
      const r = await systemAPI.installGit();
      return r.success ? { status: "installed" } : { status: "error", description: r.stderr || "Failed" };
    }
    case "python3-venv": {
      if (platform.isLinux || platform.isWindows) {
        return installAptWithCapability(["python3-venv"], requestSudo);
      }
      return {
        status: "error",
        description: "Automatic python3-venv recovery is only available on apt-based Linux/WSL systems.",
      };
    }
    case "fetcher":
    case "curl": {
      if (platform.isLinux || platform.isWindows) {
        return installAptWithCapability(["curl"], requestSudo);
      }
      const r = await systemAPI.installCurl();
      return r.success ? { status: "installed" } : { status: "error", description: r.stderr || "Failed" };
    }
    default:
      return { status: "error", description: "Unsupported" };
  }
}

async function installAptWithCapability(
  packages: string[],
  requestSudo?: SudoPasswordRequester,
): Promise<Partial<PrereqItem>> {
  const probe = await sudoAPI.probe();
  if (probe.kind === "passwordless") {
    const result = await sudoAPI.aptInstall(packages, "");
    return result.success
      ? { status: "installed", description: `Installed ${packages.join(", ")}` }
      : { status: "error", description: result.stderr || "apt install failed" };
  }
  if (probe.kind === "needs-password" && requestSudo) {
    const reason = `install ${packages.join(", ")} for Hermes setup`;
    const password = await requestSudo(reason);
    if (password === null) {
      return { status: "error", description: "Cancelled before installing system packages." };
    }
    const result = await sudoAPI.aptInstall(packages, password);
    return result.success
      ? { status: "installed", description: `Installed ${packages.join(", ")}` }
      : { status: "error", description: result.stderr || "apt install failed" };
  }
  if (probe.kind === "needs-password") {
    return {
      status: "error",
      description: `Needs elevated access. Run manually: sudo apt-get install -y ${packages.join(" ")}`,
      manualCommand: `sudo apt-get install -y ${packages.join(" ")}`,
    };
  }
  if (probe.kind === "no-password-set") {
    return {
      status: "error",
      description: "This Linux user does not appear to have a sudo password yet. Set one for the WSL/Linux account, then retry.",
      manualCommand: "passwd",
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
