import { describe, expect, it } from "vitest";
import {
  hasUsableHermesInstall,
  parseKeyValueProbeLines,
  probeRecordToState,
} from "./installProbe";

describe("installProbe", () => {
  it("parseKeyValueProbeLines reads HAS_* lines", () => {
    const p = parseKeyValueProbeLines("HAS_DIR=1\nHAS_CLI_RUNS=0\n");
    expect(p.HAS_DIR).toBe("1");
    expect(p.HAS_CLI_RUNS).toBe("0");
  });

  it("rejects dir-only partial install", () => {
    const s = probeRecordToState({
      HAS_DIR: "1",
      HAS_ENV: "0",
      HAS_CONFIG: "0",
      HAS_VENV_CLI: "0",
      HAS_PATH_CLI: "0",
      HAS_CLI_RUNS: "0",
      HAS_MODEL: "0",
    });
    expect(hasUsableHermesInstall(s)).toBe(false);
  });

  it("accepts canonical venv when CLI runs", () => {
    const s = probeRecordToState({
      HAS_DIR: "1",
      HAS_ENV: "1",
      HAS_CONFIG: "1",
      HAS_VENV_CLI: "1",
      HAS_PATH_CLI: "0",
      HAS_CLI_RUNS: "1",
      HAS_MODEL: "0",
    });
    expect(hasUsableHermesInstall(s)).toBe(true);
  });

  it("rejects venv binary present but CLI does not run", () => {
    const s = probeRecordToState({
      HAS_DIR: "1",
      HAS_CONFIG: "1",
      HAS_VENV_CLI: "1",
      HAS_PATH_CLI: "0",
      HAS_CLI_RUNS: "0",
      HAS_MODEL: "1",
    });
    expect(hasUsableHermesInstall(s)).toBe(false);
  });

  it("accepts PATH+config when CLI runs and model line present", () => {
    const s = probeRecordToState({
      HAS_DIR: "1",
      HAS_CONFIG: "1",
      HAS_VENV_CLI: "0",
      HAS_PATH_CLI: "1",
      HAS_CLI_RUNS: "1",
      HAS_MODEL: "1",
    });
    expect(hasUsableHermesInstall(s)).toBe(true);
  });

  it("rejects PATH+config without model line", () => {
    const s = probeRecordToState({
      HAS_DIR: "1",
      HAS_CONFIG: "1",
      HAS_VENV_CLI: "0",
      HAS_PATH_CLI: "1",
      HAS_CLI_RUNS: "1",
      HAS_MODEL: "0",
    });
    expect(hasUsableHermesInstall(s)).toBe(false);
  });
});
