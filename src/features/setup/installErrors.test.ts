import { describe, expect, it } from "vitest";
import { classifyInstallFailure } from "./installErrors";

describe("classifyInstallFailure", () => {
  it("classifies installer build-tool sudo prompt before generic venv text", () => {
    const failure = classifyInstallFailure(
      "Hermes installer exited with an error.",
      undefined,
      [
        "Creating virtual environment at: venv",
        "✓ Virtual environment ready (Python 3.11)",
        "→ Installing dependencies...",
        "→ Some build tools may be needed for Python packages...",
        "→ sudo is needed ONLY to install build tools (build-essential, python3-dev, libffi-dev) via apt.",
        "[process] Command timed out after 600000ms",
      ].join("\n"),
    );

    expect(failure.title).toBe("Build tools need admin access");
    expect(failure.autoInstallId).toBe("build-tools");
    expect(failure.manualCommand).toContain("build-essential python3-dev libffi-dev");
  });
});
