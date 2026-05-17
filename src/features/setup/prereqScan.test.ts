import { describe, expect, it, vi, beforeEach } from "vitest";
import { runPrereqScan } from "./prereqScan";
import type { AgentProbe } from "./types";

vi.mock("@/lib/systemAPI", () => ({
  systemAPI: {
    detectOS: vi.fn(),
    getPlatform: vi.fn(),
    checkWSL: vi.fn(),
    checkPython: vi.fn(),
    checkGit: vi.fn(),
    checkRipgrep: vi.fn(),
    checkCurl: vi.fn(),
  },
}));

vi.mock("./setupService", () => ({
  probeAgent: vi.fn(),
}));

import { systemAPI } from "@/lib/systemAPI";
import { probeAgent } from "./setupService";

const emptyProbe = (partial: Partial<AgentProbe>): AgentProbe => ({
  ready: false,
  probePath: "~/.hermes",
  ...partial,
});

describe("runPrereqScan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    vi.mocked(systemAPI.detectOS).mockResolvedValue({ name: "Linux" });
    vi.mocked(systemAPI.checkPython).mockResolvedValue({ installed: true, version: "3.12" });
    vi.mocked(systemAPI.checkGit).mockResolvedValue({ installed: true, version: "2.43" });
    vi.mocked(systemAPI.checkRipgrep).mockResolvedValue({ installed: true, version: "14" });
    vi.mocked(systemAPI.checkCurl).mockResolvedValue({ installed: true, version: "8" });
  });

  it("sets agentReady only when probe reason is ready", async () => {
    vi.mocked(probeAgent).mockResolvedValue(
      emptyProbe({
        ready: true,
        reason: "ready",
        versionSummary: "0.13.0",
        installState: {
          hasDir: true,
          hasEnv: true,
          hasConfig: true,
          hasVenvCli: true,
          hasPathCli: false,
          hasCliRuns: true,
          hasModelLine: false,
        },
      }),
    );

    const result = await runPrereqScan();
    expect(result.agentReady).toBe(true);
    expect(result.cliOnly).toBe(false);
    expect(result.items).toHaveLength(0);
  });

  it("shows cliOnly banner path without agentReady", async () => {
    vi.mocked(probeAgent).mockResolvedValue(
      emptyProbe({
        reason: "cli_only",
        installState: {
          hasDir: false,
          hasEnv: false,
          hasConfig: false,
          hasVenvCli: false,
          hasPathCli: true,
          hasCliRuns: true,
          hasModelLine: false,
        },
      }),
    );

    const result = await runPrereqScan();
    expect(result.agentReady).toBe(false);
    expect(result.cliOnly).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("reuses cached probe when provided", async () => {
    const cached = emptyProbe({ reason: "no_dir" });
    const result = await runPrereqScan({ cachedProbe: cached });
    expect(probeAgent).not.toHaveBeenCalled();
    expect(result.probe).toBe(cached);
    expect(result.agentReady).toBe(false);
  });
});
