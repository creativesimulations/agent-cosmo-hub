## What is still broken

The repeated error proves the previous repair did not affect the process that actually starts the WhatsApp bridge:

```text
Hermes gateway service -> gateway/platforms/whatsapp.py -> subprocess.Popen(["node", bridge.js, ...])
```

Upstream Hermes currently starts the bridge with a hardcoded `"node"` command in `gateway/platforms/whatsapp.py`. It does not read `NODE`, `NODE_BIN`, `HERMES_NODE_BIN`, or `WHATSAPP_NODE_BIN` when launching `bridge.js`.

So the previous plan installed a managed Node v20 shim and wrote env overrides, but the running gateway service is still resolving `node` from its own service-unit PATH. That PATH still points to the system Node v18.19.1, so Baileys crashes before the bridge can connect.

This is not a WhatsApp session/QR issue anymore. Pairing can succeed, but the gateway-managed bridge cannot stay alive because it is launched by Node 18.

## Corrections to implement

### 1. Stop relying on `NODE_BIN` env vars for the gateway bridge

Keep the managed Node runtime, but change the repair strategy to affect what Hermes actually uses: the `node` binary on the gateway service PATH.

`ensureWhatsAppManagedNode()` will be strengthened to:

- Install/verify managed Node v20 if missing.
- Write `~/.hermes/bin/node` as an absolute shim that directly execs the managed runtime path.
- Write the shim without depending on shell variables inside the shim body, so it still works under systemd/launchd/non-interactive shells.
- Verify:
  - `~/.hermes/bin/node --version` is v20+.
  - `PATH="$HOME/.hermes/bin:$PATH" node -e "...globalThis.crypto.subtle..."` succeeds.

### 2. Patch the gateway service definition after Hermes generates it

Because `hermes gateway install` generates a systemd unit / launchd plist with a captured PATH, Ronbot must patch that generated service definition directly.

Add a new service repair helper that, after `hermes gateway install`, detects and patches:

- User systemd: `~/.config/systemd/user/hermes-gateway*.service`
- System systemd if present/readable/writable: `/etc/systemd/system/hermes-gateway*.service` best-effort only
- macOS launchd: `~/Library/LaunchAgents/*hermes*gateway*.plist`

For systemd, ensure the `[Service]` section has:

```text
Environment="PATH=%h/.hermes/bin:...existing path..."
```

For launchd, ensure the `PATH` value starts with:

```text
$HOME/.hermes/bin:
```

Then reload the service manager:

- `systemctl --user daemon-reload`
- `systemctl --user import-environment PATH` / `set-environment PATH=...`
- `launchctl bootout/bootstrap` or rely on `hermes gateway start` after plist rewrite, depending on platform

This directly fixes the path that `subprocess.Popen(["node", ...])` uses.

### 3. Patch the installed Hermes WhatsApp adapter as a fallback

If the service definition still cannot be patched or Hermes regenerates it without the shim path, add a fallback source patch to the installed Hermes adapter at:

```text
~/.hermes/hermes-agent/gateway/platforms/whatsapp.py
```

Patch only the bridge subprocess call so it chooses the managed shim first:

```python
node_cmd = os.getenv("WHATSAPP_NODE_BIN") or os.getenv("NODE_BIN") or shutil.which("node") or "node"
...
subprocess.Popen([node_cmd, str(bridge_path), ...])
```

This patch will be idempotent and backed up once before editing. It is targeted to the installed local Hermes copy under `~/.hermes`, not to project source code.

Why include this fallback: upstream Hermes currently hardcodes `"node"`; service PATH patching is the cleanest fix, but an adapter patch makes the repair robust against service managers that ignore or cache environment changes.

### 4. Change all restart flows to run the real repair first

Update the following flows so they run the strengthened repair before starting/restarting the gateway:

- WhatsApp wizard finalization (`restartWhatsAppGatewayWithNewSession`)
- “Re-pair + Restart” button
- Channel card “Restart messaging gateway” action
- `startGateway()` itself when WhatsApp is enabled/configured
- `refreshGatewayInstall()`

The corrected restart sequence will be:

```text
stop gateway
kill bridge.js crash-loop processes
ensure managed Node shim
hermes gateway install
patch service PATH / launchd plist
patch installed whatsapp.py fallback if needed
reload service manager
start gateway
verify effective node from service/bridge logs
poll WhatsApp health
```

### 5. Add a direct effective-runtime diagnostic

Add a helper that reports:

- `command -v node` with Ronbot’s intended PATH
- `node --version` with Ronbot’s intended PATH
- service unit/plist PATH first entries
- whether `~/.hermes/bin/node` exists and passes `globalThis.crypto.subtle`
- whether installed `whatsapp.py` still contains `Popen(["node", ...])`
- latest bridge log Node version signature

The wizard will use this before showing another generic failure. If the bridge still crashes with Node 18, the UI should say that the service definition could not be rewritten, not just “restart Ronbot”.

### 6. Fix misleading UI guidance

Remove the current guidance that says “managed Node v20 shim installed — retry/restart Ronbot” as if that is enough. Replace it with a specific message based on diagnostics:

- “Gateway service PATH still resolves Node 18”
- “Service unit could not be patched automatically”
- “Installed Hermes WhatsApp adapter still hardcodes node”
- “Bridge is not active even though runtime is correct”

Also keep the raw stack trace hidden behind details and limit repeated duplicate stack traces.

## Other possible causes checked

The provided Hermes docs confirm the normal expected flow:

- `hermes whatsapp` creates/saves the WhatsApp session.
- `WHATSAPP_ENABLED=true` and `WHATSAPP_MODE` must be in `~/.hermes/.env`.
- `hermes gateway` starts the bridge automatically from the saved session.
- `hermes gateway status` is the correct active gateway check.

Other potential blockers after the Node fix:

- Access control: messages will be ignored/denied unless `WHATSAPP_ALLOWED_USERS=*`, `WHATSAPP_ALLOW_ALL_USERS=true`, or the sender number is allowlisted.
- Session invalidation: if WhatsApp unlinked the session, re-pair is needed.
- Bridge dependency drift: if WhatsApp protocol changed, updating Hermes / npm dependencies may be needed.

But the current blocker is still definitively the gateway bridge runtime, because the log continues to show `Node.js v18.19.1`.

## Files to change

- `src/lib/systemAPI/hermes.ts`
  - strengthen managed Node shim
  - add service PATH patch helper
  - add installed adapter fallback patch helper
  - add effective runtime diagnostic helper
  - call repair from gateway start/refresh/restart paths

- `src/lib/systemAPI/index.ts`
  - export the new helper(s)

- `src/components/channels/ChannelWizard.tsx`
  - use the stronger repair during finalization and Re-pair + Restart
  - improve error classification and details

- `src/pages/Channels.tsx`
  - make “Restart messaging gateway” run the WhatsApp runtime repair first
  - show clearer attention reason when Node 18 is still active

- `.lovable/plan.md`
  - update with the corrected diagnosis and implementation notes

## Expected result

After implementation and using “Re-pair + Restart” again:

1. `~/.hermes/bin/node` reports Node v20+ and passes the crypto probe.
2. The gateway service PATH starts with `~/.hermes/bin`.
3. The installed Hermes WhatsApp adapter either resolves the shim via PATH or uses the patched explicit node command.
4. The bridge log no longer contains `Node.js v18.19.1` for new starts.
5. `hermes gateway status` lists WhatsApp as connected/active.
6. The WhatsApp channel card becomes Active, and messages from the configured/allowed WhatsApp number reach Ronbot.

<lov-actions>
  <lov-open-history>View History</lov-open-history>
</lov-actions>

<lov-actions>
<lov-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</lov-link>
</lov-actions>