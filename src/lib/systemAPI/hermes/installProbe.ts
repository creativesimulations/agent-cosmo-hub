// Hermes v0.13.0 sync — May 2026 (Ronbot)
/**
 * Pure parsing + rules for `inspectHermesInstall` shell probe output.
 * Kept separate so vitest can cover edge cases without Electron IPC.
 */

export type HermesInstallProbe = {
  hasDir: boolean;
  hasEnv: boolean;
  hasConfig: boolean;
  hasVenvCli: boolean;
  hasPathCli: boolean;
  /** Hermes CLI actually runs (venv or PATH) and prints version text. */
  hasCliRuns: boolean;
  /** config.yaml contains a top-level model: line (PATH+config layout). */
  hasModelLine: boolean;
};

export function parseKeyValueProbeLines(stdout: string): Record<string, string> {
  return stdout.split("\n").reduce<Record<string, string>>((acc, line) => {
    const trimmed = line.trim();
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) return acc;
    acc[trimmed.slice(0, eqIndex)] = trimmed.slice(eqIndex + 1);
    return acc;
  }, {});
}

export function probeRecordToState(parsed: Record<string, string>): HermesInstallProbe {
  return {
    hasDir: parsed.HAS_DIR === "1",
    hasEnv: parsed.HAS_ENV === "1",
    hasConfig: parsed.HAS_CONFIG === "1",
    hasVenvCli: parsed.HAS_VENV_CLI === "1",
    hasPathCli: parsed.HAS_PATH_CLI === "1",
    hasCliRuns: parsed.HAS_CLI_RUNS === "1",
    hasModelLine: parsed.HAS_MODEL === "1",
  };
}

/** Same contract as the historical `hasUsableHermesInstall` in hermes.ts, with runtime CLI + model checks. */
export function hasUsableHermesInstall(state: HermesInstallProbe): boolean {
  if (!state.hasDir) return false;
  if (!state.hasCliRuns) return false;
  if (state.hasVenvCli) return true;
  return state.hasPathCli && state.hasConfig && state.hasModelLine;
}

export type HermesInstallProbeReason =
  | "ready"
  | "no_dir"
  | "cli_only"
  | "no_cli"
  | "no_model"
  | "partial";

/** Classify probe for setup UI — only `ready` means connectable Ronbot agent. */
export function classifyHermesInstallProbe(state: HermesInstallProbe): HermesInstallProbeReason {
  if (hasUsableHermesInstall(state)) return "ready";
  if (!state.hasDir) {
    if (state.hasPathCli || state.hasCliRuns) return "cli_only";
    return "no_dir";
  }
  if (!state.hasCliRuns) return "no_cli";
  if (state.hasPathCli && state.hasConfig && !state.hasModelLine) return "no_model";
  return "partial";
}

export function formatHermesInstallProbe(state: HermesInstallProbe): string[] {
  return [
    `~/.hermes: ${state.hasDir ? "found" : "missing"}`,
    `CLI runs: ${state.hasCliRuns ? "ok" : "missing"}`,
    `venv CLI: ${state.hasVenvCli ? "yes" : "no"}`,
    `PATH CLI: ${state.hasPathCli ? "yes" : "no"}`,
    `config.yaml: ${state.hasConfig ? "yes" : "no"}`,
    `model: key: ${state.hasModelLine ? "yes" : "no"}`,
  ];
}
