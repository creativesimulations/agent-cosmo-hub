// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { systemAPI } from "@/lib/systemAPI";
import { sudoAPI, promptForPasswordMac } from "@/lib/systemAPI/sudo";
import type { CommandResult } from "@/lib/systemAPI/types";
import { LOCAL_INSTALL_PIP_EXTRAS } from "./constants";
import type { InstallLogSink, InstallSource, StreamEvent } from "./types";

export type SudoRequester = (reason: string) => Promise<string | null>;

export type AptInstallOutcome = { ok: true } | { ok: false; cancelled?: boolean };

export function tailCommandOutput(result: CommandResult, lines = 5): string {
  return (result.stderr || result.stdout || "unknown error").trim().split("\n").slice(-lines).join("\n");
}

export function summarizeCommandFailureOutput(result: CommandResult): string[] {
  const summarize = (text: string, lines: number) => {
    const all = text.trim().split("\n").filter(Boolean);
    if (all.length <= lines * 2) return all;
    return [...all.slice(0, lines), "...", ...all.slice(-lines)];
  };

  const out: string[] = [];
  if (result.stderr?.trim()) out.push("--- stderr ---", ...summarize(result.stderr, 20));
  if (result.stdout?.trim()) out.push("--- stdout ---", ...summarize(result.stdout, 20));
  if (result.code === 52) {
    out.push(
      "[hint] Install exited with verification code 52. This often means installer download/fetch failed before any files were created.",
      "[hint] Check network/proxy access to raw.githubusercontent.com and retry.",
    );
  }
  return out;
}

export async function collectInstallAptPackages(source: InstallSource, log: InstallLogSink): Promise<string[]> {
  const append = (line: string) => log([line]);
  const packages: string[] = [];

  if (source === "bundled") {
    append("ℹ The official Hermes installer will manage Python, uv, Node, and other runtime dependencies.");
    return packages;
  }

  if (source === "local" && LOCAL_INSTALL_PIP_EXTRAS.includes("voice")) {
    append("Checking ffmpeg…");
    const ff = await systemAPI.checkFfmpeg();
    if (!ff.found) packages.push("ffmpeg");
    else append(`✓ ffmpeg (${ff.version ?? "ok"})`);
  }

  return packages;
}

export async function installAptPackages(
  packages: string[],
  log: InstallLogSink,
  requestSudo: SudoRequester,
  isAborted: () => boolean,
): Promise<AptInstallOutcome> {
  if (packages.length === 0) return { ok: true };
  const append = (line: string) => log([line]);
  append(`Installing system packages: ${packages.join(", ")}`);

  const probe = await sudoAPI.probe();
  if (isAborted()) return { ok: false, cancelled: true };

  if (probe.kind === "passwordless") {
    const result = await sudoAPI.aptInstall(packages, "");
    if (result.success) {
      append(`✓ Installed ${packages.join(", ")}`);
      return { ok: true };
    }
    append(`✗ apt failed: ${tailCommandOutput(result)}`);
    return { ok: false };
  }

  if (probe.kind === "no-sudo") {
    append("✗ sudo unavailable — install packages manually in a terminal.");
    return { ok: false };
  }

  const platform = await systemAPI.getPlatform();
  const reason = `install ${packages.join(", ")} (required for Hermes)`;
  let password: string | null = "";

  if (platform.isMac) {
    const macPw = await promptForPasswordMac(`Ronbot needs to ${reason}.`);
    password = macPw ?? (await requestSudo(reason));
  } else {
    password = await requestSudo(reason);
  }

  if (isAborted()) return { ok: false, cancelled: true };
  if (password === null) {
    append("✗ Cancelled — system packages not installed.");
    return { ok: false, cancelled: true };
  }

  const result = await sudoAPI.aptInstall(packages, password);
  if (result.success) {
    append(`✓ Installed ${packages.join(", ")}`);
    return { ok: true };
  }
  append(`✗ apt failed: ${tailCommandOutput(result)}`);
  return { ok: false };
}

export function runHermesInstaller(
  source: InstallSource,
  localPath: string | undefined,
  onStream: (event: StreamEvent) => void,
  onStreamId?: (id: string) => void,
): Promise<CommandResult> {
  if (source === "local" && localPath) {
    return systemAPI.installHermesFromLocalFolder(
      localPath,
      [...LOCAL_INSTALL_PIP_EXTRAS],
      onStream,
      onStreamId,
    );
  }
  return systemAPI.installHermes(undefined, onStream, onStreamId);
}
