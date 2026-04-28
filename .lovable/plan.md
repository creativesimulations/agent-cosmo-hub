Plan to fix the WhatsApp QR setup regression and the gateway not recognizing WhatsApp

Findings from the current code and your logs:
- The wizard still launches `hermes whatsapp` through a pseudo-terminal. Your gateway log shows repeated orphaned `hermes whatsapp`/`script` processes from earlier attempts. Those stale interactive processes can keep sessions/TTYs alive and prevent a fresh QR from rendering.
- The official Hermes bridge has a direct pair-only mode: `node bridge.js --pair-only --session ~/.hermes/platforms/whatsapp/session --mode <mode>`. This is a better fit for the app because it prints the QR directly, saves the exact gateway session directory, and exits after pairing.
- The gateway log never shows `Connecting to whatsapp...`; it only starts Slack and Email. That means the gateway is not seeing WhatsApp as a configured platform at start time, or it is reading stale env/service state. The setup must verify `WHATSAPP_ENABLED=true` is actually materialized before restarting the gateway, and status checks should report if WhatsApp is missing from `hermes gateway status`.
- Email IMAP and Slack missing-scope errors in the log are unrelated to QR rendering, but their repeated reconnect noise can hide the WhatsApp signal. The WhatsApp flow should surface WhatsApp-specific diagnostics instead of dumping general gateway noise.

Implementation changes to make:

1. Replace the fragile QR pairing command
- Update `src/lib/systemAPI/hermes.ts` `runWhatsAppPairing()` to run the official bridge directly in pair-only mode:
  - `node ~/.hermes/hermes-agent/scripts/whatsapp-bridge/bridge.js --pair-only --session ~/.hermes/platforms/whatsapp/session --mode "$WHATSAPP_MODE"`
  - source `~/.hermes/.env` first so `WHATSAPP_MODE`, `WHATSAPP_ALLOWED_USERS`, and `WHATSAPP_DEBUG` are available.
  - set `TERM=xterm-256color`, `FORCE_COLOR=1`, and explicit terminal dimensions so `qrcode-terminal` can render reliably.
  - keep the managed Node runtime at the front of PATH.
- Keep a fallback to `hermes whatsapp` only if `bridge.js` is missing, but mark that fallback clearly in the wizard output.

2. Improve stale process cleanup
- Expand `terminateWhatsAppPairingProcesses()` and pre-pair cleanup to kill:
  - old `script ... hermes whatsapp` wrappers,
  - old `hermes whatsapp` children,
  - old `node ... whatsapp-bridge/bridge.js --pair-only` runs.
- Do not kill the long-running gateway bridge on port 3000 except when explicitly resetting/re-pairing, so a healthy gateway is not disrupted unnecessarily.

3. Make session handling canonical
- Ensure `clearWhatsAppSession()` removes all known legacy paths plus the canonical `~/.hermes/platforms/whatsapp/session`.
- Ensure `isWhatsAppPaired()` and `getWhatsAppSessionFileCount()` focus on a real `creds.json`, not just any leftover file.
- After pair-only exits successfully, verify `~/.hermes/platforms/whatsapp/session/creds.json` exists. If pair-only saved to an older path for any reason, mirror it into the canonical path.

4. Verify the gateway sees WhatsApp, not just that a session exists
- Add a dedicated diagnostic in `getWhatsAppGatewayHealth()` for:
  - gateway running,
  - `hermes gateway status` includes WhatsApp as a configured/connected platform,
  - bridge `/health` is connected,
  - canonical session `creds.json` exists,
  - last WhatsApp bridge log tail.
- Update the wizard to fail with an actionable message if `WHATSAPP_ENABLED=true` is missing from `~/.hermes/.env` after saving, or if `hermes gateway status` shows no WhatsApp section after restart.

5. Restart gateway in the right order
- After successful pairing:
  - materialize `.env`,
  - stop the gateway,
  - refresh/install the gateway service so PATH is captured,
  - start the gateway,
  - poll for WhatsApp status using the improved health check.
- If the gateway starts but WhatsApp is not listed, show that exact reason instead of closing the wizard as successful.

6. Fix wizard UX around QR visibility
- Keep the terminal renderer, but add a plain text QR fallback that is always visible if xterm is not ready or if the QR appears in buffered output.
- Add a short “No QR yet” timeout state that offers “Force fresh QR pairing” and shows the last WhatsApp-specific log lines, not the whole gateway log.
- Prevent the auto-start effect from repeatedly launching pairing if prerequisites are ready but a stale session/reset confirmation is pending.

7. Channel card status
- Adjust the WhatsApp channel card attention reason to distinguish:
  - “WhatsApp is configured but not listed by Hermes gateway,”
  - “Gateway running but bridge not connected,”
  - “Session missing or stale,”
  - “Gateway not running.”
- Keep the spinner only during the short post-setup grace window; otherwise show Attention with the reason.

Files to update after approval:
- `src/lib/systemAPI/hermes.ts`
- `src/components/channels/ChannelWizard.tsx`
- `src/pages/Channels.tsx`
- possibly `src/components/channels/ChannelCard.tsx` if the card needs a clearer status label/tooltip.

Expected result:
- Starting WhatsApp setup reliably displays a QR code from the official Hermes bridge pair-only flow.
- Scanning the QR saves credentials into `~/.hermes/platforms/whatsapp/session`, the exact path the gateway uses.
- After setup, `hermes gateway status` should list WhatsApp, the bridge health should become connected, and the agent should be reachable on WhatsApp without the user asking the agent to configure anything manually.