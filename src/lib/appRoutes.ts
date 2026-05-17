// Hermes v0.13.0 sync — May 2026 (Ronbot)
/**
 * HashRouter paths exposed in Ronbot. Keep in sync with App.tsx / AppSidebar
 * and RONBOT_ELECTRON_APP_GUIDE in ronbotRules.ts (agent-facing docs).
 */
export const APP_ROUTES = [
  '/',
  '/channels',
  '/skills',
  '/settings',
  '/scheduled',
  '/insights',
  '/models',
  '/secrets',
  '/agents',
  '/updates',
  '/backups',
  '/diagnostics',
  '/terminal',
  '/install',
] as const;

/** Legacy redirect — not a primary nav target */
export const APP_ROUTE_ALIASES = [{ from: '/keys', to: '/secrets' }] as const;

export function formatAppRoutesForAgentGuide(): string[] {
  return [
    '- Home / agent chat: `#/` (same shell when connected)',
    '- Channels: `#/channels`',
    '- Skills & tools: `#/skills`',
    '- Settings (incl. Saved Personalities): `#/settings`',
    '- Scheduled jobs: `#/scheduled`',
    '- Usage insights: `#/insights`',
    '- LLM / model config: `#/models`',
    '- Secrets (API keys): `#/secrets` (legacy `#/keys` redirects here)',
    '- Sub-agents: `#/agents`',
    '- Updates: `#/updates`',
    '- Backups: `#/backups`',
    '- App Diagnostics (logs, support bundle): `#/diagnostics`',
    '- Terminal: `#/terminal`',
    '- Setup & Install: `#/install`',
  ];
}
