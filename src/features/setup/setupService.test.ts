// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { probeAgent, finalizeAfterInstall } from "./setupService";

vi.mock("@/lib/systemAPI", () => ({
  systemAPI: {
    isConfigured: vi.fn(),
    getAgentName: vi.fn(),
    getHermesCliVersionSummary: vi.fn(),
    seedRonbotPersonalityAfterInstall: vi.fn(),
    stopHermesAgentRuntime: vi.fn(),
  },
}));

import { systemAPI } from "@/lib/systemAPI";

describe("probeAgent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns not ready when isConfigured is false", async () => {
    vi.mocked(systemAPI.isConfigured).mockResolvedValue(false);
    const result = await probeAgent();
    expect(result.ready).toBe(false);
    expect(result.reason).toBe("no_cli");
  });

  it("returns ready with name when configured", async () => {
    vi.mocked(systemAPI.isConfigured).mockResolvedValue(true);
    vi.mocked(systemAPI.getAgentName).mockResolvedValue("TestBot");
    vi.mocked(systemAPI.getHermesCliVersionSummary).mockResolvedValue({ text: "0.13.0", looksLikeV013: true });
    const result = await probeAgent();
    expect(result.ready).toBe(true);
    expect(result.agentName).toBe("TestBot");
  });
});

describe("finalizeAfterInstall", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fails when probe after install is not ready", async () => {
    vi.mocked(systemAPI.seedRonbotPersonalityAfterInstall).mockResolvedValue({ success: true });
    vi.mocked(systemAPI.stopHermesAgentRuntime).mockResolvedValue(undefined);
    vi.mocked(systemAPI.isConfigured).mockResolvedValue(false);

    const lines: string[][] = [];
    const result = await finalizeAfterInstall({
      seedPersona: true,
      source: "bundled",
      log: (l) => lines.push(l),
    });

    expect(result.ok).toBe(false);
  });
});
