
# Agent-Driven Setup: app as a "credential & UI broker"

## Goal

Stop duplicating Hermes' integration logic in the Electron app. Let the Hermes agent drive setup of skills, tools, and channels through normal chat. The app's job becomes:

1. Render a friendly UI when the agent needs something from the user (password, API key, QR scan, OAuth click, file pick, "yes/no").
2. Hand the result back to the agent.
3. Show the user a clear, browseable catalog of what the agent can do, so they're never staring at a blank chat.

All five user constraints are preserved — see "Guarantees" at the end.

---

## The intent protocol (single source of truth)

The agent already streams tokens to the chat. We add a tiny structured side-channel: the agent emits a fenced JSON block when it needs the UI to do something the chat can't:

````text
```ronbot-intent
{
  "id": "intent_abc123",
  "type": "credential_request",
  "title": "Slack bot token",
  "description": "Paste the xoxb- token from api.slack.com/apps.",
  "fields": [
    { "key": "SLACK_BOT_TOKEN", "label": "Bot token", "secret": true,
      "validate": "^xoxb-" }
  ],
  "openUrl": "https://api.slack.com/apps",
  "expiresInSec": 600
}
```
````

The renderer parses it out of the stream and replaces it with an inline UI card. When the user submits, we POST the result back to the agent as the next user turn:

````text
```ronbot-intent-response
{ "id": "intent_abc123", "ok": true, "values": { "SLACK_BOT_TOKEN": "xoxb-…" } }
```
````

Initial intent types (extensible):

- `credential_request` — one or more secret/text fields → stored via `secretsStore` and materialized into `~/.hermes/.env`.
- `confirm` — yes/no with title + body (e.g. "Install Slack bridge dependencies?").
- `choice` — radio list (e.g. self-chat vs bot for WhatsApp).
- `qr_display` — agent emits a base64 QR PNG or a phrase; we render it big with a "I scanned it" button. Used by WhatsApp + Signal linking.
- `oauth_open` — open URL in default browser, listen on a localhost callback the agent already runs, then confirm.
- `file_pick` — folder/file dialog (already wired via `coreAPI.selectFolder`).
- `progress` — long-running task heartbeat ("Installing baileys… 40%"). No user input.
- `done` — agent signals "channel X is live", app refreshes capability/channel state.

The protocol is the *only* new contract between app and agent. Everything else flows through normal chat.

---

## What the app stops owning

These TS modules become thin or get deleted because the agent drives them:

- WhatsApp adapter patching (`patchHermesWhatsAppAdapterForNode`, `_ronbot_node_bin` payload, V5 marker, audit/repair/verify pipeline).
- Bridge log parsing (`findUnauthorizedWhatsAppSenders`, `classifyWhatsAppBridgeFailure`, `auditWhatsAppBridgeRuntime`, `repairWhatsAppGatewayRuntime`).
- WhatsApp env-var bookkeeping (`ensureWhatsAppRuntimeSecrets`, `removeChannelEnvKeys`, `resetWhatsAppChannel`).
- Per-channel "is configured?" derivation in `Channels.tsx` from `~/.hermes/.env`.
- Bespoke per-channel wizards in `ChannelWizard.tsx`.

The agent owns: writing `~/.hermes/.env`, restarting the gateway, validating tokens, parsing its own logs, displaying QRs, and deciding when a channel is "ready". The app receives `done` intents and refreshes.

We keep these modules around (deprecated, behind a feature flag) for one release so users mid-flow aren't broken — see "Migration" below.

---

## What the app owns

1. **Installer & runtime** (unchanged) — `prereqAPI`, `hermesAPI.install*`, `bootstrapStartupHealth`, sudo dialog, install pill. The first-run flow that gets Hermes onto the machine stays exactly as it is.
2. **Secrets store** — the OS-keychain-backed `secretsStore` is *the* place credentials live. The agent never sees raw secrets in chat history; intents say "give me X", we collect, store, and materialize into `~/.hermes/.env` for the gateway to read.
3. **Intent renderer** — a single React component family that turns intent JSON into the right UI (form, QR, confirm, progress).
4. **Capabilities catalog** — the discoverability surface (see below).
5. **Chat** — unchanged user-facing experience; gains the inline intent cards.

---

## Discoverability: the "What can Ron do?" surface

This is the answer to constraint #5. Three coordinated pieces:

### a) Home page → capability gallery

Replace/augment the current Home with a grid of capability tiles grouped by category:

````text
Communication        Productivity         Knowledge           Computer
─────────────       ─────────────        ──────────          ─────────
Telegram            Gmail                 Web search          File system
Slack               Calendar              Wikipedia           Terminal commands
WhatsApp            Drive/Docs/Sheets     YouTube transcripts Browser automation
Discord             …                     …                   …
Signal
````

Each tile shows: icon, name, one-line "what it does", status badge (Ready / Needs setup / Locked). Clicking "Set up" doesn't launch a TS wizard anymore — it sends a seeded prompt to chat: *"Set up Slack for me"* — and the agent drives the rest via intents.

The catalog is **declarative** (`src/lib/capabilities/catalog.ts`) so we (and the agent, via a tool) can list it. Ships with the canonical set; new entries can be added without code changes by skills the agent installs.

### b) Chat empty-state with example prompts

When chat is empty, show 6–8 chips: *"Send me a Slack message when X"*, *"Read my unread email and summarize"*, *"Take a screenshot of example.com"*, *"Install the YouTube transcript skill"*. Click → fills the input.

### c) Slash-style command palette in chat input

`/` opens a list of intents the agent advertises (queried once via a `list_capabilities` chat round-trip and cached): *"/setup-slack"*, *"/connect-google-workspace"*, *"/install-skill <name>"*. These are just shortcuts — they expand to natural-language prompts.

Together: the user always has a starting point and never needs to guess.

---

## Migration plan (concrete file changes)

### Phase 1 — Build the broker (no behavior change yet)

- `src/lib/agentIntents/` — new module
  - `protocol.ts` — TypeScript types for every intent + Zod-style validators.
  - `parser.ts` — `extractIntents(streamChunk)` finds and strips ` ```ronbot-intent ` blocks from assistant text.
  - `responder.ts` — formats `ronbot-intent-response` and posts via `ChatContext.sendMessage` as a system-tagged turn.
- `src/components/intents/` — renderer components: `CredentialRequestCard`, `ConfirmCard`, `ChoiceCard`, `QRCard`, `OAuthCard`, `FilePickCard`, `ProgressCard`.
- `src/contexts/ChatContext.tsx` — extend `ChatMessage` with `intents?: AgentIntent[]`. Stream parser routes intent JSON into that field instead of into `content`. Existing `permissionMismatch` / `toolUnavailable` UI stays.
- Done: agent can now ask for things and the chat will render the right card. Nothing changes for users yet because the agent isn't emitting intents.

### Phase 2 — Capability catalog & Home redesign

- `src/lib/capabilities/catalog.ts` — declarative list (id, name, category, icon, oneLiner, statusProbe, setupPrompt).
- `src/pages/Index.tsx` (Home) — capability grid + "What can Ron do?" hero.
- `src/pages/AgentChat.tsx` — empty-state chips + `/` command palette.
- Channels page (`src/pages/Channels.tsx`) — keep as a focused subview of the catalog, but its "Set up" buttons stop opening `ChannelWizard` and instead seed a chat prompt.

### Phase 3 — Move one channel end-to-end (Slack as the proof)

Slack is the cleanest test: pure tokens, no QR, no Node bridge. We:

1. Author the agent-side flow (skill/prompt template) that, when asked to set up Slack, emits `credential_request` for the three tokens, validates them, writes `~/.hermes/.env`, restarts the gateway, then emits `done`.
2. Delete Slack from `ChannelWizard.tsx`'s special-case paths; delete Slack-specific config logic from `Channels.tsx`.
3. Smoke test on macOS, Linux, Windows packaged builds.

If Slack works end-to-end, WhatsApp's hard pieces (adapter patching, JID validation, log parsing, gateway restart) all become "things the agent does" — exactly where they belong.

### Phase 4 — Migrate remaining channels & retire dead code

- Telegram, Discord — same shape as Slack, trivial.
- WhatsApp — `qr_display` + `confirm` intents replace `WhatsAppTerminal` + `ChannelWizard`'s WhatsApp branch. Delete `patchHermesWhatsAppAdapterForNode`, `auditWhatsAppBridgeRuntime`, `repairWhatsAppGatewayRuntime`, `findUnauthorizedWhatsAppSenders`, `ensureWhatsAppRuntimeSecrets`, `resetWhatsAppChannel`, related tests.
- Signal — `oauth_open`-style flow (signal-cli linking), but the agent owns it.
- Google Workspace — already partly agent-driven (`setupGoogleWorkspace`); convert to intent-based.
- Skills/Tools install (`InstallSkillDialog`, `installSkillFromGit`, `installSkillFromPath`) — same treatment: replace dialog with chat-driven flow that emits `file_pick` / `confirm` intents.

### Phase 5 — Clean up `systemAPI/index.ts`

After Phase 4, ~25 of the 100+ exported methods become dead. Remove them and their tests.

---

## Cross-platform safety

The intent protocol is OS-agnostic — it's just JSON in chat. The only platform-touching code is:

- The installer (unchanged, already cross-platform).
- The secrets store (unchanged, already cross-platform via keychain/safeStorage/plaintext fallback).
- File/folder pick dialogs (already abstracted via Electron's main process).
- Open-URL for OAuth (`shell.openExternal`, already cross-platform).

Everything previously platform-specific (shell-quoting Python patches, sudo password handling for `apt`, Node binary discovery for the WhatsApp bridge) stays where it was — those are **installer** concerns, not setup concerns, and the installer keeps working as it does today.

---

## Guarantees against your five constraints

1. **Works on macOS / Linux / Windows.** The new code is renderer-side React + JSON parsing. No new platform-specific shell. Removed code (adapter patcher) was the *most* platform-fragile part of the codebase.
2. **User never touches the terminal.** Confirmed — the Terminal page stays as a power-user escape hatch but is never required. Every setup that previously required a CLI step (apt installs, npm installs, gateway restarts) is either already automated by the installer or moves into agent-driven intents that the user satisfies by clicking buttons / pasting tokens / scanning a QR.
3. **Initial agent installation is unchanged.** `InstallContext`, `InstallPreflight`, `bootstrapStartupHealth`, `installHermes*`, sudo dialog, and the install pill are all out of scope for this refactor. First-run still gets Hermes onto the machine the same way it does today; only what happens *after* "agent is connected" changes.
4. **Agent Chat keeps working.** Chat is the centerpiece — it gains capability (intent cards inline), it doesn't lose anything. Existing features (queueing, sub-agents, capability fix bubbles, permission mismatch warnings, session resume) are untouched.
5. **User always knows what's possible.** New Home capability gallery + chat empty-state chips + `/` command palette + per-tile "Set up" buttons that seed the right prompt. The user should never have to guess what to type.

---

## Technical details

- **Intent transport**: fenced ` ```ronbot-intent ` blocks. Reason for in-band over a side IPC channel: works with Hermes' existing stdout streaming, survives `--resume`, replayable from chat history, no new IPC plumbing.
- **Response transport**: a synthetic user turn whose visible content is collapsed in the UI ("Sent: Slack tokens"), but whose actual payload is the JSON. ChatContext gets a `sendIntentResponse()` helper.
- **Validation**: each intent field has an optional `validate` regex; the renderer enforces it client-side before submit, and the agent re-validates server-side. This is what kills the `xoxb-`/`xapp-`/E.164/JID-format class of bugs — the agent decides what's valid, not us.
- **Secrets**: the renderer writes to `secretsStore` *and* calls `materializeEnv()` after every `credential_request`. Agent never sees the raw value in chat — it sees `"<stored: SLACK_BOT_TOKEN>"`.
- **Backward compat during migration**: a feature flag `useAgentDrivenSetup` (default false until Phase 3 is shipped) keeps `ChannelWizard` available. We flip it per-channel as each migration lands.
- **Tests**: new `protocol.test.ts` covers the parser/responder. Existing channel tests stay until Phase 4 deletes their subjects.

---

## Out of scope (deliberately)

- Changing Hermes itself. The agent-side prompts/skills that emit intents are the user's/operator's concern; we ship a small reference skill so the demo works, but the protocol is the long-lived contract.
- Reworking permissions, sub-agents, LLM config, secrets UI, backups, diagnostics. They already follow the right pattern.
- Anything to do with the installer. Genuinely unchanged.

---

## Suggested first PR

Phase 1 + Phase 2 + the Slack migration in Phase 3. That's the smallest unit that proves the architecture end-to-end without leaving WhatsApp half-migrated. Approve this plan and I'll cut that as the first build.
