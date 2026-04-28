## Findings

The phone shows Ronbot as linked, but the agent doesn't reply. The pairing succeeds, yet the Hermes gateway either isn't reading the same session or isn't reporting WhatsApp as a connected platform. The Channels card stays "Starting…" because the app's heuristic health check (process pgrep + log grep) never definitively proves WhatsApp is active.

Per upstream Hermes:
- `hermes whatsapp` (the CLI flow) saves pairing at `~/.hermes/whatsapp/session/creds.json`.
- The gateway adapter prefers `~/.hermes/platforms/whatsapp/session` for new installs, falling back to legacy `~/.hermes/whatsapp/session` if it already exists.
- The bridge is a Node.js process exposing `http://127.0.0.1:3000/health` returning `{ status: "connected" | "disconnected", queueLength, uptime }`.
- The gateway writes `~/.hermes/gateway_state.json` with `gateway_state` plus a `platforms.<name>.state` field (`connecting`, `connected`, `retrying`, `fatal`).
- `hermes gateway status` lists the gateway process state and configured/connected platforms.
- The agent is enabled by `WHATSAPP_ENABLED=true` + `WHATSAPP_MODE` + an allowlist (`WHATSAPP_ALLOWED_USERS` or `WHATSAPP_ALLOW_ALL_USERS=true`) in `~/.hermes/.env`.
- Hermes uses Baileys (NOT Meta Cloud API or Twilio). The in-app agent saying it needs Meta/Twilio is a hallucination — the gateway is the single source of truth.

Adding the user's hint: the most reliable runtime signals are, in order of authority:
1. `~/.hermes/gateway_state.json` → `platforms.whatsapp.state == "connected"`.
2. `http://127.0.0.1:3000/health` → `status == "connected"`.
3. `hermes gateway status` text mentioning WhatsApp connected.
4. `~/.hermes/logs/gateway.log` and `bridge.log` tail for WhatsApp/Baileys connection lines.
5. systemd user unit `hermes-gateway` active.

## Plan

1. Make pairing write to the path the gateway will read
   - Update `runWhatsAppPairing` to call the bridge directly in pair-only mode against the gateway-preferred session path (`~/.hermes/platforms/whatsapp/session`), with fallback to the legacy path if it already exists.
   - On successful pair, if a legacy `~/.hermes/whatsapp/session` exists but is empty/stale, leave it; otherwise migrate creds into the new path so the gateway picks it up.
   - Tighten `isWhatsAppPaired()` to require an actual `creds.json` in one of the canonical session dirs, not just any auth file.

2. Write the runtime config Hermes actually reads
   - Continue mirroring secrets to `~/.hermes/.env`: `WHATSAPP_ENABLED=true`, `WHATSAPP_MODE`, `WHATSAPP_ALLOWED_USERS` (or `WHATSAPP_ALLOW_ALL_USERS=true` if user chose `*`).
   - Add a managed `whatsapp:` block to `~/.hermes/config.yaml` with `unauthorized_dm_behavior: ignore` and preserve any user customizations.
   - Do not touch Meta/Twilio anywhere — Hermes WhatsApp is Baileys-based.

3. Always restart the gateway after a successful pair
   - After `clearWhatsAppSession` + pair, run: `stopGateway` → `refreshGatewayInstall` (snapshots PATH for managed Node) → `startGateway`.
   - This guarantees the gateway re-reads `.env` and the new session directory.

4. Replace heuristic health with the canonical signals (in priority order)
   - New `getWhatsAppGatewayHealth()`:
     - Parse `~/.hermes/gateway_state.json`. If `platforms.whatsapp.state == "connected"` → active.
     - Probe `http://127.0.0.1:3000/health`. If `status == "connected"` → active.
     - Run `hermes gateway status` and accept WhatsApp-connected text.
     - Read `bridge.log` / `gateway.log` tails for diagnostics only (not for declaring success).
     - Treat `systemctl --user is-active hermes-gateway` (and the system unit fallback) as "process running" but require one of the WhatsApp-specific signals above for "WhatsApp active".
   - Return structured fields: `running`, `whatsappActive`, `source` (`gateway_state` | `bridge_health` | `cli_status` | `none`), `bridgeLogTail`, `statusOutput`.

5. Fix the "Starting…" loop on the Channels card
   - In `Channels.tsx`, drive the WhatsApp card status from the new authoritative health check.
   - States: not-configured → not-configured; configured + active → Active; configured + not active → "Attention" with a tooltip/toast linking to Logs (no permanent silent spinner).
   - Re-poll briefly after the wizard closes (e.g., every 2s for ~30s) to converge to Active.

6. Remove leftover heuristics that lie
   - `buildChannelCredentialTestScript` for `whatsapp` should require `creds.json` in a canonical dir, not just "any file in any of seven possible paths".
   - The wizard's "Enable WhatsApp" button should only succeed when the new health check returns `whatsappActive`. If it doesn't within 30s, it shows the bridge log tail and offers a one-click "Restart gateway".

7. Tests
   - Unit-test the health parser against fixtures of `gateway_state.json`, bridge `/health` JSON, and `hermes gateway status` text.
   - Test that pairing targets the gateway session path.
   - Test that the credential test only passes with a real `creds.json`.

## Files to update

- `src/lib/systemAPI/hermes.ts` — pairing path, session detection, credential test, health probe (gateway_state.json + /health + CLI), startGateway sequencing.
- `src/lib/systemAPI/index.ts` — export any new helpers (already exports `getWhatsAppGatewayHealth`).
- `src/components/channels/ChannelWizard.tsx` — restart-after-pair flow, success gate uses authoritative health, log tail surface on failure.
- `src/pages/Channels.tsx` — card status derives from new health check; bounded re-poll after wizard close; never permanent "Starting…".
- `src/lib/systemAPI/hermes.install.test.ts` (or new test) — health parser + path tests.

## Expected outcome

After the QR scan: gateway restarts with the right session and env, `gateway_state.json` reports `platforms.whatsapp.state = connected` (corroborated by `/health`), the Channels card flips to Active, and the agent receives and replies to WhatsApp messages without any further user prompting. No "Starting…" loop, no Meta/Twilio detour.