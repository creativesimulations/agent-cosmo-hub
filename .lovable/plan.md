## What is actually broken

The error in your wizard is unambiguous:

```
.../@whiskeysockets/baileys/lib/Utils/crypto.js:6
const { subtle } = globalThis.crypto;
                            ^
TypeError: Cannot destructure property 'subtle' of 'globalThis.crypto' as it is undefined.
Node.js v18.19.1
```

Two facts matter:

1. The crash happens in **Node v18.19.1** — your system Node. Baileys (current Whiskeysockets build) loads `globalThis.crypto.subtle` at module top-level. Node only exposes `globalThis.crypto` to ES modules starting at **v19+** (and reliably in v20 LTS). On v18.19.1 it is `undefined`, so the bridge dies before it can connect.
2. The Ronbot pair-only call already uses the managed Node v20.19.2. So pairing succeeds and `creds.json` is saved. But once the wizard restarts `hermes gateway`, the **gateway service** spawns `bridge.js` itself using whatever `node` is on the service unit's PATH — which is the system `node` (v18.19.1). It crashes, systemd/launchd restarts it, it crashes again — that's why you see the same stack trace pasted four times.

So the agent does not "see" WhatsApp because the bridge process is in a crash loop. The session is good; the runtime is wrong.

A second smaller issue: the pair-only fallback path (`hermes whatsapp` via `script`) and the gateway both inherit the snapshot PATH captured by `hermes gateway install`. If that snapshot was taken before the managed Node was prepended, the gateway will keep using v18.

## Fix plan

All changes are in `src/lib/systemAPI/hermes.ts`, with small UX tweaks in `ChannelWizard.tsx` and `Channels.tsx`.

### 1. Force the gateway to use managed Node v20 for the bridge

Hermes' bridge invocation honors a `NODE` / `NODE_BIN` env var (and otherwise falls back to whatever `node` is first on PATH). We will:

- Write a small launcher shim at `~/.hermes/bin/node` that `exec`s the managed `$NODE_RUNTIME_HOME/bin/node "$@"`.
- Prepend `~/.hermes/bin` to PATH inside `~/.hermes/.env` via a new `PATH=...` line *and* via the gateway service environment.
- Add explicit overrides to `~/.hermes/.env` so Hermes picks the right binary regardless of PATH:
  - `HERMES_NODE_BIN=$HOME/.hermes/runtime/node-v20.19.2-linux-x64/bin/node`
  - `WHATSAPP_NODE_BIN=$HOME/.hermes/runtime/node-v20.19.2-linux-x64/bin/node`
  - `NODE=$HOME/.hermes/runtime/node-v20.19.2-linux-x64/bin/node`
- After writing `.env`, run `hermes gateway install` again so the service unit re-snapshots PATH with `~/.hermes/bin` first, then `hermes gateway start`.

### 2. Self-heal: detect and replace bad system Node at runtime

Before starting the gateway, run a probe:

```bash
node -e "process.exit(globalThis.crypto && globalThis.crypto.subtle ? 0 : 42)"
```

against whatever Node is first on the gateway's effective PATH. If it returns 42 (or the binary reports < v20), abort the wizard with a clear actionable error and offer to reinstall the managed runtime via the existing `ensureManagedNodeRuntime` flow before retrying. This means the user will never reach the crash loop again.

### 3. Stop the existing crash loop cleanly before restart

The current `terminateWhatsAppPairingProcesses` deliberately leaves the gateway-managed `bridge.js` running. With a v18 crash loop in flight, we must:

- `hermes gateway stop`
- `pkill -f "whatsapp-bridge/bridge.js"` (any mode, not just `--pair-only`)
- wait for port 3000 to free, then `hermes gateway start`
- poll `hermes gateway status` until WhatsApp shows as connected (existing helper).

### 4. Surface the real reason in the wizard

Right now the wizard shows a wall of repeated stack traces under "Channel setup needs attention." Replace that with a structured `ActionableError`:

- Title: "WhatsApp bridge crashed (Node version too old)"
- Summary: "Hermes is spawning the bridge with Node 18.19.1, which doesn't expose `globalThis.crypto.subtle`. Baileys requires Node 20+."
- "Show details" reveals the raw stack.
- "Fix Automatically" button runs steps 1–3 above.

Also extend `getWhatsAppGatewayHealth` to detect the specific signature `Cannot destructure property 'subtle'` in the bridge log tail and tag the channel card attention reason as **"Bridge running on wrong Node version — click to repair"**.

### 5. Verify pairing flow still passes the right Node

The pair-only call already uses `$NODE_RUNTIME_HOME/bin/node`. We will assert at the top of the script that `"$NODE_BIN" -p "process.versions.node"` starts with `20.` and abort with a clear message otherwise (instead of silently falling back to system node).

### 6. Other things found while investigating

- Email IMAP authentication failures in your gateway log are unrelated to WhatsApp (Gmail rejecting the password — likely needs an App Password). We will not change the email flow, but we will stop showing email log noise inside the WhatsApp wizard's "Show details" panel; only WhatsApp-tagged log lines will be displayed.
- Slack "missing scope" log lines are also unrelated and will be filtered out of the WhatsApp diagnostics view.

## Files touched

- `src/lib/systemAPI/hermes.ts` — managed-Node shim creation, `.env` overrides, Node version probe, crash-loop-aware restart sequence, gateway log filter for WhatsApp-only lines, bridge crash detection.
- `src/components/channels/ChannelWizard.tsx` — replace raw error dump with `ActionableError` + Auto-Fix button that re-runs the repair sequence.
- `src/pages/Channels.tsx` — new attention reason `"node-version-too-old"` mapped to a clear tooltip and Repair action on the WhatsApp channel card.

## Expected result

After approval and implementation:

1. Wizard re-runs cleanly, pairs WhatsApp, writes `.env` with the managed-Node overrides.
2. Gateway restarts and spawns the bridge with **Node v20.19.2**, so Baileys loads without crashing.
3. `hermes gateway status` lists WhatsApp as connected, the channel card shows **Active**, and messages sent to your bot number are delivered to the agent without any "set up WhatsApp first" reply.
4. If the system ever regresses (e.g. user reinstalls Hermes and the snapshot PATH changes), the wizard's preflight Node probe catches it and offers a one-click repair instead of looping on the cryptic Baileys stack trace.
