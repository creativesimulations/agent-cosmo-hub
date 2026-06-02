import { describe, expect, it } from "vitest";
import { buildOfficialHermesInstallScript, buildInstallerRunScript } from "./hermes/constants";

describe("Hermes official bundled installer", () => {
  it("uses the official GitHub installer and skips the interactive setup wizard", () => {
    const script = buildOfficialHermesInstallScript();
    expect(script).toContain("curl -fsSL");
    expect(script).toContain("| bash -s -- --skip-setup");
    expect(buildInstallerRunScript()).toBe(script);
  });
});
