// Hermes v0.13.0 sync — May 2026 (Ronbot)
import type { HermesInstallProbe } from "@/lib/systemAPI/hermes/installProbe";

export type SetupPhase = "hub" | "connect" | "guard" | "wizard";

export type WizardStep = "prereqs" | "install" | "done";

export type InstallSource = "bundled" | "local";

export type AgentProbeReason =
  | "ready"
  | "no_dir"
  | "cli_only"
  | "no_cli"
  | "no_model"
  | "partial"
  | "probe_error";

export type AgentProbe = {
  ready: boolean;
  agentName?: string;
  versionSummary?: string;
  reason?: AgentProbeReason;
  installState?: HermesInstallProbe;
  probePath?: string;
};

export type InstallLogSink = (lines: string[]) => void;

export type StreamEvent = { type: string; data?: string; code?: number };

export type SetupBlockingState = {
  active: boolean;
  message: string;
};
