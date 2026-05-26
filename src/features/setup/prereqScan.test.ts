import { describe, expect, it, vi, beforeEach } from "vitest";
import { runPrereqScan } from "./prereqScan";
import type { AgentProbe } from "./types";
import type { InstallContractCheck } from "./installContract";

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

vi.mock("./installContract", () => ({
  evaluateInstallContract: vi.fn(),
}));

vi.mock("@/lib/systemAPI/sudo", () => ({
  sudoAPI: {
    probe: vi.fn(),
    aptInstall: vi.fn(),
  },
}));

import { systemAPI } from "@/lib/systemAPI";
import { probeAgent } from "./setupService";
import { evaluateInstallContract } from "./installContract";

const baseChecks = (): InstallContractCheck[] => [
  { id: "desktop-bridge", label: "Desktop bridge", status: "ok", severity: "hard", domain: "host", detail: "ok" },
  { id: "os", label: "Operating system", status: "ok", severity: "hard", domain: "host", detail: "Linux" },
  { id: "arch", label: "CPU architecture", status: "ok", severity: "hard", domain: "host", detail: "x64" },
  { id: "git", label: "Git", status: "ok", severity: "hard", domain: "guest", detail: "git" },
  { id: "fetcher", label: "Fetcher", status: "ok", severity: "hard", domain: "guest", detail: "curl" },
  { id: "network", label: "Network", status: "ok", severity: "hard", domain: "guest", detail: "ok" },
  { id: "disk", label: "Disk", status: "ok", severity: "hard", domain: "host", detail: "ok" },
  { id: "python-discoverability", label: "Python", status: "ok", severity: "soft", domain: "guest", detail: "ok" },
  { id: "sudo", label: "Sudo", status: "ok", severity: "soft", domain: "guest", detail: "ok" },
];

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
    vi.mocked(evaluateInstallContract).mockResolvedValue({
      checks: baseChecks(),
      hasHardBlockers: false,
    });
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

  it("does not flag optional tools as missing when desktop bridge is unavailable", async () => {
    vi.mocked(probeAgent).mockResolvedValue(emptyProbe({ reason: "no_dir" }));
    vi.mocked(evaluateInstallContract).mockResolvedValue({
      checks: [
        ...baseChecks().map((check) =>
          check.id === "desktop-bridge"
            ? ({
                ...check,
                status: "blocked_unsupported" as const,
                detail: "Electron preload bridge is missing (window.electronAPI unavailable).",
              })
            : check,
        ),
      ],
      hasHardBlockers: true,
    });

    const result = await runPrereqScan();
    const rg = result.items.find((item) => item.id === "ripgrep");
    const curl = result.items.find((item) => item.id === "curl");

    expect(rg?.status).toBe("pending");
    expect(curl?.status).toBe("pending");
    expect(systemAPI.checkRipgrep).not.toHaveBeenCalled();
    expect(systemAPI.checkCurl).not.toHaveBeenCalled();
  });
});
