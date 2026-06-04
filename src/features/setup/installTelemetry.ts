// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { agentLogs } from "@/lib/diagnostics";
import { systemAPI } from "@/lib/systemAPI";

export type InstallEventStatus = "ok" | "error" | "info";

export type InstallEvent = {
  ts: string;
  phase: "preflight" | "dependencies" | "installer" | "verify" | "finalize";
  step: string;
  status: InstallEventStatus;
  message: string;
  errorCode?: string;
};

export function pushInstallEvent(event: InstallEvent): void {
  agentLogs.push({
    source: "install",
    level: event.status === "error" ? "error" : event.status === "ok" ? "info" : "debug",
    summary: `[${event.phase}] ${event.step}: ${event.message}`,
    detail: event.errorCode ? `error_code=${event.errorCode}` : undefined,
  });
}

export async function persistInstallReport(params: {
  events: InstallEvent[];
  logLines: string[];
  result: "ok" | "error" | "partial";
  errorCode?: string;
}): Promise<void> {
  const { events, logLines, result, errorCode } = params;
  const platform = await systemAPI.getPlatform();
  const file = `${platform.homeDir}/.ronbot/install-report-latest.json`;
  const payload = {
    generatedAt: new Date().toISOString(),
    platform: {
      os: platform.platform,
      arch: platform.arch,
      release: platform.release,
      isWindows: platform.isWindows,
      isLinux: platform.isLinux,
      isMac: platform.isMac,
      isWSL: platform.isWSL,
    },
    result,
    errorCode: errorCode ?? null,
    events,
    tailLog: logLines.slice(-120),
  };
  await systemAPI.mkdir(`${platform.homeDir}/.ronbot`).catch(() => undefined);
  await systemAPI.writeFile(file, JSON.stringify(payload, null, 2));
}
