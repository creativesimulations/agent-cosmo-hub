// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { systemAPI } from "@/lib/systemAPI";
import { sudoAPI, promptForPasswordMac } from "@/lib/systemAPI/sudo";
import type { CommandResult } from "@/lib/systemAPI/types";
import { LOCAL_INSTALL_PIP_EXTRAS } from "./constants";
import { createStreamLineParser } from "./streamOutput";
import { finalizeAfterInstall } from "./setupService";
import type { InstallLogSink, InstallSource, StreamEvent } from "./types";

export type SudoRequester = (reason: string) => Promise<string | null>;

export type RunInstallParams = {
  source: InstallSource;
  localPath?: string;
  seedPersona: boolean;
  agentName: string;
  log: InstallLogSink;
  requestSudo: SudoRequester;
  isAborted: () => boolean;
};

export type RunInstallResult =
  | { ok: true }
  | { ok: false; message: string; cancelled?: boolean };

async function collectAptPackages(source: InstallSource, log: InstallLogSink): Promise<string[]> {
  const append = (line: string) => log([line]);
  const packages: string[] = [];

  if (source === "local" && LOCAL_INSTALL_PIP_EXTRAS.includes("voice")) {
    append("Checking ffmpeg…");
    const ff = await systemAPI.checkFfmpeg();
    if (!ff.found) packages.push("ffmpeg");
    else append(`✓ ffmpeg (${ff.version ?? "ok"})`);
  }

  append("Checking Python venv support…");
  const venv = await systemAPI.checkPythonVenv();
  const venvPkg = venv.packageName ?? "python3-venv";
  if (venv.installed) append(`✓ ${venvPkg} ready`);
  else packages.push(venvPkg);

  return packages;
}

type AptInstallOutcome = { ok: true } | { ok: false; cancelled?: boolean };

async function installAptPackages(
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
    append(`✗ apt failed: ${tailOutput(result)}`);
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

  if (isAborted()) return false;
  if (password === null) {
    append("✗ Cancelled — system packages not installed.");
    return { ok: false, cancelled: true };
  }

  const result = await sudoAPI.aptInstall(packages, password);
  if (result.success) {
    append(`✓ Installed ${packages.join(", ")}`);
    return { ok: true };
  }
  append(`✗ apt failed: ${tailOutput(result)}`);
  return { ok: false };
}

function tailOutput(result: CommandResult, lines = 5): string {
  return (result.stderr || result.stdout || "unknown error").trim().split("\n").slice(-lines).join("\n");
}

function runHermesInstaller(
  source: InstallSource,
  localPath: string | undefined,
  onStream: (event: StreamEvent) => void,
): Promise<CommandResult> {
  if (source === "local" && localPath) {
    return systemAPI.installHermesFromLocalFolder(
      localPath,
      [...LOCAL_INSTALL_PIP_EXTRAS],
      onStream,
    );
  }
  return systemAPI.installHermes(undefined, onStream);
}

export async function runAgentInstall(params: RunInstallParams): Promise<RunInstallResult> {
  const { source, localPath, seedPersona, agentName, log, requestSudo, isAborted } = params;
  const append = (line: string) => {
    if (!isAborted()) log([line]);
  };

  append(
    source === "bundled"
      ? "Starting official Hermes install (curl … | bash)…"
      : `Installing from local folder with extras: ${LOCAL_INSTALL_PIP_EXTRAS.join(", ")}…`,
  );

  const aptPackages = await collectAptPackages(source, log);
  if (isAborted()) return { ok: false, message: "Cancelled", cancelled: true };

  const aptOutcome = await installAptPackages(aptPackages, log, requestSudo, isAborted);
  if (isAborted()) return { ok: false, message: "Cancelled", cancelled: true };
  if (!aptOutcome.ok) {
    if (aptOutcome.cancelled) return { ok: false, message: "Cancelled", cancelled: true };
    const pkgs = aptPackages.join(" ");
    return {
      ok: false,
      message: pkgs
        ? `Missing packages. Run: sudo apt-get install -y ${pkgs}`
        : "Required system packages could not be installed.",
    };
  }

  const { parse, flush } = createStreamLineParser((lines) => log(lines));
  const result = await runHermesInstaller(source, localPath, parse);
  flush();
  if (isAborted()) return { ok: false, message: "Cancelled", cancelled: true };

  if (!result.success) {
    const lines = [`✗ Installation failed (exit ${result.code ?? "?"})`];
    if (result.stderr?.trim()) lines.push("--- stderr ---", tailOutput(result, 20));
    if (result.stdout?.trim()) lines.push("--- stdout ---", tailOutput(result, 20));
    log(lines);
    return { ok: false, message: "Hermes installer exited with an error." };
  }

  append("✓ Agent installed.");
  const finalized = await finalizeAfterInstall({ seedPersona, agentName, source, log });
  if (isAborted()) return { ok: false, message: "Cancelled", cancelled: true };
  if (!finalized.ok) return { ok: false, message: finalized.message };

  return { ok: true };
}
