// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { systemAPI } from "@/lib/systemAPI";
import { createStreamLineParser } from "./streamOutput";
import { finalizeAfterInstall } from "./setupService";
import type { InstallLogSink, InstallSource } from "./types";
import { evaluateInstallContract } from "./installContract";
import { classifyInstallFailure, type InstallFailure } from "./installErrors";
import { pushInstallEvent, type InstallEvent } from "./installTelemetry";
import {
  collectInstallAptPackages,
  installAptPackages,
  runHermesInstaller,
  summarizeCommandFailureOutput,
  tailCommandOutput,
  type SudoRequester,
} from "./installStages";

export type { SudoRequester } from "./installStages";

export type RunInstallParams = {
  source: InstallSource;
  localPath?: string;
  seedPersona: boolean;
  agentName: string;
  log: InstallLogSink;
  requestSudo: SudoRequester;
  isAborted: () => boolean;
  onStreamId?: (id: string) => void;
};

export type RunInstallResult =
  | { ok: true; events: InstallEvent[] }
  | { ok: false; message: string; cancelled?: boolean; failure?: InstallFailure; manualCommand?: string; events?: InstallEvent[] };

export async function runAgentInstall(params: RunInstallParams): Promise<RunInstallResult> {
  const { source, localPath, seedPersona, agentName, log, requestSudo, isAborted, onStreamId } = params;
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

  const aptPackages = await collectInstallAptPackages(source, log);
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
    if (aptOutcome.ok === false && aptOutcome.cancelled) return { ok: false, message: "Cancelled", cancelled: true };
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
  const result = await runHermesInstaller(source, localPath, parse, onStreamId);
  flush();
  if (isAborted()) return { ok: false, message: "Cancelled", cancelled: true };

  if (!result.success) {
    const lines = [`✗ Installation failed (exit ${result.code ?? "?"})`, ...summarizeCommandFailureOutput(result)];
    log(lines.length > 1 ? lines : [`✗ Installation failed (exit ${result.code ?? "?"})`, `--- details ---`, tailCommandOutput(result, 20)]);
    const message = "Hermes installer exited with an error.";
    const failureOutput = [result.stderr, result.stdout].filter(Boolean).join("\n");
    emit({
      ts: new Date().toISOString(),
      phase: "installer",
      step: "run-hermes-installer",
      status: "error",
      message: `${message} Exit ${result.code ?? "?"}`,
    });
    return { ok: false, message, failure: classifyInstallFailure(message, undefined, failureOutput), events };
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
  if (finalized.ok === false) {
    const failMessage = finalized.message;
    emit({
      ts: new Date().toISOString(),
      phase: "verify",
      step: "post-install-verification",
      status: "error",
      message: failMessage,
      errorCode: "verify_failed",
    });
    return {
      ok: false,
      message: failMessage,
      failure: classifyInstallFailure(failMessage),
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
