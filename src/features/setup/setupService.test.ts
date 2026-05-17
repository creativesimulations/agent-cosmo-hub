// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { finalizeAfterInstall, invalidateAgentProbeCache, probeAgent } from "./setupService";

vi.mock("@/lib/systemAPI", () => ({
  systemAPI: {
    inspectHermesInstall: vi.fn(),
    getAgentName: vi.fn(),
    getHermesCliVersionSummary: vi.fn(),
    seedRonbotPersonalityAfterInstall: vi.fn(),
    stopHermesAgentRuntime: vi.fn(),
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
    vi.mocked(systemAPI.stopHermesAgentRuntime).mockResolvedValue(undefined);
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
});
