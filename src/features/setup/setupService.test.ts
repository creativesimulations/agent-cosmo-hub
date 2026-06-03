// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  finalizeAfterInstall,
  invalidateAgentProbeCache,
  isSupportedHermesLauncherPath,
  probeAgent,
} from "./setupService";

vi.mock("@/lib/systemAPI", () => ({
  systemAPI: {
    inspectHermesInstall: vi.fn(),
    getAgentName: vi.fn(),
    getHermesCliVersionSummary: vi.fn(),
    seedRonbotPersonalityAfterInstall: vi.fn(),
    savePersonalityPreset: vi.fn(),
    stopHermesAgentRuntime: vi.fn(),
    restartAgent: vi.fn(),
    getPlatform: vi.fn(),
    runCommand: vi.fn(),
    bootstrapStartupHealth: vi.fn(),
  },
}));

import { systemAPI } from "@/lib/systemAPI";

const readyState = {
  hasDir: true,
  hasEnv: true,
  hasConfig: true,
  hasVenvCli: true,
  hasPathCli: false,
  hasCliRuns: true,
  hasModelLine: false,
};

describe("probeAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateAgentProbeCache();
    vi.mocked(systemAPI.getPlatform).mockResolvedValue({
      platform: "linux",
      arch: "x64",
      release: "",
      isWSL: true,
      isWindows: false,
      isMac: false,
      isLinux: true,
      homeDir: "/home/test",
      totalMemory: 0,
      freeMemory: 0,
    });
    vi.mocked(systemAPI.runCommand).mockResolvedValue({
      success: true,
      stdout: "/home/test/.local/bin/hermes\n",
      stderr: "",
      code: 0,
    });
    vi.mocked(systemAPI.restartAgent).mockResolvedValue({ success: true });
    vi.mocked(systemAPI.savePersonalityPreset).mockResolvedValue({ success: true });
    vi.mocked(systemAPI.bootstrapStartupHealth).mockResolvedValue({
      success: true,
      steps: [],
      issues: [],
    });
  });

  it("returns not ready when workspace missing", async () => {
    vi.mocked(systemAPI.inspectHermesInstall).mockResolvedValue({
      hasDir: false,
      hasEnv: false,
      hasConfig: false,
      hasVenvCli: false,
      hasPathCli: false,
      hasCliRuns: false,
      hasModelLine: false,
    });
    const result = await probeAgent();
    expect(result.ready).toBe(false);
    expect(result.reason).toBe("no_dir");
  });

  it("returns cli_only when PATH CLI without ~/.hermes", async () => {
    vi.mocked(systemAPI.inspectHermesInstall).mockResolvedValue({
      hasDir: false,
      hasEnv: false,
      hasConfig: false,
      hasVenvCli: false,
      hasPathCli: true,
      hasCliRuns: true,
      hasModelLine: false,
    });
    const result = await probeAgent();
    expect(result.ready).toBe(false);
    expect(result.reason).toBe("cli_only");
  });

  it("returns ready with name when fully configured", async () => {
    vi.mocked(systemAPI.inspectHermesInstall).mockResolvedValue(readyState);
    vi.mocked(systemAPI.getAgentName).mockResolvedValue("TestBot");
    vi.mocked(systemAPI.getHermesCliVersionSummary).mockResolvedValue({
      ok: true,
      text: "0.13.0",
      looksLikeV013: true,
    });
    const result = await probeAgent();
    expect(result.ready).toBe(true);
    expect(result.reason).toBe("ready");
    expect(result.agentName).toBe("TestBot");
  });
});

describe("finalizeAfterInstall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateAgentProbeCache();
  });

  it("fails when probe after install is not ready", async () => {
    vi.mocked(systemAPI.seedRonbotPersonalityAfterInstall).mockResolvedValue({ success: true });
    vi.mocked(systemAPI.stopHermesAgentRuntime).mockResolvedValue({ success: true });
    vi.mocked(systemAPI.inspectHermesInstall).mockResolvedValue({
      hasDir: false,
      hasEnv: false,
      hasConfig: false,
      hasVenvCli: false,
      hasPathCli: false,
      hasCliRuns: false,
      hasModelLine: false,
    });

    const lines: string[][] = [];
    const result = await finalizeAfterInstall({
      seedPersona: true,
      source: "bundled",
      log: (l) => lines.push(l),
    });

    expect(result.ok).toBe(false);
  });

  it("passes after seed, runtime stop, launcher check, gateway start, and startup health succeed", async () => {
    vi.mocked(systemAPI.seedRonbotPersonalityAfterInstall).mockResolvedValue({ success: true, filesMoved: 1 });
    vi.mocked(systemAPI.stopHermesAgentRuntime).mockResolvedValue({ success: true });
    vi.mocked(systemAPI.inspectHermesInstall).mockResolvedValue(readyState);
    vi.mocked(systemAPI.getAgentName).mockResolvedValue("TestBot");
    vi.mocked(systemAPI.getHermesCliVersionSummary).mockResolvedValue({
      ok: true,
      text: "hermes 0.13.0",
      looksLikeV013: true,
    });

    const lines: string[][] = [];
    const result = await finalizeAfterInstall({
      seedPersona: true,
      source: "bundled",
      log: (l) => lines.push(l),
    });

    expect(result.ok).toBe(true);
    expect(systemAPI.restartAgent).toHaveBeenCalled();
    expect(systemAPI.bootstrapStartupHealth).toHaveBeenCalled();
    expect(lines.flat().join("\n")).toContain("Hermes gateway started");
    expect(lines.flat().join("\n")).toContain("Startup health checks passed");
  });

  it("fails when the launcher resolves outside supported Hermes paths", async () => {
    vi.mocked(systemAPI.inspectHermesInstall).mockResolvedValue(readyState);
    vi.mocked(systemAPI.getAgentName).mockResolvedValue("TestBot");
    vi.mocked(systemAPI.getHermesCliVersionSummary).mockResolvedValue({
      ok: true,
      text: "hermes 0.13.0",
      looksLikeV013: true,
    });
    vi.mocked(systemAPI.runCommand).mockResolvedValue({
      success: true,
      stdout: "/tmp/hermes\n",
      stderr: "",
      code: 0,
    });

    const result = await finalizeAfterInstall({
      seedPersona: false,
      source: "bundled",
      log: vi.fn(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("unexpected hermes launcher path");
  });

  it("fails clearly when gateway startup fails after install", async () => {
    vi.mocked(systemAPI.inspectHermesInstall).mockResolvedValue(readyState);
    vi.mocked(systemAPI.getAgentName).mockResolvedValue("TestBot");
    vi.mocked(systemAPI.getHermesCliVersionSummary).mockResolvedValue({
      ok: true,
      text: "hermes 0.13.0",
      looksLikeV013: true,
    });
    vi.mocked(systemAPI.runCommand).mockResolvedValue({
      success: true,
      stdout: "/home/test/.local/bin/hermes\n",
      stderr: "",
      code: 0,
    });
    vi.mocked(systemAPI.restartAgent).mockResolvedValue({
      success: false,
      error: "gateway restart failed",
    });

    const result = await finalizeAfterInstall({
      seedPersona: false,
      source: "bundled",
      log: vi.fn(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("gateway could not be started");
    expect(systemAPI.bootstrapStartupHealth).not.toHaveBeenCalled();
  });
});

describe("isSupportedHermesLauncherPath", () => {
  it("accepts known Hermes launcher locations and rejects unrelated binaries", () => {
    expect(isSupportedHermesLauncherPath("/home/test/.local/bin/hermes")).toBe(true);
    expect(isSupportedHermesLauncherPath("/home/test/.hermes/bin/hermes")).toBe(true);
    expect(isSupportedHermesLauncherPath("/tmp/hermes")).toBe(false);
  });
});
