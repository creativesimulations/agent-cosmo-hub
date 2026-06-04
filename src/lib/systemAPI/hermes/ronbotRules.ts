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
  '- **Ronbot UI:** Terminal-style chat — see `~/.hermes/ELECTRON_APP_GUIDE.md`.';

/** Injected between <!-- ronbot:rules:start/end --> in AGENTS.md */
export const RONBOT_RULES_BLOCK = [
  'See ~/.hermes/ELECTRON_APP_GUIDE.md for the Ronbot desktop visual companion.',
  'Ronbot chat mirrors Hermes terminal stdout live — communicate in plain text like a CLI session.',
  'Ask questions in prose; the user replies in the chat box. For API keys, point them to #/secrets.',
  'No ronbot-intent blocks, JSON intent fences, or stream markers ([SHOW_QR], [REQUEST_CREDENTIALS], etc.).',
].join('\n');

export const RONBOT_ELECTRON_APP_GUIDE_VERSION = '<!-- ronbot-electron-app-guide v8 -->';

export const RONBOT_ELECTRON_APP_GUIDE = [
  RONBOT_ELECTRON_APP_GUIDE_VERSION,
  '# ELECTRON_APP_GUIDE.md — Ronbot Visual Companion',
  '',
  'You are connected to **Ronbot**, a desktop app that shows Hermes chat output like a terminal.',
  '',
  '## How chat works',
  '',
  '- The user types in the chat box (same as typing into `hermes chat`).',
  '- Your reply appears as a **live transcript** of Hermes stdout/stderr — tool traces, wizards, and permission prompts are visible.',
  '- Write naturally in plain text and markdown. Do **not** use special UI markers or fenced JSON intent blocks.',
  '',
  '## Secrets and pairing',
  '',
  '- For API keys Hermes should use long-term: tell the user to open **#/secrets** (Ronbot keychain).',
  '- For one-off values, they may paste in chat (same as a terminal) — prefer #/secrets for keys.',
  '- **WhatsApp / QR pairing:** paste the pairing URL, pairing code, or describe steps in text. Run `hermes whatsapp` (or the relevant setup command) yourself and relay wizard output in your reply.',
  '',
  '## Permissions',
  '',
  '- Shell/file/network approval prompts (`Choice [o/s/a/D]`) may also appear in Ronbot\'s approval dialog; the user can answer there or via chat.',
  '',
  '## Saved Personalities',
  '',
  'The user can save and switch personalities in **#/settings → Saved Personalities**. Applying a preset is a user action.',
  '',
  '## App routes (HashRouter)',
  '',
  ...formatAppRoutesForAgentGuide(),
  '',
  '- **#/diagnostics** — health, logs, copy support bundle into chat.',
  '- **#/secrets** — API keys (preferred over pasting keys in chat).',
  '',
  '## Live sidebar',
  '',
  'The right sidebar on Home polls Hermes every 5 seconds for sub-agents, cron, and heartbeat — you do not push updates to it.',
  '',
  'Keep responses clear and self-contained so the transcript reads well in a monospace bubble.',
  '',
].join('\n');
