// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { systemAPI } from "@/lib/systemAPI";
import { sudoAPI, promptForPasswordMac } from "@/lib/systemAPI/sudo";
import type { CommandResult } from "@/lib/systemAPI/types";
import { LOCAL_INSTALL_PIP_EXTRAS } from "./constants";
import { createStreamLineParser } from "./streamOutput";
import { finalizeAfterInstall } from "./setupService";
import type { InstallLogSink, InstallSource, StreamEvent } from "./types";
import { evaluateInstallContract } from "./installContract";
import { classifyInstallFailure, type InstallFailure } from "./installErrors";
import { pushInstallEvent, type InstallEvent } from "./installTelemetry";

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
  | { ok: true; events: InstallEvent[] }
  | { ok: false; message: string; cancelled?: boolean; failure?: InstallFailure; manualCommand?: string; events?: InstallEvent[] };

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
  else append(`ℹ ${venvPkg} missing pre-install; Hermes installer can self-provision Python/venv via uv.`);

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
  append(`✗ apt failed: ${tailOutput(result)}`);
  return { ok: false };
}

function tailOutput(result: CommandResult, lines = 5): string {
  return (result.stderr || result.stdout || "unknown error").trim().split("\n").slice(-lines).join("\n");
}

function summarizeFailureOutput(result: CommandResult): string[] {
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
  const events: InstallEvent[] = [];
  const emit = (event: InstallEvent) => {
    events.push(event);
    pushInstallEvent(event);
  };
  const append = (line: string) => {
    if (!isAborted()) log([line]);
  };

  append("Checking desktop bridge health…");
  const bridge = await systemAPI.checkDesktopBridge();
  if (!bridge.ok) {
    const message = `Desktop bridge unavailable: ${bridge.reason}`;
    const detailLines = bridge.details.length ? [`[bridge] ${bridge.details.join(" | ")}`] : [];
    log([`✗ ${message}`, ...detailLines]);
    return {
      ok: false,
      message,
      failure: classifyInstallFailure(message),
      events,
    };
  }

  append("Running install preflight contract…");
  emit({
    ts: new Date().toISOString(),
    phase: "preflight",
    step: "contract",
    status: "info",
    message: "Started install contract checks",
  });
  const contract = await evaluateInstallContract();
  const hardFail = contract.checks.find((check) => check.severity === "hard" && check.status !== "ok");
  if (hardFail) {
    const message = `${hardFail.label}: ${hardFail.detail}`;
    emit({
      ts: new Date().toISOString(),
      phase: "preflight",
      step: hardFail.id,
      status: "error",
      message,
    });
    return {
      ok: false,
      message,
      failure: classifyInstallFailure(message, hardFail.manualCommand),
      manualCommand: hardFail.manualCommand,
      events,
    };
  }
  emit({
    ts: new Date().toISOString(),
    phase: "preflight",
    step: "contract",
    status: "ok",
    message: "Preflight hard checks passed",
  });

  append(
    source === "bundled"
      ? "Starting official Hermes install (curl … | bash)…"
      : `Installing from local folder with extras: ${LOCAL_INSTALL_PIP_EXTRAS.join(", ")}…`,
  );

  const aptPackages = await collectAptPackages(source, log);
  emit({
    ts: new Date().toISOString(),
    phase: "dependencies",
    step: "collect",
    status: "info",
    message: aptPackages.length > 0 ? `Need packages: ${aptPackages.join(", ")}` : "No required apt packages",
  });
  if (isAborted()) return { ok: false, message: "Cancelled", cancelled: true };

  const aptOutcome = await installAptPackages(aptPackages, log, requestSudo, isAborted);
  if (isAborted()) return { ok: false, message: "Cancelled", cancelled: true };
  if (!aptOutcome.ok) {
    if (aptOutcome.cancelled) return { ok: false, message: "Cancelled", cancelled: true };
    const pkgs = aptPackages.join(" ");
    const message = pkgs
      ? `Missing packages. Run: sudo apt-get install -y ${pkgs}`
      : "Required system packages could not be installed.";
    emit({
      ts: new Date().toISOString(),
      phase: "dependencies",
      step: "apt-install",
      status: "error",
      message,
      errorCode: "privilege",
    });
    return {
      ok: false,
      message,
      failure: classifyInstallFailure(message, pkgs ? `sudo apt-get install -y ${pkgs}` : undefined),
      manualCommand: pkgs ? `sudo apt-get install -y ${pkgs}` : undefined,
      events,
    };
  }
  emit({
    ts: new Date().toISOString(),
    phase: "dependencies",
    step: "apt-install",
    status: "ok",
    message: aptPackages.length ? "System dependency setup finished" : "No system dependency setup needed",
  });

  const { parse, flush } = createStreamLineParser((lines) => log(lines));
  emit({
    ts: new Date().toISOString(),
    phase: "installer",
    step: "run-hermes-installer",
    status: "info",
    message: source === "bundled" ? "Running official installer" : "Running local-folder install",
  });
  const result = await runHermesInstaller(source, localPath, parse);
  flush();
  if (isAborted()) return { ok: false, message: "Cancelled", cancelled: true };

  if (!result.success) {
    const lines = [`✗ Installation failed (exit ${result.code ?? "?"})`, ...summarizeFailureOutput(result)];
    log(lines.length > 1 ? lines : [`✗ Installation failed (exit ${result.code ?? "?"})`, `--- details ---`, tailOutput(result, 20)]);
    const message = "Hermes installer exited with an error.";
    emit({
      ts: new Date().toISOString(),
      phase: "installer",
      step: "run-hermes-installer",
      status: "error",
      message: `${message} Exit ${result.code ?? "?"}`,
    });
    return { ok: false, message, failure: classifyInstallFailure(message), events };
  }

  emit({
    ts: new Date().toISOString(),
    phase: "installer",
    step: "run-hermes-installer",
    status: "ok",
    message: "Installer process completed",
  });
  append("✓ Agent installed.");
  emit({
    ts: new Date().toISOString(),
    phase: "verify",
    step: "post-install-verification",
    status: "info",
    message: "Running post-install verification",
  });
  const finalized = await finalizeAfterInstall({ seedPersona, agentName, source, log });
  if (isAborted()) return { ok: false, message: "Cancelled", cancelled: true };
  if (!finalized.ok) {
    emit({
      ts: new Date().toISOString(),
      phase: "verify",
      step: "post-install-verification",
      status: "error",
      message: finalized.message,
      errorCode: "verify_failed",
    });
    return {
      ok: false,
      message: finalized.message,
      failure: classifyInstallFailure(finalized.message),
      events,
    };
  }

  emit({
    ts: new Date().toISOString(),
    phase: "finalize",
    step: "complete",
    status: "ok",
    message: "Install + verification complete",
  });

  return { ok: true, events };
}
