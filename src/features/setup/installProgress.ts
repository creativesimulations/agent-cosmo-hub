// Hermes v0.13.0 sync — May 2026 (Ronbot)

export type InstallProgressState = {
  percent: number;
  label: string;
};

export type InstallProgressUpdate = {
  percent: number;
  label: string;
};

export type InstallProgressPhase = 'core' | 'browser';

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

type Rule = { test: RegExp; percent: number; label: string };

/** Milestones from official install.sh / Ronbot stage output (percent = weight within phase). */
const CORE_RULES: Rule[] = [
  { test: /\[ronbot-install\] stage: prerequisites/i, percent: 8, label: 'System prerequisites…' },
  { test: /detected:\s*linux|detected:\s*macos|detected:\s*darwin/i, percent: 12, label: 'Detecting platform…' },
  { test: /installing managed uv/i, percent: 18, label: 'Installing package manager (uv)…' },
  { test: /checking python/i, percent: 24, label: 'Checking Python 3.11…' },
  { test: /python found:/i, percent: 28, label: 'Python ready' },
  { test: /\[ronbot-install\] stage: repository|trying ssh clone|cloned via/i, percent: 38, label: 'Downloading Hermes source…' },
  { test: /repository ready/i, percent: 42, label: 'Source repository ready' },
  { test: /\[ronbot-install\] stage: venv|creating virtual environment/i, percent: 48, label: 'Creating Python virtual environment…' },
  { test: /virtual environment ready/i, percent: 52, label: 'Virtual environment ready' },
  { test: /\[ronbot-install\] stage: python-deps|installing dependencies/i, percent: 58, label: 'Installing Python packages (uv)…' },
  { test: /hash-verified|trying tier:/i, percent: 64, label: 'Resolving locked dependencies…' },
  { test: /main package installed|built hermes-agent/i, percent: 72, label: 'Hermes Python package installed' },
  { test: /all dependencies installed/i, percent: 78, label: 'Python dependencies complete' },
  { test: /\[ronbot-install\] stage: path|hermes command ready/i, percent: 86, label: 'Installing hermes CLI…' },
  { test: /\[ronbot-install\] stage: config|configuration files/i, percent: 92, label: 'Creating config files…' },
  { test: /\[ronbot-install\] core install stages finished/i, percent: 100, label: 'Core agent install complete' },
];

const BROWSER_RULES: Rule[] = [
  { test: /\[ronbot-install\] stage: node-deps|installing node\.js dependencies/i, percent: 10, label: 'Installing browser tools (npm)…' },
  { test: /node\.js dependencies installed/i, percent: 55, label: 'npm dependencies installed' },
  { test: /installing browser engine|playwright chromium/i, percent: 75, label: 'Installing Playwright Chromium…' },
  { test: /system browser detected|skipping playwright browser download/i, percent: 90, label: 'Using system browser' },
  { test: /playwright.*installed|browser engine/i, percent: 95, label: 'Browser engine ready' },
  { test: /npm (warn|error)|reify:|added \d+ packages/i, percent: 40, label: 'npm install in progress…' },
];

const PHASE_RANGE: Record<InstallProgressPhase, { min: number; max: number; rules: Rule[] }> = {
  core: { min: 8, max: 72, rules: CORE_RULES },
  browser: { min: 74, max: 88, rules: BROWSER_RULES },
};

function scalePercent(raw: number, ruleMax: number, min: number, max: number): number {
  const clamped = Math.min(ruleMax, Math.max(0, raw));
  return Math.round(min + (clamped / ruleMax) * (max - min));
}

export function initialInstallProgressState(phase: InstallProgressPhase = 'core'): InstallProgressState {
  const range = PHASE_RANGE[phase];
  return {
    percent: range.min,
    label: phase === 'core' ? 'Starting core install…' : 'Starting browser tools install…',
  };
}

export function updateInstallProgressFromLine(
  rawLine: string,
  state: InstallProgressState,
  phase: InstallProgressPhase,
): InstallProgressState {
  const line = stripAnsi(rawLine).trim();
  if (!line) return state;

  const { min, max, rules } = PHASE_RANGE[phase];
  let next = { ...state };

  for (const rule of rules) {
    if (!rule.test.test(line)) continue;
    const scaled = scalePercent(rule.percent, 100, min, max);
    if (scaled >= next.percent) {
      next = { percent: scaled, label: rule.label };
    }
    break;
  }
  return next;
}

export function toProgressUpdate(state: InstallProgressState): InstallProgressUpdate {
  return { percent: state.percent, label: state.label };
}

export const INSTALL_PROGRESS = {
  preflight: { percent: 5, label: 'Running preflight checks…' },
  apt: { percent: 7, label: 'Installing system packages…' },
  coreStart: { percent: 8, label: 'Installing Hermes core (Python, CLI, config)…' },
  coreDone: { percent: 72, label: 'Core install complete' },
  browserStart: { percent: 74, label: 'Installing browser tools (optional, may take a while)…' },
  browserDone: { percent: 88, label: 'Browser tools install finished' },
  browserSkipped: { percent: 88, label: 'Skipped browser tools (core agent is ready)' },
  finalizeStart: { percent: 90, label: 'Applying personality and starting gateway…' },
  finalizeGateway: { percent: 96, label: 'Starting Hermes gateway…' },
  complete: { percent: 100, label: 'Install complete' },
} as const;
