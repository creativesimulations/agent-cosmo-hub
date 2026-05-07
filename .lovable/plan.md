## Audit findings

I cross-checked every place the app pulls live state about the agent against the official Hermes CLI reference. Several of our calls use subcommand names or `--json` flags that don't exist, so they silently return empty results — which is why parts of the right-hand info panel can look empty even when there is data.

### What's wrong today

1. **Cron jobs (`listScheduledJobs`)** probes `hermes cron list --json`, `hermes schedule list --json`, `hermes scheduled list --json`. Reality: only `hermes cron list` exists, no `--json`. The other two commands don't exist. Panel always shows empty.
2. **`deleteScheduledJob`** falls back to `hermes schedule delete` / `hermes scheduled delete` — only `hermes cron remove <id>` is real.
3. **Plugins (`listPlugins`)** uses `hermes plugins list --json` / `hermes plugin list --json`. Real: `hermes plugins list`, no `--json`.
4. **Profiles (`listProfiles`)** uses `hermes profile list --json` / `hermes profiles list --json`. Real: `hermes profile list`, no `--json`.
5. **Insights (`getInsights`)** probes `hermes insights --json`, `hermes stats --json`, `hermes usage --json`. Real: `hermes insights [--days N] [--source X]`, no `--json`. `stats`/`usage` don't exist.
6. **Health** uses a real chat round-trip (`chatPing`). The cheap, correct command is `hermes status` (`--deep` for thorough). We already have `hermesAPI.status()` but don't use it for the right-panel pill.
7. **Heartbeats** are read from a `heartbeats:` block in `config.yaml` that **does not exist in Hermes**. What you described as heartbeats maps to recurring entries in `hermes cron list`. So the section is structurally always empty.
8. **Sub-agents (`systemAPI.listSubAgents`)** has no real CLI; sub-agents are spawned via the `delegate_task` tool inside a chat turn and die with that turn. The correct source is the in-memory `liveSubAgents` store we already populate from streamed chat.
9. **`restartAgent`** does `pkill` + `status`. The official restart for the long-lived service is `hermes gateway restart`.

### The agent doesn't know what the app expects from it

The renderer relies on the agent emitting fenced JSON blocks the app understands:

```
```ronbot-intent
{ "id": "...", "type": "credential_request", ... }
```
```

Nothing in the project ever teaches the agent that this protocol exists. Hermes already knows how to schedule jobs, install skills, manage MCP servers, etc. — we don't need to re-teach any of that. We only need to teach it the **Ronbot-specific UI contract**:

- the `ronbot-intent` fenced JSON envelope and the valid `type` values,
- when to emit each type (e.g. ask for a secret with `credential_request` instead of plain prose, surface a yes/no with `confirm`, show a QR with `qr_display`, etc.),
- not to identify itself as Hermes (use the SOUL.md name).

That's it — a small UI-protocol primer, not a re-explanation of Hermes' own features.

---

## Plan

### 1. Fix CLI probes — `src/lib/systemAPI/hermes.ts`

| Function | Change |
|---|---|
| `listScheduledJobs` | Call `hermes cron list` only. Parse the human table (id, schedule, next-run, prompt). Drop `schedule`/`scheduled` probes. |
| `deleteScheduledJob` | Call `hermes cron remove <id>` only. |
| `listPlugins` | Call `hermes plugins list` (no `--json`). Parse name + enabled flag. |
| `listProfiles` | Call `hermes profile list` (singular, no `--json`). |
| `getInsights` | Call `hermes insights --days 30`. Parse text output for tokens/cost/sessions. |
| `listSubAgents` | Stop shelling out. Return `liveSubAgents.list()`. |
| Health source for the right panel | Switch from `chatPing` to `hermesAPI.status()` (cheap, correct). Keep `chatPing` for explicit "is chat actually responsive" checks. |
| `restartAgent` | `hermes gateway restart` (best-effort) → `pkill -f "hermes chat"` for any stuck stream → `hermes status` to warm up. |

### 2. Replace fake "Heartbeats" with real cron data

- Drop `parseHeartbeats(config)` from `useAgentLiveState`.
- Right panel: rename the section to **"Recurring jobs"** and source it from the same parsed `cron list` output, filtering to entries with a recurring schedule (cron expression with `*`/intervals, vs. one-shots).

### 3. Teach the agent the Ronbot UI protocol (only)

Add `writeRonbotAgentRules()` in `hermes.ts`. It writes a Ronbot-owned, clearly-delimited block into `~/.hermes/AGENTS.md` (Hermes auto-injects this file into every conversation), between markers like:

```
<!-- ronbot:rules:start -->
…ronbot-intent protocol primer…
<!-- ronbot:rules:end -->
```

Idempotent: replace the block in place, preserve everything outside it. Content covers **only** UI-protocol rules:

- The `ronbot-intent` fenced JSON envelope, with id/type/title/description fields.
- The full list of valid `type` values and a one-line example of each (`credential_request`, `confirm`, `choice`, `qr_display`, `oauth_open`, `file_pick`, `progress`, `done`, `pairing_approve`).
- "Prefer an intent card over a prose question whenever the user has to type a secret, paste a code, scan a QR, choose between options, pick a file, or confirm a destructive action."
- "Identify as the name in `~/.hermes/SOUL.md`."

Nothing about cron, skills, MCP, etc. — Hermes already knows how to do those.

Wire-up:
- Call from `writeInitialConfig` (first install).
- Call once on app startup after `connected === true` (idempotent, cheap).

### 4. Personality flow — drop the auto-prompt button

Replace `PersonalityDialog`'s "Send to agent" flow with one that **doesn't auto-send**.

UX:
- User opens "Agent personality" from Settings.
- Dialog closes immediately and routes to the chat.
- The chat composer is **pre-filled with an unfinished draft** that the user has to complete before sending, e.g.:

  > I'd like to adjust your personality. Please update your SOUL.md / base behavior so that you ▍

  (cursor parked at the end). Nothing is sent until the user types the rest and hits Enter themselves.

- After the user sends the message, a small inline reminder appears under the composer: "Personality changes apply on next agent restart — restart now?" with a "Restart now" button (calls `systemAPI.restartAgent()`). This replaces the previous post-send modal.

Implementation notes:
- `ChatContext` already exposes a `draft` setter (`setDraft`) — use it to pre-fill the composer.
- The reminder banner can live inside the chat page and key off "did the user just send a message that started with the personality preamble?" — or simpler: a transient flag on `ChatContext` set when `setPersonalityDraft()` is called and cleared on send.

### 5. Tests / verification

- Unit-test the new human-output parsers in `hermes.ts` against captured fixtures of `hermes cron list`, `hermes plugins list`, `hermes profile list`, `hermes insights`.
- Manual: ask the agent in chat to schedule a recurring task; confirm it appears in the right panel within 5s.
- Manual: open the personality dialog → composer has the unfinished draft → finish the sentence and send → reminder banner with "Restart now" appears.
- Manual: confirm the Ronbot rules block lands in `~/.hermes/AGENTS.md` and is preserved across launches.

### Files touched

- **edited** `src/lib/systemAPI/hermes.ts` — fix probes, parsers, restart, add `writeRonbotAgentRules`.
- **edited** `src/lib/systemAPI/index.ts` — export the new helper.
- **edited** `src/hooks/useAgentLiveState.ts` — drop heartbeats parser, switch health to `status()`.
- **edited** `src/components/companion/RightInfoPanel.tsx` — "Heartbeats" → "Recurring jobs".
- **edited** `src/components/settings/PersonalityDialog.tsx` — pre-fill composer + route to chat instead of auto-sending; remove the post-send restart modal.
- **edited** `src/contexts/ChatContext.tsx` — small flag for the post-send "restart now?" reminder.
- **edited** `src/pages/AgentChat.tsx` — render the reminder banner.
- **edited** `src/App.tsx` — call `writeRonbotAgentRules` once on connect.
- **new** test file with parser fixtures.
