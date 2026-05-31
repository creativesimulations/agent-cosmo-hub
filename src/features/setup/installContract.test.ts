import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateInstallContract } from "./installContract";

vi.mock("@/lib/systemAPI", () => ({
  systemAPI: {
    getPlatform: vi.fn(),
    checkDesktopBridge: vi.fn(),
    detectOS: vi.fn(),
    getDiskSpace: vi.fn(),
    checkWSL: vi.fn(),
    runCommand: vi.fn(),
    sudo: {
      probe: vi.fn(),
    },
  },
}));

import { systemAPI } from "@/lib/systemAPI";

describe("evaluateInstallContract", () => {
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
    vi.mocked(systemAPI.checkDesktopBridge).mockResolvedValue({
      ok: true,
      reason: "Desktop bridge healthy",
      details: [],
    });
    vi.mocked(systemAPI.detectOS).mockResolvedValue({ name: "Ubuntu 24.04 LTS", version: "24.04" });
    vi.mocked(systemAPI.getDiskSpace).mockResolvedValue({
      success: true,
      freeBytes: 10 * 1024 ** 3,
      totalBytes: 100 * 1024 ** 3,
      drive: "/",
    });
    vi.mocked(systemAPI.checkWSL).mockResolvedValue({ installed: true, version: "WSL 2", distro: "Ubuntu" });
    vi.mocked(systemAPI.sudo.probe).mockResolvedValue({ kind: "passwordless" });
    vi.mocked(systemAPI.runCommand).mockImplementation(async (cmd: string) => {
      if (cmd.includes("command -v git")) {
        return { success: true, stdout: "git version 2.45.1\n", stderr: "", code: 0 };
      }
      if (cmd.includes("command -v curl")) {
        return { success: true, stdout: "curl 8.5.0\n", stderr: "", code: 0 };
      }
      if (cmd.includes("command -v wget")) {
        return { success: false, stdout: "", stderr: "", code: 1 };
      }
      if (cmd.includes("command -v python3")) {
        return { success: true, stdout: "Python 3.12.3\n", stderr: "", code: 0 };
      }
      return { success: true, stdout: "OK:curl\n", stderr: "", code: 0 };
    });
  });

  it("treats WSL runtime as Linux-supported host", async () => {
    const report = await evaluateInstallContract();
    const os = report.checks.find((check) => check.id === "os");
    expect(os?.status).toBe("ok");
    expect(os?.detail).toContain("Ubuntu");
  });

  it("short-circuits non-bridge checks when desktop bridge is down", async () => {
    vi.mocked(systemAPI.checkDesktopBridge).mockResolvedValue({
      ok: false,
      reason: "Electron preload bridge is missing (window.electronAPI unavailable).",
      details: [],
    });

    const report = await evaluateInstallContract();
    const git = report.checks.find((check) => check.id === "git");
    const network = report.checks.find((check) => check.id === "network");

    expect(git?.detail).toContain("desktop bridge");
    expect(network?.detail).toContain("desktop bridge");
    expect(systemAPI.runCommand).not.toHaveBeenCalled();
  });

  it("does not cascade WSL setup failures into guest dependency failures", async () => {
    vi.mocked(systemAPI.getPlatform).mockResolvedValue({
      platform: "win32",
      arch: "x64",
      release: "10.0.19045",
      isWSL: false,
      isWindows: true,
      isMac: false,
      isLinux: false,
      homeDir: "C:\\Users\\test",
      totalMemory: 0,
      freeMemory: 0,
    });
    vi.mocked(systemAPI.detectOS).mockResolvedValue({ name: "Windows", version: "10.0.19045" });
    vi.mocked(systemAPI.checkWSL).mockResolvedValue({ installed: false });

    const report = await evaluateInstallContract();
    const wsl = report.checks.find((check) => check.id === "wsl2");
    const git = report.checks.find((check) => check.id === "git");
    const fetcher = report.checks.find((check) => check.id === "fetcher");

    expect(wsl?.severity).toBe("hard");
    expect(git?.severity).toBe("soft");
    expect(fetcher?.severity).toBe("soft");
    expect(git?.detail).toContain("after WSL2");
  });
});
