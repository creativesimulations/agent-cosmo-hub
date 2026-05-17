// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { systemAPI } from "@/lib/systemAPI";
import { probeAgent } from "./setupService";
import type { AgentProbe } from "./types";

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

  const osPromise = systemAPI
    .detectOS()
    .then((os) => patch("os", { status: "found", version: os.name, description: os.name }))
    .catch(() => patch("os", { status: "error", description: "Could not detect OS" }));

  const wslPromise = (async () => {
    if (!platform.isWindows) {
      const idx = items.findIndex((p) => p.id === "wsl2");
      if (idx >= 0) items.splice(idx, 1);
      return;
    }
    patch("wsl2", { status: "checking" });
    const wsl = await systemAPI.checkWSL();
    patch(
      "wsl2",
      wsl.installed
        ? { status: "found", version: wsl.version, description: wsl.distro ?? wsl.version }
        : { status: "missing", description: "WSL2 required on Windows" },
    );
  })();

  const depPromise = Promise.all([
    systemAPI.checkPython().then((py) =>
      patch(
        "python",
        py.installed
          ? { status: "found", version: py.version, description: `Python ${py.version}` }
          : { status: "missing", description: "Python 3.11+ not found" },
      ),
    ),
    systemAPI.checkGit().then((git) =>
      patch(
        "git",
        git.installed
          ? { status: "found", version: git.version, description: `Git ${git.version}` }
          : { status: "missing", description: "Git not found" },
      ),
    ),
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

  patch("os", { status: "checking" });
  patch("python", { status: "checking" });
  patch("git", { status: "checking" });
  patch("ripgrep", { status: "checking" });
  patch("curl", { status: "checking" });

  await Promise.all([osPromise, wslPromise, depPromise]);
  return items;
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
