export type InstallStepMeta = { title: string; desc: string };

export const INSTALL_WIZARD_STEPS: InstallStepMeta[] = [
  { title: "System Prerequisites", desc: "Detect & install required dependencies" },
  { title: "Install Agent", desc: "Download and install the AI agent framework" },
  { title: "Name Your Agent", desc: "Give your AI agent a name" },
  { title: "API Keys", desc: "Configure your LLM provider credentials" },
  { title: "Choose Model", desc: "Select your preferred AI model" },
  { title: "Verify Installation", desc: "Run diagnostics to confirm everything works" },
  { title: "Launch", desc: "Start your AI agent" },
];
