I found two concrete problems in the current implementation, both visible in the error text:

1. The WhatsApp failure happens before the adapter is created. Official Hermes code in `gateway/platforms/whatsapp.py` only checks a bare `node --version`; if the gateway's environment cannot resolve `node`, it returns `None` and logs `WhatsApp: Node.js not installed or bridge not configured` / `No adapter available for whatsapp`.
2. The Slack error is a real startup blocker: another Hermes gateway process or stale scoped lock is holding the Slack app token. Because the gateway exits on that non-retryable conflict, WhatsApp never gets a stable gateway process even after runtime prep.

The key implementation mistake from earlier fixes is that Ronbot is preparing a parallel managed Node path (`~/.hermes/runtime/node/node-v22.22.2-...`) that does not exist on nodejs.org and ignores the canonical layout that the official Hermes installer creates (`~/.hermes/node` with `~/.local/bin/node`/`npm`/`npx` symlinks). We should stop fighting the official installer and follow its layout.

## Guiding principle (applies to every step below)

Every function of the app must follow the official Hermes documentation for setup and installation of every aspect of the program — install layout, gateway service flow, WhatsApp bridge prerequisites, channel env vars, gateway start/replace/stop semantics — so the program works exactly as Hermes expects. All of this must be automated. The only acceptable user prompt during setup is the OS sudo password, and only when an action genuinely needs root (apt build tools, Playwright `--with-deps`, system service install). Ronbot must request that password through the existing sudo prompt UI when needed and never ask the user to perform a manual fix or click a “repair” button.

Plan:

1. Align Ronbot's managed Node with Hermes' official installer layout
   - Replace the custom `~/.hermes/runtime/node/node-v...` layout with Hermes' canonical `~/.hermes/node` layout.
   - Resolve the actual latest Node 22 release from `https://nodejs.org/dist/latest-v22.x/` instead of hardcoding a non-existent patch version (`v22.22.2`).
   - Maintain `~/.local/bin/node`, `~/.local/bin/npm`, `~/.local/bin/npx` as the user-PATH entry points the official installer creates.
   - Detect existing legacy `~/.hermes/runtime/node` directories and migrate to the canonical path.

2. Make the WhatsApp adapter preflight impossible to miss the managed Node
   - Point `~/.hermes/bin/node` shim at the canonical `~/.hermes/node/bin/node`.
   - Persist `NODE`, `NODE_BIN`, `HERMES_NODE_BIN`, `WHATSAPP_NODE_BIN`, and `PATH` overrides via the managed env block in `~/.hermes/.env` so `materializeHermesEnv()` cannot strip them.
   - Patch every plausible adapter location, not just one path:
     - `~/.hermes/hermes-agent/gateway/platforms/whatsapp.py`
     - venv editable/source path equivalents
     - any matching `site-packages/gateway/platforms/whatsapp.py`
   - The patch must rewrite both `subprocess.run(["node", "--version"…])` (preflight) and `subprocess.Popen(["node", …])` (bridge launch) to use `_ronbot_node_bin()`.
   - Add an audit check that reports which adapter file the gateway will load and whether the preflight path was actually patched.

3. Run the entire WhatsApp/messaging runtime prep automatically during install
   - After Hermes install verification, run base Hermes-style Node prep, write the shim, patch the adapter, and run `npm install` in `~/.hermes/hermes-agent/scripts/whatsapp-bridge` automatically.
   - Reuse the upstream-style sentinel checks for `@whiskeysockets/baileys`, `express`, `qrcode-terminal`, `pino`.
   - Use the canonical `~/.hermes/node/bin/npm` for the install.
   - Remove all "click to repair" UX from the wizard. The wizard must run prep silently as part of setup; only show progress, not action buttons.
   - When a step legitimately requires sudo (apt build tools, `npx playwright install --with-deps`, `hermes gateway install --system`), use the existing sudo prompt UI to ask for the OS password once and pass it through.

4. Make gateway replace/start follow Hermes docs and self-heal Slack/WhatsApp blockers
   - On WSL/no-systemd hosts: stop existing gateway processes via `hermes gateway stop`, then proceed with `hermes gateway run --replace` exactly as the docs recommend for foreground/background mode.
   - On systemd hosts: use `hermes gateway install` + `hermes gateway start`/`restart` as documented.
   - Before starting, clear stale scoped lock files left by prior gateway PIDs (matching upstream `release_all_scoped_locks` behavior).
   - When startup output contains `Slack app token already in use (PID N)`, terminate that PID, drop the matching `gateway-locks/*.lock` records that reference it, and retry `start` once.
   - Centralize all of this inside `startGateway()` so every entry point (channel finalize, bootstrap, manual restart) self-heals identically.

5. Improve diagnostics so the next failure is actionable instead of repeating the same generic message
   - Add diagnostics for: `command -v node` inside the same WSL shell the gateway uses, `~/.local/bin/node` symlink target, `~/.hermes/bin/node` target, `~/.hermes/node/bin/node --version`, adapter patch status, bridge dependency import status, and active gateway PIDs + their command lines + lock files referencing Slack/WhatsApp.
   - When WhatsApp startup still fails, surface the first failing diagnostic instead of "WhatsApp bridge runtime is not configured".

6. UI cleanup so users never have to run repairs
   - Remove the “Restart messaging gateway” button on the WhatsApp channel card (per earlier user request).
   - Keep the “Reset WhatsApp” button greyed out until the channel card is re-created via Setup (per earlier user request).
   - Remove any remaining manual repair affordances in the wizard now that prep is automatic.

7. Tests to add/update
   - Update `parseWhatsAppBridgeAudit` tests for canonical `~/.hermes/node` paths.
   - Add tests for parsing Slack conflict + stale lock cleanup signals end-to-end.
   - Add tests asserting the runtime script resolves the latest Node 22 release dynamically (no hardcoded missing patch version).
   - Add tests asserting the adapter patch rewrites both `subprocess.run(["node", "--version"…])` and `subprocess.Popen(["node", …])` patterns.

Expected result:
- A fresh Ronbot/Hermes install prepares Node, npm, the WhatsApp bridge, and any other Hermes-managed pieces during installation, exactly as Hermes documents.
- Pairing no longer relies on a manual repair button or post-failure repair loop.
- Gateway startup in WSL replaces existing gateway processes and stale Slack locks deterministically.
- The WhatsApp adapter's official preflight finds Node, creates the WhatsApp adapter, and starts the Baileys bridge from the saved session.
- Sudo is requested once via the existing OS prompt only when a step genuinely requires root, never to ask the user to perform a manual workaround.