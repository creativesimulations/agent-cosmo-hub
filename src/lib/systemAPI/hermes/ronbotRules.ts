// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { formatAppRoutesForAgentGuide } from '@/lib/appRoutes';

/**
 * Static markdown Ronbot writes for the agent to read (visual companion only).
 * Does not override Hermes tools, skills, or conversation style.
 *
 *   - RONBOT_RULES_BLOCK        → ~/.hermes/AGENTS.md managed block
 *   - RONBOT_ELECTRON_APP_GUIDE → ~/.hermes/ELECTRON_APP_GUIDE.md
 *
 * Bump RONBOT_ELECTRON_APP_GUIDE_VERSION when content changes so guides refresh on connect.
 */

/** One-liner appended to seeded MEMORY.md when Ronbot manages persona files. */
export const RONBOT_MEMORY_UI_POINTER =
  '- **Ronbot UI:** Optional stream markers — see `~/.hermes/ELECTRON_APP_GUIDE.md`.';

/** Injected between <!-- ronbot:rules:start/end --> in AGENTS.md */
export const RONBOT_RULES_BLOCK = [
  'See ~/.hermes/ELECTRON_APP_GUIDE.md for how to interact with the Ronbot desktop visual companion.',
  'Use simple markers like [SHOW_QR], [REQUEST_CREDENTIALS], and [SHOW_BRAID_GRAPH] when appropriate.',
].join('\n');

export const RONBOT_ELECTRON_APP_GUIDE_VERSION = '<!-- ronbot-electron-app-guide v7 -->';

export const RONBOT_ELECTRON_APP_GUIDE = [
  RONBOT_ELECTRON_APP_GUIDE_VERSION,
  '# ELECTRON_APP_GUIDE.md — How to Use Ronbot (Your Visual Companion)',
  '',
  'You are connected to Ronbot, a friendly desktop app that gives you a nice UI on top of Hermes.',
  '',
  '**Simple ways you can ask the app to show things:**',
  '- To show a QR code: include `[SHOW_QR]` anywhere in your reply, followed by the URL, `data:image/...`,',
  '  text to encode, or a fenced ```text block with a terminal QR matrix on the following lines.',
  '- To ask the user for a one-off secret in chat: include `[REQUEST_CREDENTIALS purpose]`',
  '  (replace "purpose" with a short description). Ronbot opens a small dialog and inserts into the',
  '  user\'s chat draft — not the keychain. For API keys Hermes should use long-term, tell the user',
  '  to open **#/secrets** instead.',
  '- Legacy alias: `[REQUEST_PASSWORD purpose]` works the same as `[REQUEST_CREDENTIALS]`.',
  '- To show a large Mermaid/BRAID graph: include `[SHOW_BRAID_GRAPH]`, then a ```mermaid fenced block.',
  '- Optional `[UPDATE_DASHBOARD]` — stripped from the bubble; Ronbot may refresh the live sidebar.',
  '  The right sidebar already polls Hermes every 5 seconds — you do not need this marker routinely.',
  '',
  '**Saved Personalities:**',
  'You can edit PERSONALITY.md yourself. The user can save and switch personalities through the app',
  '(#/settings → Saved Personalities). Applying a preset is a user action — do not rely on the app',
  'to rewrite SOUL/PERSONALITY except when they apply a preset.',
  '',
  '**App routes (HashRouter):**',
  '',
  ...formatAppRoutesForAgentGuide(),
  '',
  '- **#/diagnostics** — health, logs, copy support bundle into chat.',
  '- **#/secrets** — API keys (preferred over pasting keys in chat).',
  '',
  '**Permission approval (desktop only):**',
  'Shell/file/network prompts may appear outside chat — the user taps Allow/Deny in Ronbot.',
  '',
  '**Style:**',
  '- Be helpful, friendly, and concise.',
  '- Use normal markdown. No fenced JSON "intent" blocks — Ronbot does not parse them.',
  '- Use the markers above when you want the app to show something visual.',
  '- The right sidebar shows what you and your sub-agents are currently doing (app polls the CLI).',
  '',
  'This is the only Ronbot UI guide you need. Keep responses clear so the user enjoys chatting with you.',
  '',
].join('\n');
