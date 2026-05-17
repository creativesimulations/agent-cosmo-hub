// Hermes v0.13.0 sync — May 2026 (Ronbot)

export const DEFAULT_AGENT_NAME = "Ron";

/** Pip extras for local-folder installs only (official script owns bundled extras). */
export const LOCAL_INSTALL_PIP_EXTRAS = ["voice", "messaging", "cron", "web"] as const;

export const WIZARD_STEPS = [
  { id: "prereqs" as const, title: "Prerequisites", desc: "System dependencies" },
  { id: "install" as const, title: "Install", desc: "Install the Hermes agent" },
  { id: "done" as const, title: "Done", desc: "Ready to chat" },
];
