// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { systemAPI } from "@/lib/systemAPI";
import { runHermesShell, HERMES_PATH_EXPORT } from "@/lib/systemAPI/hermes/shell";

export type ContractStatus = "ok" | "fixable_auto" | "fixable_manual" | "blocked_unsupported";
export type ContractSeverity = "hard" | "soft";
export type ContractDomain = "host" | "guest" | "shared";

export type InstallContractCheck = {
  id: string;
  label: string;
  status: ContractStatus;
  severity: ContractSeverity;
  domain: ContractDomain;
  detail: string;
  manualCommand?: string;
  autoInstallId?: string;
};

export type InstallContractReport = {
  checks: InstallContractCheck[];
  hasHardBlockers: boolean;
};

const MIN_DISK_HARD_BYTES = Math.floor(1.5 * 1024 ** 3);
const MIN_DISK_RECOMMENDED_BYTES = Math.floor(2 * 1024 ** 3);

function statusFromInstalled(installed: boolean, soft = false): ContractStatus {
  if (installed) return "ok";
  return soft ? "fixable_manual" : "fixable_auto";
}

/**
 * Run a script in the same shell domain where the Hermes installer will run
 * (WSL on Windows, native bash on macOS/Linux). Always prepends the standard
 * Hermes PATH so Homebrew (/opt/homebrew/bin), /usr/local/bin, ~/.local/bin,
 * snap, and the Hermes venv are visible. Without this, common tools installed
 * via Homebrew on macOS report as "missing" → false-negative prereqs.
 */
async function runInHermesDomain(
  inner: string,
  timeout = 15000,
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const script = [HERMES_PATH_EXPORT, inner].join("\n");
  const result = await runHermesShell(script, { timeout });
  return {
    success: result.success,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

/**
 * Tolerant binary probe: a binary is considered installed if `command -v`
 * resolves it, regardless of whether `--version` prints. Some tools (busybox
 * wget) print to stderr or exit non-zero on `--version | head -1` because of
 * SIGPIPE on the producer side.
 */
async function checkGuestBinary(bin: string): Promise<{ installed: boolean; version?: string }> {
  const presence = await runInHermesDomain(
    `command -v ${bin} >/dev/null 2>&1 && echo FOUND || echo MISSING`,
  );
  if (!presence.stdout.includes("FOUND")) return { installed: false };
  const versionResult = await runInHermesDomain(
    `${bin} --version 2>&1 | head -1 || true`,
    8000,
  );
  const versionLine = (versionResult.stdout || "").trim().split("\n").pop() || "";
  return { installed: true, version: versionLine || `${bin} found` };
}

function parseFirstVersion(raw: string): number | null {
  const match = raw.match(/(\d+)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

async function checkNetworkReachability(): Promise<{ ok: boolean; detail: string }> {
  const script = [
    "set -e",
    "if command -v curl >/dev/null 2>&1; then",
    "  curl -fsSLI --max-time 8 https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh >/dev/null",
    "  echo OK:curl",
    "  exit 0",
    "fi",
    "if command -v wget >/dev/null 2>&1; then",
    "  wget -q --spider --timeout=8 https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh",
    "  echo OK:wget",
    "  exit 0",
    "fi",
    "echo NO_FETCHER",
    "exit 2",
  ].join("\n");
  const result = await runInHermesDomain(script);
  if (result.success) {
    return { ok: true, detail: `Installer endpoint reachable (${result.stdout.trim() || "ok"})` };
  }
  if ((result.stdout || "").includes("NO_FETCHER")) {
    return { ok: false, detail: "Cannot test installer reachability: neither curl nor wget found in install shell." };
  }
  return { ok: false, detail: "Could not reach raw.githubusercontent.com from install shell." };
}

const CONTRACT_CACHE_TTL_MS = 3000;
let contractCache: { report: InstallContractReport; at: number } | null = null;

export function invalidateInstallContractCache(): void {
  contractCache = null;
}

export async function evaluateInstallContract(options?: { useCache?: boolean }): Promise<InstallContractReport> {
  const now = Date.now();
  if (options?.useCache && contractCache && now - contractCache.at < CONTRACT_CACHE_TTL_MS) {
    return contractCache.report;
  }
  const report = await evaluateInstallContractInner();
  contractCache = { report, at: now };
  return report;
}

async function evaluateInstallContractInner(): Promise<InstallContractReport> {
  const checks: InstallContractCheck[] = [];
  const platform = await systemAPI.getPlatform();
  const bridge = await systemAPI.checkDesktopBridge();

  checks.push({
    id: "desktop-bridge",
    label: "Desktop bridge",
    status: bridge.ok ? "ok" : "blocked_unsupported",
    severity: "hard",
    domain: "host",
    detail: bridge.ok ? "Electron IPC bridge is healthy." : bridge.reason,
  });

  if (!bridge.ok) {
    checks.push(
      {
        id: "os",
        label: "Operating system",
        status: "blocked_unsupported",
        severity: "hard",
        domain: "host",
        detail: "Cannot verify host OS until the desktop bridge is available.",
      },
      {
        id: "arch",
        label: "CPU architecture",
        status: "blocked_unsupported",
        severity: "hard",
        domain: "host",
        detail: "Cannot verify CPU architecture until the desktop bridge is available.",
      },
      {
        id: "disk",
        label: "Disk space",
        status: "fixable_manual",
        severity: "soft",
        domain: "host",
        detail: "Disk check unavailable until the desktop bridge is available.",
      },
      {
        id: "git",
        label: "Git (install shell)",
        status: "blocked_unsupported",
        severity: "hard",
        domain: "guest",
        detail: "Cannot verify install shell dependencies until the desktop bridge is available.",
      },
      {
        id: "fetcher",
        label: "curl/wget (install shell)",
        status: "blocked_unsupported",
        severity: "hard",
        domain: "guest",
        detail: "Cannot verify install shell dependencies until the desktop bridge is available.",
      },
      {
        id: "network",
        label: "Installer connectivity",
        status: "fixable_manual",
        severity: "soft",
        domain: "guest",
        detail: "Connectivity preflight unavailable until the desktop bridge is available.",
      },
      {
        id: "sudo",
        label: "Sudo capability",
        status: "fixable_manual",
        severity: "soft",
        domain: "guest",
        detail: "Sudo probe unavailable until the desktop bridge is available.",
      },
    );
    if (platform.isWindows) {
      checks.push(
        {
          id: "wsl2",
          label: "WSL2",
          status: "blocked_unsupported",
          severity: "hard",
          domain: "host",
          detail: "Cannot verify WSL until the desktop bridge is available.",
        },
        {
          id: "wsl-distro",
          label: "WSL distro",
          status: "blocked_unsupported",
          severity: "hard",
          domain: "host",
          detail: "Cannot verify WSL distro until the desktop bridge is available.",
        },
      );
    }
    return {
      checks,
      hasHardBlockers: true,
    };
  }

  // OS support
  let osStatus: ContractStatus = "ok";
  let osDetail = "Supported platform";
  const detected = await systemAPI.detectOS().catch(() => ({ name: "Unknown", version: "" }));
  if (platform.isWindows) {
    const major = parseFirstVersion(detected.version);
    if (major !== null && major < 10) {
      osStatus = "blocked_unsupported";
      osDetail = `Windows ${detected.version} is unsupported; Windows 10+ required.`;
    } else {
      osDetail = `Windows ${detected.version || platform.release}`;
    }
  } else if (platform.isMac) {
    const major = parseFirstVersion(detected.version);
    if (major !== null && major < 13) {
      osStatus = "blocked_unsupported";
      osDetail = `macOS ${detected.version} is unsupported; macOS 13+ recommended.`;
    } else {
      osDetail = `macOS ${detected.version}`;
    }
  } else if (platform.isLinux) {
    // Keep Linux broad but explicit that Ubuntu LTS is target path.
    osDetail = `${detected.name} (Ubuntu LTS strongly recommended)`;
  } else {
    osStatus = "blocked_unsupported";
    osDetail = "Unsupported OS.";
  }
  checks.push({
    id: "os",
    label: "Operating system",
    status: osStatus,
    severity: "hard",
    domain: "host",
    detail: osDetail,
  });

  // Architecture support
  const arch = (platform.arch || "").toLowerCase();
  const supportedArch = arch === "x64" || arch === "arm64";
  checks.push({
    id: "arch",
    label: "CPU architecture",
    status: supportedArch ? "ok" : "blocked_unsupported",
    severity: "hard",
    domain: "host",
    detail: supportedArch ? `${platform.arch} supported` : `${platform.arch} unsupported (x64/arm64 only)`,
  });

  // Disk guard
  const disk = await systemAPI.getDiskSpace().catch(() => ({ success: false } as const));
  if (disk.success && typeof disk.freeBytes === "number") {
    const free = disk.freeBytes;
    const status = free < MIN_DISK_RECOMMENDED_BYTES ? "fixable_manual" : "ok";
    const detail =
      free < MIN_DISK_HARD_BYTES
        ? `Very low disk space: ${(free / 1024 ** 3).toFixed(2)} GB free. The installer may fail.`
        : free < MIN_DISK_RECOMMENDED_BYTES
          ? `Disk space is below 2 GB recommended (${(free / 1024 ** 3).toFixed(2)} GB free).`
          : `${(free / 1024 ** 3).toFixed(2)} GB free`;
    checks.push({
      id: "disk",
      label: "Disk space",
      status,
      severity: "soft",
      domain: "host",
      detail,
    });
  } else {
    checks.push({
      id: "disk",
      label: "Disk space",
      status: "fixable_manual",
      severity: "soft",
      domain: "host",
      detail: "Could not detect free disk space.",
    });
  }

  // Windows-specific WSL contract
  if (platform.isWindows) {
    const wsl = await systemAPI.checkWSL();
    const isWsl2 = wsl.installed && /\b2\b/.test(wsl.version ?? "");
    const distroLooksUbuntu = !!wsl.distro && /ubuntu/i.test(wsl.distro);
    checks.push({
      id: "wsl2",
      label: "WSL2",
      status: isWsl2 ? "ok" : "blocked_unsupported",
      severity: "hard",
      domain: "host",
      detail: isWsl2 ? `Ready (${wsl.version ?? "WSL2"})` : "WSL2 is required on Windows.",
      autoInstallId: "wsl2",
    });
    checks.push({
      id: "wsl-distro",
      label: "WSL distro",
      status: distroLooksUbuntu ? "ok" : "fixable_auto",
      severity: "hard",
      domain: "host",
      detail: distroLooksUbuntu
        ? `Using ${wsl.distro}`
        : "Ubuntu distro not selected/detected. Click Auto-fix to install Ubuntu.",
      autoInstallId: "wsl-distro",
      manualCommand: "wsl --install -d Ubuntu",
    });
  }

  // Guest/domain checks (where Hermes installer actually executes)
  const [guestGit, guestCurl, guestWget] = await Promise.all([
    checkGuestBinary("git"),
    checkGuestBinary("curl"),
    checkGuestBinary("wget"),
  ]);

  checks.push({
    id: "git",
    label: "Git (install shell)",
    status: statusFromInstalled(guestGit.installed),
    severity: "hard",
    domain: "guest",
    detail: guestGit.installed ? guestGit.version ?? "git found" : "Git missing in install shell.",
    autoInstallId: "git",
  });

  const fetcherInstalled = guestCurl.installed || guestWget.installed;
  checks.push({
    id: "fetcher",
    label: "curl/wget (install shell)",
    status: fetcherInstalled ? "ok" : "fixable_manual",
    severity: "hard",
    domain: "guest",
    detail: fetcherInstalled
      ? `Ready (${guestCurl.installed ? "curl" : "wget"})`
      : "curl or wget is required in the install shell.",
    autoInstallId: guestCurl.installed ? undefined : "curl",
  });

  const network = await checkNetworkReachability();
  checks.push({
    id: "network",
    label: "Installer connectivity",
    status: network.ok ? "ok" : "fixable_manual",
    severity: "soft",
    domain: "guest",
    detail: network.detail,
  });

  // Sudo capability is advisory: Hermes can still install core without it.
  const sudoState = await systemAPI.sudo.probe().catch(() => ({ kind: "no-sudo" } as const));
  const sudoDetailByKind: Record<string, string> = {
    root: "Running as root.",
    passwordless: "sudo available without password.",
    "needs-password": "sudo requires password (auto-install still possible with prompt).",
    "no-password-set": "sudo available after setting a password.",
    "no-sudo": "sudo unavailable; optional system deps may need admin to install manually.",
  };
  checks.push({
    id: "sudo",
    label: "Sudo capability",
    status: sudoState.kind === "no-sudo" ? "fixable_manual" : "ok",
    severity: "soft",
    domain: "guest",
    detail: sudoDetailByKind[sudoState.kind] ?? "Unknown sudo state.",
  });

  return {
    checks,
    hasHardBlockers: checks.some((check) => check.severity === "hard" && check.status !== "ok"),
  };
}
