// Hermes v0.13.0 sync — May 2026 (Ronbot)
export type InstallErrorCode =
  | "privilege"
  | "network"
  | "package_repo"
  | "wsl_missing"
  | "wsl_distro"
  | "disk"
  | "timeout"
  | "verify_failed"
  | "unsupported_os"
  | "unknown";

export type InstallFailure = {
  code: InstallErrorCode;
  title: string;
  message: string;
  manualCommand?: string;
  hint?: string;
};

export function classifyInstallFailure(message: string, manualCommand?: string): InstallFailure {
  const lower = message.toLowerCase();
  if (lower.includes("wsl2")) {
    return {
      code: "wsl_missing",
      title: "WSL2 is required",
      message,
      manualCommand,
      hint: "Install WSL2 and an Ubuntu distro, then retry.",
    };
  }
  if (lower.includes("ubuntu distro")) {
    return {
      code: "wsl_distro",
      title: "Ubuntu distro required in WSL",
      message,
      manualCommand,
    };
  }
  if (lower.includes("sudo") || lower.includes("missing packages")) {
    return {
      code: "privilege",
      title: "Admin privileges required",
      message,
      manualCommand,
      hint: "Retry with sudo prompt or run the manual command in a terminal.",
    };
  }
  if (lower.includes("raw.githubusercontent.com") || lower.includes("network") || lower.includes("connectivity")) {
    return {
      code: "network",
      title: "Network connectivity issue",
      message,
      hint: "Check VPN/proxy/firewall access to GitHub raw and package repositories.",
    };
  }
  if (lower.includes("apt") || lower.includes("repository")) {
    return {
      code: "package_repo",
      title: "Package repository issue",
      message,
      manualCommand,
    };
  }
  if (lower.includes("disk")) {
    return {
      code: "disk",
      title: "Not enough disk space",
      message,
    };
  }
  if (lower.includes("timeout")) {
    return {
      code: "timeout",
      title: "Installer timed out",
      message,
    };
  }
  if (lower.includes("verify")) {
    return {
      code: "verify_failed",
      title: "Install verification failed",
      message,
    };
  }
  if (lower.includes("unsupported")) {
    return {
      code: "unsupported_os",
      title: "Unsupported environment",
      message,
    };
  }
  return {
    code: "unknown",
    title: "Installation failed",
    message,
    manualCommand,
  };
}
