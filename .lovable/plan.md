Research findings:

- Hermes documentation confirms Windows is not supported natively; Hermes must run inside WSL2, while Ronbot can be the Windows desktop UI that routes commands into WSL.
- Hermes WhatsApp docs say the WhatsApp bridge is a built-in Baileys bridge, installed by `hermes whatsapp`, and session data lives at `~/.hermes/platforms/whatsapp/session`.
- Hermes FAQ specifically warns that WSL systemd is unreliable and recommends foreground mode (`hermes gateway run`) when `hermes gateway start` / services fail.
- I found an upstream Hermes issue that matches this exact error pattern: interrupted or partial WhatsApp bridge npm install leaves `node_modules/` present, so older checks say “already installed”, but Baileys is incomplete and imports fail. Upstream PRs #13448/#13499 fixed this by checking dependency sentinel files, not just `node_modules/` existence.
- The current Ronbot repair is close, but it still needs to be hardened against this upstream partial-install case and should patch the installed Hermes adapter/runtime behavior so the gateway itself cannot skip repair when `node_modules/` is present but broken.

Plan:

1. Add an upstream-compatible WhatsApp bridge dependency health check
   - In `src/lib/systemAPI/hermes.ts`, add a shell helper that marks the bridge install unhealthy when any required direct dependency is missing or stale:
     - `node_modules/@whiskeysockets/baileys/package.json`
     - Baileys actual entry from its `package.json` (`lib/index.js` for current Baileys)
     - `node_modules/express/package.json`
     - `node_modules/qrcode-terminal/package.json`
     - `node_modules/pino/package.json`
     - `node_modules/.package-lock.json` missing or older than `package-lock.json`
   - Stop relying on “Baileys directory exists” as a healthy signal.

2. Make repair always do a clean, verified install when the bridge is partial
   - Update `ensureWhatsAppBridgeDeps()` so if the health check fails it:
     - stops any WhatsApp bridge process using that folder,
     - removes partial `node_modules` and stale lock artifacts when needed,
     - runs managed npm from the managed Node runtime,
     - uses long timeout + heartbeat,
     - verifies dependency sentinel files and an ESM dynamic import after install,
     - returns failure immediately if verification still fails, with the real npm/import error.
   - Keep the output visible in the wizard so the user can see if npm/git/network is the real blocker.

3. Patch the installed Hermes WhatsApp adapter for partial installs
   - Extend the existing adapter patch in `patchHermesWhatsAppAdapterForNode()` or add a companion patch so the installed Hermes `gateway/platforms/whatsapp.py` uses upstream’s dependency-sentinel check instead of only checking whether `node_modules` exists.
   - This prevents the running gateway from reusing a broken partial bridge even if Ronbot’s preflight misses something.

4. Align managed runtime with Hermes requirements
   - Review the managed Node version constant. Hermes installer/docs now expect Node 22 for the general install path, while Baileys requires Node >=20.
   - Either keep Node 20.19.2 if tests confirm it is enough, or move the managed runtime to Node 22 LTS to match Hermes’ installer and reduce version mismatch risk.
   - Update audit labels/error text accordingly so the UI does not claim the wrong runtime requirement.

5. Make WSL/no-systemd gateway startup follow Hermes docs directly
   - In `startGateway()` detect WSL without operational systemd before calling service commands.
   - For that case, skip `hermes gateway start/install` and run:
     ```text
     nohup hermes gateway run --replace >/tmp/hermes-gateway.log 2>&1 &
     ```
   - Verify with `pgrep` and health checks, not systemctl.
   - Keep service-based start for Linux/macOS environments where it is actually supported.

6. Improve the audit message at the failure point
   - Update `auditWhatsAppBridgeRuntime()` to report the exact missing/broken sentinel, e.g. “Baileys package.json exists but lib/index.js is missing — partial npm install”.
   - Include a concise “what Ronbot tried” summary and the last npm/import error so we can distinguish:
     - partial install,
     - npm registry/network failure,
     - GitHub dependency fetch failure,
     - Node version mismatch.

7. Update tests
   - Add tests covering:
     - `node_modules/` exists but Baileys package/entry is missing,
     - stale `package-lock.json` vs `node_modules/.package-lock.json`,
     - ESM import failure triggers clean reinstall,
     - WSL without systemd uses foreground/background gateway mode instead of service mode.

Expected result:

- Clicking “Repair runtime only” or “Re-pair + Restart” should no longer loop on the same “Managed Node cannot load @whiskeysockets/baileys” message.
- If the bridge install is partial, Ronbot will detect it as partial, cleanly reinstall, verify Baileys is actually importable, and only then continue.
- If npm/git/network is failing, the UI will show that as the real blocker instead of continuing to the generic bridge-not-ready error.
- WSL desktops without systemd will use Hermes’ documented foreground/background gateway mode rather than service startup.

<lov-actions>
<lov-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</lov-link>
</lov-actions>