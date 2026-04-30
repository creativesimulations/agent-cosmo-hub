Yes — I now think the persistent error is very likely caused by a Windows/WSL environment split, not by the QR pairing itself.

The app being installed under:

```text
C:\Users\Kadosh\agent-cosmo-hub\electron-release\Ronbot-win32-x64
```

while Hermes lives under:

```text
\\wsl$\Ubuntu\home\kadosh\.hermes
```

is expected. The Electron UI should run as a native desktop app, but every Hermes/agent/gateway/WhatsApp runtime operation must execute inside the same environment where Hermes lives. On Windows, that is WSL.

Do I know what the issue is? Yes: the current implementation routes many Hermes operations through WSL correctly, but the prerequisite/runtime model is still inconsistent. Some checks/install assumptions are host-Windows-oriented, and the finalization path does not perform a single authoritative WSL-side audit proving that the gateway environment can actually run the WhatsApp adapter. So the app can pair successfully with the bridge, then start/verify the gateway in a state where Hermes still cannot see `node`/`npm`/Baileys from the WSL gateway process and reports:

```text
WhatsApp: Node.js not installed or bridge not configured
No adapter available for whatsapp
```

The Slack and Email lines are still unrelated gateway warnings. They should not be displayed as the primary WhatsApp failure.

## Plan

### 1. Make WSL the explicit runtime target on Windows

Add a central helper in `src/lib/systemAPI` so all Hermes prerequisite checks that matter to the agent run in the Hermes environment:

```text
Windows desktop app -> wsl bash -lc "..."
macOS/Linux app     -> bash -lc "..."
```

Then update the prerequisite checks so these are checked inside WSL on Windows, not on the Windows host:

- Python
- pip / venv capability
- Git
- curl
- ripgrep
- Node/npm where relevant to Hermes/WhatsApp

This fixes the misleading case where Windows has a tool installed, but WSL/Hermes does not.

### 2. Stop installing Hermes-critical tools into Windows when Hermes runs in WSL

On Windows, current prerequisite install paths like `winget install Git` or host Python/curl checks are not sufficient for Hermes because Hermes runs inside Ubuntu/WSL.

I will change the UX/logic so Windows installs or repair prompts target WSL for Hermes-critical dependencies. Where automatic install is safe, it should run inside WSL; where admin/sudo is required, the app should give the correct WSL command/in-app sudo path instead of installing only on Windows.

This does not mean the desktop app stops being native Windows. It means only the agent runtime dependencies are installed in the runtime where the agent actually runs.

### 3. Add a WSL-side WhatsApp bridge readiness audit before finalization

Add a new `auditWhatsAppBridgeRuntime()` / equivalent function in `src/lib/systemAPI/hermes.ts` that runs inside the Hermes environment and verifies all of this in one command:

```text
$HOME is /home/kadosh, not C:\Users\Kadosh
~/.hermes/hermes-agent/scripts/whatsapp-bridge exists
bridge.js exists
package.json exists
managed node exists and is v20+ / v22+
npm exists in the same managed runtime
node_modules/@whiskeysockets/baileys exists
node can import/load the bridge dependency from the bridge directory
~/.hermes/platforms/whatsapp/session/creds.json exists after pairing
~/.hermes/.env contains WHATSAPP_ENABLED=true and access-control keys
```

If any check fails, the wizard will show the exact failing WSL path and run the correct repair step instead of relying on generic gateway log classification.

### 4. Make the runtime repair truly self-healing

Update WhatsApp repair/finalization so it does not assume the managed Node runtime already exists.

The repair order should be:

```text
1. Ensure Hermes-managed Node runtime exists inside WSL/macOS/Linux
2. Write ~/.hermes/bin/node/npm/npx shims inside the same environment
3. Install/repair WhatsApp bridge npm dependencies in ~/.hermes/hermes-agent/scripts/whatsapp-bridge
4. Prove Baileys can be resolved by that exact node process
5. Patch Hermes WhatsApp adapter to prefer the managed node binary
6. Rotate logs
7. Restart gateway
8. Re-run the WSL-side audit
```

This closes the gap where `ensureWhatsAppManagedNode()` can fail early or claim shim success while the bridge still is not usable from the gateway’s environment.

### 5. Fix gateway startup mode for Windows/WSL

For Windows, the gateway should not depend on Windows services or Windows PATH. It should start Hermes through WSL and either:

- use the WSL user service only if available and configured, or
- reliably use the foreground/background `hermes gateway run --replace` fallback inside WSL.

I will update the gateway refresh/start/verify logic so the app clearly treats Windows as “desktop UI + WSL runtime”, not as native Windows Hermes.

### 6. Improve diagnostics and error display

When finalization fails, the primary card should show only WhatsApp runtime/audit failures. Slack and Email warnings will remain available in a collapsed “Other gateway logs” section.

The new failure message should be specific, for example:

```text
WhatsApp bridge dependencies are missing inside WSL:
/home/kadosh/.hermes/hermes-agent/scripts/whatsapp-bridge/node_modules/@whiskeysockets/baileys

Ronbot will install them inside WSL and restart the gateway.
```

or:

```text
Ronbot can run the QR pairing bridge, but the Hermes gateway is starting without the managed Node PATH inside WSL.
```

### 7. Add regression tests for Windows/WSL routing

Add/extend tests to cover:

- Windows host routes Hermes shell commands through `wsl bash -lc`
- prerequisite checks for Hermes-critical tools do not use host Windows commands when Hermes runs in WSL
- WhatsApp finalization runs the readiness audit before declaring failure
- `bridge-not-configured` triggers dependency repair inside WSL
- Slack/Email warnings are not included in the primary WhatsApp error

## Expected result

After this change, the app should behave like this on Windows:

```text
Ronbot UI: native Windows Electron app
Hermes runtime: WSL Ubuntu /home/kadosh/.hermes
Node/npm for WhatsApp: installed and checked inside WSL
WhatsApp session: stored inside WSL ~/.hermes/platforms/whatsapp/session
Gateway: started/restarted from WSL
```

That is the right architecture for cross-platform desktop support. We do not need to install one global newest Node for the whole Windows machine. The safest setup is to use the Hermes/WSL-managed Node runtime for all agent functions on Windows, and equivalent managed/runtime-local Node on macOS/Linux.

<lov-actions>
  <lov-open-history>View History</lov-open-history>
</lov-actions>

<lov-actions>
<lov-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</lov-link>
</lov-actions>