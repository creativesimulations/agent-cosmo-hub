import { describe, expect, it } from "vitest";
import { buildInstallerRunScript } from "./hermes";

describe("hermes installer run script", () => {
  it("uses the exact non-interactive installer command", () => {
    const script = buildInstallerRunScript();
    expect(script).toContain("setsid bash /tmp/hermes-install.sh --skip-setup </dev/null 2>&1");
  });
});

