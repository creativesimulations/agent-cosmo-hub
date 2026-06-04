// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { systemAPI } from "@/lib/systemAPI";
import { hasUsableHermesInstall } from "@/lib/systemAPI/hermes/installProbe";
import { LOCAL_INSTALL_PIP_EXTRAS } from "./constants";
import { INSTALL_PROGRESS } from "./installProgress";
import { createInstallStreamHandler } from "./installStream";
import type { StreamEvent } from "./types";
import { finalizeAfterInstall } from "./setupService";
import type { InstallLogSink, InstallSource } from "./types";
import type { InstallProgressUpdate } from "./installProgress";
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
  onProgress?: (update: InstallProgressUpdate) => void;
};

export type RunInstallResult =
  | { ok: true; events: InstallEvent[] }
  | { ok: false; message: string; cancelled?: boolean; failure?: InstallFailure; manualCommand?: string; events?: InstallEvent[] };

export async function runAgentInstall(params: RunInstallParams): Promise<RunInstallResult> {
  const { source, localPath, seedPersona, agentName, log, requestSudo, isAborted, onStreamId, onProgress } =
    params;
  const reportProgress = (update: InstallProgressUpdate) => {
    if (!isAborted()) onProgress?.(update);
  };
  const events: InstallEvent[] = [];
  const emit = (event: InstallEvent) => {
    events.push(event);
    pushInstallEvent(event);
  };
  const append = (line: string) => {
    if (!isAborted()) log([line]);
  };

  reportProgress(INSTALL_PROGRESS.preflight);
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

  reportProgress(INSTALL_PROGRESS.apt);
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

  const runStreamedStep = async (
    phase: "core" | "browser",
    run: (onStream: (event: StreamEvent) => void) => Promise<Awaited<ReturnType<typeof systemAPI.installHermesCore>>>,
  ) => {
    const stream = createInstallStreamHandler({
      phase,
      onLines: (lines) => {
        if (!isAborted()) log(lines);
      },
      onProgress: reportProgress,
    });
    try {
      return await run(stream.parse);
    } finally {
      stream.flush();
      stream.dispose();
    }
  };

  emit({
    ts: new Date().toISOString(),
    phase: "installer",
    step: "run-hermes-installer",
    status: "info",
    message: source === "bundled" ? "Running official installer (core, then browser)" : "Running local-folder install",
  });

  let coreResult: Awaited<ReturnType<typeof systemAPI.installHermesCore>>;
  let browserResult: Awaited<ReturnType<typeof systemAPI.installHermesBrowser>> | undefined;

  if (source === "bundled") {
    reportProgress(INSTALL_PROGRESS.coreStart);
    append("Phase 1/2: Installing Hermes core (Python, CLI, config)…");
    coreResult = await runStreamedStep("core", (onStream) => systemAPI.installHermesCore(onStream, onStreamId));
    if (isAborted()) return { ok: false, message: "Cancelled", cancelled: true };

    if (!coreResult.success) {
      const probe = await systemAPI.inspectHermesInstall().catch(() => null);
      if (probe && hasUsableHermesInstall(probe)) {
        append("⚠ Core installer reported an error, but ~/.hermes looks usable — continuing with browser tools.");
      } else {
        const lines = [`✗ Core install failed (exit ${coreResult.code ?? "?"})`, ...summarizeCommandFailureOutput(coreResult)];
        log(lines.length > 1 ? lines : [`✗ Core install failed`, tailCommandOutput(coreResult, 20)]);
        const message = "Hermes core install exited with an error.";
        const failureOutput = [coreResult.stderr, coreResult.stdout].filter(Boolean).join("\n");
        emit({
          ts: new Date().toISOString(),
          phase: "installer",
          step: "run-hermes-installer",
          status: "error",
          message: `${message} Exit ${coreResult.code ?? "?"}`,
        });
        return { ok: false, message, failure: classifyInstallFailure(message, undefined, failureOutput), events };
      }
    }
    reportProgress(INSTALL_PROGRESS.coreDone);
    append("✓ Core install finished.");

    reportProgress(INSTALL_PROGRESS.browserStart);
    append("Phase 2/2: Installing browser tools (npm + Playwright — often 10–25 min)…");
    browserResult = await runStreamedStep("browser", (onStream) => systemAPI.installHermesBrowser(onStream, onStreamId));
    if (isAborted()) return { ok: false, message: "Cancelled", cancelled: true };
    if (!browserResult.success) {
      append("⚠ Browser tools install did not complete. Chat and most tools still work; retry from Diagnostics later.");
      reportProgress(INSTALL_PROGRESS.browserSkipped);
    } else {
      reportProgress(INSTALL_PROGRESS.browserDone);
      append("✓ Browser tools install finished.");
    }
  } else {
    reportProgress(INSTALL_PROGRESS.coreStart);
    coreResult = await runStreamedStep("core", (onStream) =>
      runHermesInstaller(source, localPath, onStream, onStreamId),
    );
    if (isAborted()) return { ok: false, message: "Cancelled", cancelled: true };
    if (!coreResult.success) {
      const lines = [`✗ Installation failed (exit ${coreResult.code ?? "?"})`, ...summarizeCommandFailureOutput(coreResult)];
      log(lines.length > 1 ? lines : [`✗ Installation failed`, tailCommandOutput(coreResult, 20)]);
      const message = "Hermes installer exited with an error.";
      const failureOutput = [coreResult.stderr, coreResult.stdout].filter(Boolean).join("\n");
      emit({
        ts: new Date().toISOString(),
        phase: "installer",
        step: "run-hermes-installer",
        status: "error",
        message: `${message} Exit ${coreResult.code ?? "?"}`,
      });
      return { ok: false, message, failure: classifyInstallFailure(message, undefined, failureOutput), events };
    }
    reportProgress(INSTALL_PROGRESS.coreDone);
  }

  const verified = await systemAPI.verifyHermesInstall({ core: coreResult, browser: browserResult });
  if (!verified.success) {
    const message = "Install finished but Ronbot could not verify a usable Hermes CLI under ~/.hermes.";
    emit({
      ts: new Date().toISOString(),
      phase: "installer",
      step: "verify-install",
      status: "error",
      message,
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
  reportProgress(INSTALL_PROGRESS.finalizeStart);
  const finalized = await finalizeAfterInstall({
    seedPersona,
    agentName,
    source,
    log,
    onProgress: reportProgress,
  });
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
