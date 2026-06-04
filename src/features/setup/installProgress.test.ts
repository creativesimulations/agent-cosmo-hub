import { describe, expect, it } from "vitest";
import {
  initialInstallProgressState,
  stripAnsi,
  updateInstallProgressFromLine,
} from "./installProgress";

describe("installProgress", () => {
  it("strips ANSI and advances on installer milestones (core phase)", () => {
    let state = initialInstallProgressState("core");
    state = updateInstallProgressFromLine(
      "\x1b[0;32m✓\x1b[0m All dependencies installed",
      state,
      "core",
    );
    expect(state.percent).toBeGreaterThanOrEqual(50);
    expect(state.label).toContain("Python");
  });

  it("advances browser phase on npm milestones", () => {
    let state = initialInstallProgressState("browser");
    state = updateInstallProgressFromLine(
      "Installing Node.js dependencies (browser tools)...",
      state,
      "browser",
    );
    expect(state.percent).toBeGreaterThanOrEqual(74);
    expect(state.label.toLowerCase()).toContain("browser");
  });

  it("stripAnsi removes color codes", () => {
    expect(stripAnsi("\x1b[0;36m→\x1b[0m Checking Git...")).toBe("→ Checking Git...");
  });
});
