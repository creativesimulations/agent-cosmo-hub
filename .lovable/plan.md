# Fix stale channel state after reinstall (all channels)

## Background

`~/.hermes/` lives in WSL/Linux home and survives uninstalling the desktop app. After reinstall the app sees old `.env` keys and (for WhatsApp) old session/auth files, so:

- Every channel falsely shows as "Configured" with stale credentials the user can't see.
- WhatsApp additionally times out at the QR step because Baileys finds an old auth folder and tries to resume instead of pairing.

We'll fix WhatsApp specifically AND give every channel a consistent "Reset" path so a reinstall is recoverable from inside the app.

## What each channel actually persists

| Channel   | In `~/.hermes/.env`                                                    | Extra persistent state                                              |
|-----------|------------------------------------------------------------------------|---------------------------------------------------------------------|
| Telegram  | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USERS`                         | none                                                                |
| Slack     | `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_ALLOWED_USERS`            | none                                                                |
| Discord   | `DISCORD_BOT_TOKEN`, `DISCORD_ALLOWED_USERS`                           | none                                                                |
| WhatsApp  | `WHATSAPP_ENABLED`, `WHATSAPP_MODE`, `WHATSAPP_ALLOWED_USERS`          | `~/.hermes/platforms/whatsapp/session/`, plus bridge auth folders under `~/.hermes/hermes-agent/scripts/whatsapp-bridge/` (`auth_info*`, `baileys_auth*`, `session*`) |
| Signal    | `SIGNAL_HTTP_URL`, `SIGNAL_ACCOUNT`, `SIGNAL_ALLOWED_USERS`            | signal-cli state lives outside `~/.hermes` — out of our scope; we only own the env keys |

## Fixes — WhatsApp (primary bug)

1. **Expand pairing detection** — `isWhatsAppPaired` and `getWhatsAppSessionFileCount` currently only look at `~/.hermes/platforms/whatsapp/session`. Extend them to also check the bridge auth dirs (`auth_info*`, `baileys_auth*`, `session*` under `~/.hermes/hermes-agent/scripts/whatsapp-bridge/`).
2. **Comprehensive cleanup** — `clearWhatsAppSession` clears only the primary `session` dir. Expand it to remove every glob in the table above.
3. **Force-fresh-QR escape hatch** — when pairing stalls (no QR after timeout) and the bridge reports "found existing session", surface a **"Force fresh QR pairing"** button that triggers the comprehensive cleanup and restarts pairing. Today the user is stuck.
4. **Honest "session detected" copy** — when a stale session is detected at step 3, also explain it can come from a previous install and offer the same comprehensive reset.

## Fixes — All channels (uniform reset)

5. **`Reset channel` action** added to step 3 (and to the channel card menu via the wizard) that:
   - Stops the running gateway for that channel.
   - Removes that channel's keys from `~/.hermes/.env` via a new `systemAPI.removeChannelEnvKeys(channelId)`.
   - For WhatsApp, runs the comprehensive session cleanup from fix 2.
   - Re-runs `materializeEnv` and refreshes status. Card flips back to "Not configured".
6. **Reconfigure pre-fill warning** — when opening the wizard for a channel that's already configured, show an inline note: "Existing values from `~/.hermes/.env` are pre-filled. Click Reset to start clean." This applies to all five channels.
7. **Signal-specific note** — in the Signal reset confirmation, clarify that signal-cli's linked-device state is **not** cleared by Ronbot and must be removed via signal-cli if desired. Link to the Hermes Signal docs.

## UX flow on reinstall

```text
User reinstalls Ronbot
        │
        ▼
Channels page loads → reads ~/.hermes/.env
        │
        ▼
For each channel showing "Configured":
   ├─ "Reconfigure" button (existing)        → opens wizard with pre-filled values + reset note
   └─ "Reset" button (NEW, secondary)        → confirm → wipe env keys (+ WA session) → "Not configured"
```

## Technical details

Files to change:
- `src/lib/systemAPI/hermes.ts`
  - Extend `isWhatsAppPaired`, `getWhatsAppSessionFileCount` to scan bridge dirs.
  - Extend `clearWhatsAppSession` to remove `auth_info*`, `baileys_auth*`, `session*` under the bridge dir + the primary session dir.
  - Add `removeChannelEnvKeys(channelId)` — sed out the env keys for that channel from `~/.hermes/.env` (mirrors the manual `sed -i` we recommend today).
  - Add `stopChannelGateway(channelId)` wrapper if not present.
- `src/lib/systemAPI/index.ts` — export the two new methods.
- `src/lib/channels.ts` — add a `resetEnvVars: string[]` field per channel listing exactly which keys `removeChannelEnvKeys` should strip (so the source of truth stays here).
- `src/components/channels/ChannelWizard.tsx`
  - Add a `Reset` button at step 3 with a confirm dialog; calls `removeChannelEnvKeys` (+ `clearWhatsAppSession` when channel.id === 'whatsapp').
  - Add the "Force fresh QR pairing" button on the WA pairing pane when stalled or when "found existing session" is detected.
  - Add the inline pre-fill note when reopening a configured channel.
- `src/components/channels/ChannelCard.tsx` — small "Reset" link/menu item next to "Reconfigure" on configured cards.
- `src/pages/Channels.tsx` — refresh statuses after a reset completes.

Out of scope:
- We do NOT auto-clean `~/.hermes/.env` on uninstall — uninstall doesn't run our code, and we want users to keep their config across reinstalls. The reset button is the explicit opt-in.
- signal-cli linked-device cleanup remains the user's responsibility; we only document it.

## Acceptance

- Reinstalling Ronbot on Windows then opening WhatsApp → Reconfigure → "Force fresh QR pairing" produces a new QR within 30 s on a machine that previously had a stale session.
- On any channel, clicking Reset and confirming flips the card to "Not configured" and removes only that channel's keys from `.env` (other channels untouched).
- Pre-filled wizard for a configured channel shows the reset hint.
- Signal reset shows the signal-cli caveat.
