import { describe, expect, it } from "vitest";
import {
  buildHermesBrowserInstallScript,
  buildHermesCoreInstallScript,
  buildOfficialHermesInstallScript,
  HERMES_CORE_INSTALL_STAGES,
} from "./hermes/installScripts";
import { buildInstallerRunScript } from "./hermes/constants";

describe("Hermes official bundled installer", () => {
  it("core install runs staged official script without browser deps", () => {
    const script = buildHermesCoreInstallScript();
    expect(script).toContain("curl -fsSL");
    expect(script).toContain("--skip-setup");
    expect(script).toContain("--non-interactive");
    expect(script).toContain('--stage "python-deps"');
    expect(script).not.toContain("node-deps");
    for (const stage of HERMES_CORE_INSTALL_STAGES) {
      expect(script).toContain(`stage: ${stage}`);
    }
  });

  it("browser install runs official node-deps stage only", () => {
    const script = buildHermesBrowserInstallScript();
    expect(script).toContain("--stage node-deps");
    expect(script).toContain("--skip-setup");
  });

  it("legacy monolithic helper skips browser for quick reinstall", () => {
    const script = buildOfficialHermesInstallScript();
    expect(script).toContain("--skip-browser");
    expect(buildInstallerRunScript()).toBe(script);
  });
});
