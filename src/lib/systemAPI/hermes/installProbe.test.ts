import { describe, expect, it } from "vitest";
import {
  classifyHermesInstallProbe,
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
    expect(classifyHermesInstallProbe(s)).toBe("no_cli");
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
    expect(classifyHermesInstallProbe(s)).toBe("ready");
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
    expect(classifyHermesInstallProbe(s)).toBe("no_cli");
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
    expect(classifyHermesInstallProbe(s)).toBe("ready");
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
    expect(classifyHermesInstallProbe(s)).toBe("no_model");
  });

  it("classifies CLI on PATH without workspace", () => {
    const s = probeRecordToState({
      HAS_DIR: "0",
      HAS_CONFIG: "0",
      HAS_VENV_CLI: "0",
      HAS_PATH_CLI: "1",
      HAS_CLI_RUNS: "1",
      HAS_MODEL: "0",
    });
    expect(classifyHermesInstallProbe(s)).toBe("cli_only");
    expect(hasUsableHermesInstall(s)).toBe(false);
  });

  it("classifies missing dir and CLI", () => {
    const s = probeRecordToState({
      HAS_DIR: "0",
      HAS_PATH_CLI: "0",
      HAS_CLI_RUNS: "0",
    });
    expect(classifyHermesInstallProbe(s)).toBe("no_dir");
  });
});
