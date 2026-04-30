Two-part fix: (a) finish the Windows + WSL WhatsApp finalization issue so the bridge actually finalizes after pairing, and (b) clean up the WhatsApp ChannelCard buttons.

## Part A — Make WhatsApp finalization work in WSL

The current failure is `Managed Node cannot require('@whiskeysockets/baileys') from .../whatsapp-bridge`. Baileys v7 ships as ESM and requires Node 20+, so a CommonJS `require()` probe fails even when the dependency is installed correctly. The wizard then declares failure and the runtime repair re-installs over a working tree without changing the outcome. Separately, on Windows the gateway runs in WSL where systemd may be unavailable, so the verification path must not insist on systemd-managed services.

1. ESM-safe Baileys load probe in `auditWhatsAppBridgeRuntime()` (`src/lib/systemAPI/hermes.ts`)
   - Replace `node -e "require('@whiskeysockets/baileys')"` with an ESM-safe probe using `node --input-type=module` and `import('@whiskeysockets/baileys')`, executed from the bridge directory so package resolution works.
   - Capture the actual error and tag the failure as one of: `missing`, `esm-cjs-mismatch`, `node-version`, `broken-install`.
   - Update the FAIL message from "cannot require" to "cannot load" with the captured error tail.

2. Smarter `ensureWhatsAppBridgeDeps()`
   - After confirming `node_modules/@whiskeysockets/baileys` exists, run the same ESM-safe probe.
   - If it fails, wipe `node_modules` + `package-lock.json` and reinstall instead of short-circuiting as healthy.
   - Keep all work scoped through the existing WSL-routed `runHermesShell`.

3. WSL/manual gateway start path
   - In `startGateway()` and the repair flow, when running on Windows or WSL without systemd, prefer the existing `nohup hermes gateway run --replace > /tmp/hermes-gateway.log 2>&1 &` fallback.
   - Treat "systemd is not running / not available" as informational when a gateway PID is detected via `pgrep`.
   - Skip `verifyGatewayUsesManagedNode()`'s `/proc` check as a hard gate when systemd is unavailable; verify by re-running the audit instead.

4. Repair success criteria
   - In `repairWhatsAppGatewayRuntime()`, treat the post-repair `auditWhatsAppBridgeRuntime()` (excluding `session-creds`) as the authoritative success signal in WSL/manual mode, not `verify-gateway-path`.

5. Wizard messaging
   - Update copy in `ChannelWizard.tsx` so the WSL audit failure shows the captured load error, not just "cannot require".
   - Keep Slack/Email warnings strictly under "Other gateway logs" (already in place).

6. Tests
   - Update `hermes.whatsapp-audit.test.ts` for the new `bridge-deps-loadable` wording.
   - Add a parser case for the new `esm-cjs-mismatch` detail string.

## Part B — WhatsApp ChannelCard button cleanup

Edit `src/components/channels/ChannelCard.tsx` and `src/pages/Channels.tsx`:

1. Remove the "Restart messaging gateway" button entirely from the WhatsApp channel card.
   - Drop the `onRestartGateway` and `gatewayRestartBusy` props (and the related state/handlers in `Channels.tsx`).
   - Gateway restart remains available via Diagnostics; the card should only expose "Reset WhatsApp…" plus the standard "Set up" / "Reconfigure" path.

2. "Reset WhatsApp…" disabled state
   - When the user clicks Reset, set the WhatsApp card into a "resetting / awaiting setup" state.
   - While in that state: the Reset button is grayed out and unclickable, shows a spinner + "Resetting…" then "Reset — click Set up", and the card status becomes `not-configured` so the primary CTA flips to "Set up".
   - The Reset button stays disabled until the user clicks "Set up" (which opens the wizard) — clicking Set up clears the disabled state.
   - Persist this transient flag in `Channels.tsx` (e.g. `whatsappResetPending`) so it survives re-renders within the page session.

## Technical notes

- All WSL commands continue to flow through `runHermesShell` / `wsl bash -lc` on Windows; no new IPC paths.
- The ESM probe payload is small enough to inline via base64, matching existing patterns.
- `ChannelCard` becomes simpler: WhatsApp's configured state shows "Reset WhatsApp…" (disabled when reset is pending) and a single primary action, no gateway-restart button.

## Expected result

- Pairing → finalization succeeds on Windows + WSL when Baileys is correctly installed; the bridge load probe stops giving false failures.
- If deps really are broken, "Repair runtime only" reinstalls them and re-verifies via the audit.
- The WhatsApp card is cleaner: no gateway button, and Reset visibly locks until the user proceeds to Set up.