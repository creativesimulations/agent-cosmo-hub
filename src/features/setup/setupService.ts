// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { classifyHermesInstallProbe } from "@/lib/systemAPI/hermes/installProbe";
import { systemAPI } from "@/lib/systemAPI";
import { DEFAULT_AGENT_NAME } from "./constants";
import type { InstallProgressUpdate } from "./installProgress";
import { INSTALL_PROGRESS } from "./installProgress";
import type { AgentProbe, InstallLogSink, InstallSource } from "./types";

const HERMES_PROBE_PATH = "~/.hermes";
const PROBE_CACHE_MS = 5000;

let probeCache: { probe: AgentProbe; at: number } | null = null;

export function invalidateAgentProbeCache(): void {
  probeCache = null;
}

export async function probeAgent(options?: { useCache?: boolean }): Promise<AgentProbe> {
  const now = Date.now();
  if (options?.useCache && probeCache && now - probeCache.at < PROBE_CACHE_MS) {
    return probeCache.probe;
  }

  try {
    const installState = await systemAPI.inspectHermesInstall();
    const reason = classifyHermesInstallProbe(installState);
    const ready = reason === "ready";

    if (!ready) {
      const probe: AgentProbe = {
        ready: false,
        reason,
        installState,
        probePath: HERMES_PROBE_PATH,
      };
      probeCache = { probe, at: now };
      return probe;
    }

    const [agentName, version] = await Promise.all([
      systemAPI.getAgentName().catch(() => undefined),
      systemAPI.getHermesCliVersionSummary().catch(() => undefined),
    ]);

    const probe: AgentProbe = {
      ready: true,
      reason: "ready",
      installState,
      probePath: HERMES_PROBE_PATH,
      agentName: agentName ?? undefined,
      versionSummary: version?.text,
    };
    probeCache = { probe, at: now };
    return probe;
  } catch {
    const probe: AgentProbe = { ready: false, reason: "probe_error", probePath: HERMES_PROBE_PATH };
    probeCache = { probe, at: now };
    return probe;
  }
}

export type FinalizeOptions = {
  seedPersona: boolean;
  agentName?: string;
  source: InstallSource;
  log: InstallLogSink;
  onProgress?: (update: InstallProgressUpdate) => void;
};

export async function finalizeAfterInstall(
  options: FinalizeOptions,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { seedPersona, agentName = DEFAULT_AGENT_NAME, source, log, onProgress } = options;
  const progress = (update: InstallProgressUpdate) => onProgress?.(update);
  const append = (line: string) => log([line]);

  if (seedPersona) {
    append("Saving Ronbot personality files…");
    try {
      const seed = await systemAPI.seedRonbotPersonalityAfterInstall(agentName.trim() || DEFAULT_AGENT_NAME);
      if (seed.success) {
        const n = seed.filesMoved ?? 0;
        append(
          n > 0
            ? `✓ Updated ${n} persona file(s); backups under ~/.hermes/.ronbot-personality-backup/`
            : "✓ Persona files refreshed (defaults or already customized).",
        );
      } else {
        append(`⚠ Personality seed incomplete: ${seed.error ?? "unknown"}`);
      }
    } catch (e) {
      append(`⚠ Personality seed failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    append(
      source === "bundled"
        ? "ℹ Keeping official Hermes core files unchanged."
        : "ℹ Left existing persona files unchanged.",
    );
    try {
      const saved = await systemAPI.savePersonalityPreset("Official_Hermes");
      append(
        saved.success
          ? "✓ Saved current core files as Official_Hermes preset."
          : `⚠ Could not save Official_Hermes preset: ${saved.error ?? "unknown"}`,
      );
    } catch (e) {
      append(`⚠ Could not save Official_Hermes preset: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  append("Stopping Hermes runtime so the next launch picks up disk state…");
  try {
    await systemAPI.stopHermesAgentRuntime();
    append("✓ Runtime stopped.");
  } catch (e) {
    append(`⚠ Could not stop runtime: ${e instanceof Error ? e.message : String(e)}`);
  }

  const probe = await probeAgent();
  if (!probe.ready) {
    return {
      ok: false,
      message: "Install finished but Ronbot could not verify ~/.hermes and the Hermes CLI.",
    };
  }

  append("Running launcher integrity checks…");
  const launcher = await checkHermesLauncherPath();
  if (launcher.ok === false) {
    return {
      ok: false,
      message: launcher.message,
    };
  }
  append("✓ hermes launcher resolved to a supported path.");

  progress(INSTALL_PROGRESS.finalizeGateway);
  append("Starting Hermes gateway…");
  const gateway = await systemAPI.restartAgent().catch((e) => ({
    success: false,
    error: e instanceof Error ? e.message : String(e),
  }));
  if (!gateway.success) {
    return {
      ok: false,
      message: `Install completed but Hermes gateway could not be started: ${gateway.error ?? "unknown error"}`,
    };
  }
  append("✓ Hermes gateway started.");

  append("Running hermes doctor and startup health checks…");
  const health = await systemAPI.bootstrapStartupHealth().catch(() => null);
  if (!health || !health.success) {
    return {
      ok: false,
      message: "Install completed but startup health checks failed. Open Diagnostics for guided fixes.",
    };
  }
  append("✓ Startup health checks passed.");
  progress(INSTALL_PROGRESS.complete);

  return { ok: true };
}

export function isSupportedHermesLauncherPath(path: string): boolean {
  return (
    path.includes("/.local/bin/hermes") ||
    path.includes("/venv/bin/hermes") ||
    path.includes("/.hermes/bin/hermes") ||
    path.includes("/.hermes/venv/bin/hermes") ||
    path.includes("/usr/local/bin/hermes")
  );
}

async function checkHermesLauncherPath(): Promise<{ ok: true } | { ok: false; message: string }> {
  const platform = await systemAPI.getPlatform();
  const probeCmd = 'command -v hermes || true';
  const result = await systemAPI.runCommand(
    platform.isWindows ? `wsl bash -lc "${probeCmd}"` : `bash -lc "${probeCmd}"`,
    { timeout: 10000 },
  );
  const path = (result.stdout || "").trim().split("\n").pop() || "";
  if (!path) {
    return { ok: false, message: "Install verification failed: `hermes` is not on PATH in the runtime shell." };
  }
  if (!isSupportedHermesLauncherPath(path)) {
    return {
      ok: false,
      message: `Install verification failed: unexpected hermes launcher path (${path}).`,
    };
  }
  return { ok: true };
}
