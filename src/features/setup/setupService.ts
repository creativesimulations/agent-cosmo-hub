// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { classifyHermesInstallProbe } from "@/lib/systemAPI/hermes/installProbe";
import { systemAPI } from "@/lib/systemAPI";
import { DEFAULT_AGENT_NAME } from "./constants";
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
};

export async function finalizeAfterInstall(
  options: FinalizeOptions,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { seedPersona, agentName = DEFAULT_AGENT_NAME, source, log } = options;
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
  } else if (source === "local") {
    append("ℹ Left existing persona files unchanged.");
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
  if (!launcher.ok) {
    return {
      ok: false,
      message: launcher.message,
    };
  }
  append("✓ hermes launcher resolved to a supported path.");

  append("Running hermes doctor and startup health checks…");
  const health = await systemAPI.bootstrapStartupHealth().catch(() => null);
  if (!health || !health.success) {
    return {
      ok: false,
      message: "Install completed but startup health checks failed. Open Diagnostics for guided fixes.",
    };
  }
  append("✓ Startup health checks passed.");

  return { ok: true };
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
  const expectedPath = path.includes("/.local/bin/hermes") || path.includes("/venv/bin/hermes") || path.includes("/usr/local/bin/hermes");
  if (!expectedPath) {
    return {
      ok: false,
      message: `Install verification failed: unexpected hermes launcher path (${path}).`,
    };
  }
  return { ok: true };
}
