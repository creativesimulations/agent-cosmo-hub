import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAgentInstall } from "./runAgentInstall";
import type { InstallContractReport } from "./installContract";

vi.mock("@/lib/systemAPI", () => ({
  systemAPI: {
    checkDesktopBridge: vi.fn(),
    checkFfmpeg: vi.fn(),
    getPlatform: vi.fn(),
    installHermes: vi.fn(),
    installHermesCore: vi.fn(),
    installHermesBrowser: vi.fn(),
    verifyHermesInstall: vi.fn(),
    inspectHermesInstall: vi.fn(),
    installHermesFromLocalFolder: vi.fn(),
  },
}));

vi.mock("@/lib/systemAPI/sudo", () => ({
  sudoAPI: {
    probe: vi.fn(),
    aptInstall: vi.fn(),
  },
  promptForPasswordMac: vi.fn(),
}));

vi.mock("./installContract", () => ({
  evaluateInstallContract: vi.fn(),
}));

vi.mock("./setupService", () => ({
  finalizeAfterInstall: vi.fn(),
}));

vi.mock("./installTelemetry", () => ({
  pushInstallEvent: vi.fn(),
}));

import { systemAPI } from "@/lib/systemAPI";
import { evaluateInstallContract } from "./installContract";
import { finalizeAfterInstall } from "./setupService";

const passingContract = (): InstallContractReport => ({
  hasHardBlockers: false,
  checks: [
    { id: "desktop-bridge", label: "Desktop bridge", status: "ok", severity: "hard", domain: "host", detail: "ok" },
    { id: "git", label: "Git", status: "ok", severity: "hard", domain: "guest", detail: "git found" },
  ],
});

const baseParams = (log: string[][]) => ({
  source: "bundled" as const,
  seedPersona: false,
  agentName: "Ronbot",
  log: (lines: string[]) => log.push(lines),
  requestSudo: vi.fn(async () => ""),
  isAborted: () => false,
});

describe("runAgentInstall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(systemAPI.checkDesktopBridge).mockResolvedValue({
      ok: true,
      reason: "Desktop bridge healthy",
      details: [],
    });
    vi.mocked(evaluateInstallContract).mockResolvedValue(passingContract());
    vi.mocked(finalizeAfterInstall).mockResolvedValue({ ok: true });
    vi.mocked(systemAPI.installHermesCore).mockImplementation(async (onOutput, onStreamId) => {
      onStreamId?.("install-stream");
      onOutput?.({ type: "stdout", data: "[ronbot-install] core install stages finished\n" });
      return { success: true, stdout: "core\n", stderr: "", code: 0 };
    });
    vi.mocked(systemAPI.installHermesBrowser).mockImplementation(async (onOutput) => {
      onOutput?.({ type: "stdout", data: "Node.js dependencies installed\n" });
      return { success: true, stdout: "browser\n", stderr: "", code: 0 };
    });
    vi.mocked(systemAPI.verifyHermesInstall).mockResolvedValue({
      success: true,
      stdout: "verified\n",
      stderr: "",
      code: 0,
    });
    vi.mocked(systemAPI.inspectHermesInstall).mockResolvedValue({
      hasDir: true,
      hasEnv: false,
      hasConfig: true,
      hasVenvCli: true,
      hasPathCli: false,
      hasCliRuns: true,
      hasModelLine: false,
    });
  });

  it("runs the official installer and finalizes a successful install", async () => {
    const log: string[][] = [];

    const result = await runAgentInstall({ ...baseParams(log), seedPersona: true });

    expect(result.ok).toBe(true);
    expect(systemAPI.installHermesCore).toHaveBeenCalled();
    expect(systemAPI.installHermesBrowser).toHaveBeenCalled();
    expect(systemAPI.verifyHermesInstall).toHaveBeenCalled();
    expect(finalizeAfterInstall).toHaveBeenCalledWith(
      expect.objectContaining({
        seedPersona: true,
        agentName: "Ronbot",
        source: "bundled",
        log: expect.any(Function),
        onProgress: expect.any(Function),
      }),
    );
    expect(log.flat().join("\n")).toContain("Agent installed");
  });

  it("stops before the installer when a hard contract check fails", async () => {
    const log: string[][] = [];
    vi.mocked(evaluateInstallContract).mockResolvedValue({
      hasHardBlockers: true,
      checks: [
        {
          id: "git",
          label: "Git",
          status: "fixable_auto",
          severity: "hard",
          domain: "guest",
          detail: "Git missing in install shell.",
          manualCommand: "sudo apt-get install -y git",
        },
      ],
    });

    const result = await runAgentInstall(baseParams(log));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.manualCommand).toBe("sudo apt-get install -y git");
      expect(result.failure?.code).toBe("git_missing");
    }
    expect(systemAPI.installHermesCore).not.toHaveBeenCalled();
  });

  it("classifies installer stderr into a friendly recovery failure", async () => {
    const log: string[][] = [];
    vi.mocked(systemAPI.inspectHermesInstall).mockResolvedValue({
      hasDir: false,
      hasEnv: false,
      hasConfig: false,
      hasVenvCli: false,
      hasPathCli: false,
      hasCliRuns: false,
      hasModelLine: false,
    });
    vi.mocked(systemAPI.installHermesCore).mockResolvedValue({
      success: false,
      stdout: "",
      stderr: "python3-venv is not installed\n",
      code: 1,
    });

    const result = await runAgentInstall(baseParams(log));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure?.code).toBe("privilege");
      expect(result.failure?.autoInstallId).toBe("python3-venv");
    }
    expect(log.flat().join("\n")).toContain("Core install failed");
    expect(finalizeAfterInstall).not.toHaveBeenCalled();
  });
});
