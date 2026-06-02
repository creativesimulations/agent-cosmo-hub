import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectInstallAptPackages, installAptPackages, summarizeCommandFailureOutput } from "./installStages";

vi.mock("@/lib/systemAPI", () => ({
  systemAPI: {
    checkFfmpeg: vi.fn(),
    getPlatform: vi.fn(),
    installHermes: vi.fn(),
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

import { systemAPI } from "@/lib/systemAPI";
import { sudoAPI } from "@/lib/systemAPI/sudo";

describe("installStages", () => {
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
  });

  it("leaves bundled dependencies to the official installer", async () => {
    const lines: string[][] = [];

    const packages = await collectInstallAptPackages("bundled", (l) => lines.push(l));

    expect(packages).toEqual([]);
    expect(systemAPI.checkFfmpeg).not.toHaveBeenCalled();
    expect(lines.flat().join("\n")).toContain("official Hermes installer");
  });

  it("cancels apt recovery when the sudo prompt is dismissed", async () => {
    const lines: string[][] = [];
    vi.mocked(sudoAPI.probe).mockResolvedValue({ kind: "needs-password" });

    const result = await installAptPackages(["git"], (l) => lines.push(l), async () => null, () => false);

    expect(result).toEqual({ ok: false, cancelled: true });
    expect(sudoAPI.aptInstall).not.toHaveBeenCalled();
    expect(lines.flat().join("\n")).toContain("Cancelled");
  });

  it("summarizes verification exit 52 with network guidance", () => {
    const lines = summarizeCommandFailureOutput({
      success: false,
      stdout: "download failed\n",
      stderr: "",
      code: 52,
    });

    expect(lines.join("\n")).toContain("verification code 52");
    expect(lines.join("\n")).toContain("raw.githubusercontent.com");
  });
});
