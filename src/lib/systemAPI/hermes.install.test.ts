import { describe, expect, it } from "vitest";
import { buildOfficialHermesInstallScript, buildInstallerRunScript } from "./hermes/constants";

describe("Hermes official bundled installer", () => {
  it("uses curl | bash from GitHub (Hermes v0.13+)", () => {
    const script = buildOfficialHermesInstallScript();
    expect(script).toContain("curl -fsSL");
    expect(script).toContain("| bash");
    expect(buildInstallerRunScript()).toBe(script);
  });
});
