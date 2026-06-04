// Hermes v0.13.0 sync — May 2026 (Ronbot)
export type InstallErrorCode =
  | "desktop_bridge"
  | "git_missing"
  | "fetcher_missing"
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
  autoInstallId?: string;
  hint?: string;
};

export function classifyInstallFailure(message: string, manualCommand?: string, output = ""): InstallFailure {
  const evidence = [message, output].filter(Boolean).join("\n");
  const lower = evidence.toLowerCase();
  if (lower.includes("desktop bridge")) {
    return {
      code: "desktop_bridge",
      title: "Desktop bridge unavailable",
      message,
      hint: "Run the packaged Ronbot desktop app build so Electron IPC is available.",
    };
  }
  if (lower.includes("wsl2")) {
    return {
      code: "wsl_missing",
      title: "WSL2 is required",
      message,
      manualCommand,
      autoInstallId: "wsl2",
      hint: "Install WSL2 and an Ubuntu distro, then retry.",
    };
  }
  if (lower.includes("ubuntu distro")) {
    return {
      code: "wsl_distro",
      title: "Ubuntu distro required in WSL",
      message,
      manualCommand,
      autoInstallId: "wsl-distro",
    };
  }
  if (
    lower.includes("git: command not found") ||
    lower.includes("git is not installed") ||
    lower.includes("git missing") ||
    lower.includes("unable to find git")
  ) {
    return {
      code: "git_missing",
      title: "Git is required",
      message,
      manualCommand: manualCommand ?? "sudo apt-get update && sudo apt-get install -y git",
      autoInstallId: "git",
      hint: "Ronbot can install Git automatically when sudo is available; otherwise install Git in the same shell Hermes uses.",
    };
  }
  if (
    lower.includes("curl: command not found") ||
    lower.includes("wget: command not found") ||
    lower.includes("curl or wget") ||
    lower.includes("no_fetcher")
  ) {
    return {
      code: "fetcher_missing",
      title: "Installer download tool is missing",
      message,
      manualCommand: manualCommand ?? "sudo apt-get update && sudo apt-get install -y curl",
      autoInstallId: "fetcher",
      hint: "Ronbot needs curl or wget only to fetch the official Hermes installer.",
    };
  }
  if (
    lower.includes("build-essential") ||
    lower.includes("python3-dev") ||
    lower.includes("libffi-dev") ||
    lower.includes("some build tools may be needed") ||
    lower.includes("sudo is needed only to install build tools")
  ) {
    return {
      code: "privilege",
      title: "Build tools need admin access",
      message,
      manualCommand: manualCommand ?? "sudo apt-get update && sudo apt-get install -y build-essential python3-dev libffi-dev",
      autoInstallId: "build-tools",
      hint: "The official installer reached dependency installation and needs native build packages. Ronbot can install them, then continue automatically.",
    };
  }
  if (lower.includes("python3-venv") || lower.includes("ensurepip") || lower.includes("venv")) {
    return {
      code: "privilege",
      title: "Python venv package needs admin access",
      message,
      manualCommand: manualCommand ?? "sudo apt-get update && sudo apt-get install -y python3-venv",
      autoInstallId: "python3-venv",
      hint: "This is an official installer fallback path. Ronbot can retry after installing the package when sudo works.",
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
  const timedOut =
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("no output for");
  if (
    timedOut &&
    (lower.includes("installing node.js dependencies") ||
      lower.includes("npm install") ||
      lower.includes("agent-browser"))
  ) {
    return {
      code: "timeout",
      title: "Installer timed out during browser tools setup",
      message,
      manualCommand: [
        'export PATH="$HOME/.hermes/node/bin:$HOME/.hermes/venv/bin:$HOME/.local/bin:$PATH"',
        'cd "$HOME/.hermes/hermes-agent" && npm install',
      ].join("\n"),
      hint:
        "The Python agent usually installed successfully. Finish npm in WSL, then run `hermes doctor --fix` and restart the gateway from Diagnostics or Channels.",
    };
  }
  if (timedOut) {
    return {
      code: "timeout",
      title: "Installer timed out",
      message,
      hint: "Retry the install, or run the official installer in a WSL terminal if the log shows most steps already succeeded.",
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
