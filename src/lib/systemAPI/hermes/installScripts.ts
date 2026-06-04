// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { INSTALL_SCRIPT } from './constants';

/** Official installer stages for Hermes core (no npm / Playwright). */
export const HERMES_CORE_INSTALL_STAGES = [
  'prerequisites',
  'repository',
  'venv',
  'python-deps',
  'path',
  'config',
] as const;

/**
 * Run official install.sh in staged mode: core first, browser tools second.
 * Ronbot owns post-install setup (--skip-setup on every stage).
 */
export const buildHermesCoreInstallScript = (): string => {
  const stageCalls = HERMES_CORE_INSTALL_STAGES.map(
    (stage) => [
      `echo "[ronbot-install] stage: ${stage}"`,
      `curl -fsSL "${INSTALL_SCRIPT}" | bash -s -- --skip-setup --non-interactive --stage "${stage}"`,
    ].join('\n'),
  ).join('\n');

  return [
    'set -e',
    'export PATH="$HOME/.hermes/venv/bin:$HOME/.hermes/bin:$HOME/.local/bin:$PATH"',
    stageCalls,
    'echo "[ronbot-install] core install stages finished"',
  ].join('\n');
};

/** Browser tools: repo npm install + Playwright (official node-deps stage). */
export const buildHermesBrowserInstallScript = (): string =>
  `curl -fsSL "${INSTALL_SCRIPT}" | bash -s -- --skip-setup --non-interactive --stage node-deps`;

/** @deprecated Monolithic installer; prefer staged core + browser in installRun. */
export const buildOfficialHermesInstallScript = (): string =>
  `curl -fsSL "${INSTALL_SCRIPT}" | bash -s -- --skip-setup --skip-browser`;
