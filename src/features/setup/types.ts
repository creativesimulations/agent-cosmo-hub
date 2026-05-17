// Hermes v0.13.0 sync — May 2026 (Ronbot)

export type SetupPhase = "hub" | "connect" | "guard" | "wizard";

export type WizardStep = "prereqs" | "install" | "done";

export type InstallSource = "bundled" | "local";

export type AgentProbe = {
  ready: boolean;
  agentName?: string;
  versionSummary?: string;
  reason?: "no_dir" | "no_cli" | "no_model" | "probe_error";
};

export type InstallLogSink = (lines: string[]) => void;

export type StreamEvent = { type: string; data?: string; code?: number };
