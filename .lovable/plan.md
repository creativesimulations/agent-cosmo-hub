# WhatsApp Bridge Runtime Fix — Final Plan

## Goal
Permanently fix the Baileys `crypto.subtle` crash by ensuring the Hermes gateway and any spawned bridge subprocesses always use Node 20+, surviving service restarts and gateway reinstalls.

## Strategy

Single source of truth: a **managed Node 20 runtime** at `~/.hermes/bin/` that is enforced at three layers (shim, service env, adapter patch). Designed to be idempotent — safe to re-run on every pairing attempt.

## Implementation

### 1. `src/lib/systemAPI/hermes.ts` — new `repairWhatsAppGatewayRuntime()`

One atomic, idempotent repair routine that returns a structured `{ ok, steps, diagnostics }` result. Steps:

1. **Detect platform** (`uname`) — Linux uses systemd user units, macOS uses launchd. Windows is not supported for the bridge; fail fast with a clear message.
2. **Install Node 20** into `~/.hermes/runtime/node-v20/` if missing:
   - Download official Node 20 LTS tarball matching arch (`x64` / `arm64`).
   - Extract to a versioned directory; keep older versions for rollback.
   - Verify via `<dir>/bin/node -e "console.log(!!globalThis.crypto.subtle)"` — must print `true`.
3. **Create shims** at `~/.hermes/bin/{node,npm,npx}` using `printf` (NOT heredoc) so `"$@"` is preserved literally:
   ```
   #!/usr/bin/env bash
   exec "$HOME/.hermes/runtime/node-v20/bin/node" "$@"
   ```
   `chmod +x` each. Verify shim with the same `crypto.subtle` probe before continuing.
4. **Systemd drop-in** (Linux) at `~/.config/systemd/user/hermes-gateway.service.d/10-ronbot-whatsapp-node.conf`:
   ```
   [Service]
   Environment=PATH=%h/.hermes/bin:%h/.local/bin:/usr/local/bin:/usr/bin:/bin
   Environment=WHATSAPP_NODE_BIN=%h/.hermes/bin/node
   Environment=NODE=%h/.hermes/bin/node
   ```
   Then `systemctl --user daemon-reload`. Drop-ins survive `hermes gateway install` because the base unit is untouched.
5. **launchd plist patch** (macOS): write `~/Library/LaunchAgents/com.ronbot.hermes-gateway.path.plist` that prepends `~/.hermes/bin` to `PATH` and sets `WHATSAPP_NODE_BIN`; `launchctl load -w`.
6. **Adapter hardening**: patch `~/.hermes/hermes-agent/scripts/whatsapp-bridge/run.sh` (create if absent) and the Python adapter `whatsapp.py` to:
   - Honor `WHATSAPP_NODE_BIN` env var when spawning.
   - Fall back to `~/.hermes/bin/node` if env var missing.
   - Patch is idempotent (marker comment `# RONBOT_NODE_PATCH_V2`).
7. **Bridge `node_modules` rebuild check**: if `package-lock.json` mtime > `node_modules/.package-lock.json` mtime, run `~/.hermes/bin/npm ci` inside the bridge dir to ensure native modules match Node 20 ABI.
8. **Rotate stale logs** before restart: move `~/.hermes/logs/bridge.log` and `gateway.log` to `*.log.prev` so the UI's failure classifier doesn't read old Node 18 stack traces.
9. **Restart gateway**: `systemctl --user restart hermes-gateway` (or `launchctl kickstart -k`).
10. **Post-restart verification**: poll `~/.hermes/logs/gateway.log` for "ready" marker AND probe the running gateway PID's `/proc/<pid>/environ` (Linux) to confirm `PATH` starts with `~/.hermes/bin`.

Each step records to the `steps` array with `{name, ok, detail}` for UI display.

### 2. `src/lib/systemAPI/hermes.ts` — failure classifier

New `classifyWhatsAppFailure(logs)`:
- **`runtime`** — log contains `globalThis.crypto`, `Cannot destructure property 'subtle'`, `Node.js v18`, or `requires Node`.
- **`session`** — `Connection Failure`, `logged out`, `restartRequired`, `loggedOut`.
- **`network`** — `ECONNREFUSED`, `ETIMEDOUT`, `getaddrinfo`.
- **`unknown`** — everything else.

Returns `{ kind, suggestedAction: "repair-runtime" | "re-pair" | "retry" | "manual" }`.

### 3. `src/components/channels/ChannelWizard.tsx` — flow update

- After pairing succeeds, **don't auto-finalize** until `gateway.log` shows the bridge process is alive AND the failure classifier returns clean for 5 consecutive seconds.
- Replace single "Re-pair + Restart" button with two clearly-labeled actions based on classifier output:
  - **"Repair runtime + restart gateway"** → calls `repairWhatsAppGatewayRuntime()`, streams steps to the diagnostics panel.
  - **"Re-pair WhatsApp"** → existing pairing flow (only offered for `session` failures).
- Wizard close logic: only auto-close after verification passes. If verification fails, show diagnostics + repair button and stay open.
- Diagnostics panel always shows: managed Node version, shim path resolution, gateway service `PATH`, last 20 lines of `bridge.log`.

### 4. `src/pages/Channels.tsx`

- Surface the runtime health badge (green = managed Node detected in service env, amber = shim present but service not using it, red = shim missing). Click → opens repair flow without re-pairing.

## Answers to your two questions

**Where to install Node for the whole app?**
`~/.hermes/runtime/node-v20/` with shims at `~/.hermes/bin/`. Reasons:
- User-scoped (no sudo needed, works on locked-down Linux).
- Survives Hermes gateway reinstalls (lives outside `~/.hermes/hermes-agent/`).
- Shim layer means we can swap Node versions without touching anything that calls `node`.
- `~/.hermes/bin` prepended to `PATH` covers gateway, bridge, npm postinstall scripts, and any future Node-based adapter.

**Use only the newest version, skip multi-version management?**
**Yes — for the bridge.** Pin a single managed Node 20 LTS. Rationale:
- Baileys, Ronbot's own scripts, and every modern adapter all work on Node 20.
- Multi-version managers (nvm, fnm, volta) add a shell-init dependency that systemd/launchd services don't load — they're the reason this bug exists in the first place.
- Single pinned version = one PATH entry, one shim set, one upgrade path. We bump it from Ronbot's updater when Node 22 LTS lands.
- The user's system Node v18 stays untouched for any non-Ronbot tools they rely on.

## Files to edit
- `src/lib/systemAPI/hermes.ts` — add `repairWhatsAppGatewayRuntime`, `classifyWhatsAppFailure`, runtime health probe.
- `src/lib/systemAPI/index.ts` — export new functions.
- `src/components/channels/ChannelWizard.tsx` — verification gate, dual-action error UI, diagnostics panel.
- `src/pages/Channels.tsx` — runtime health badge + repair entry point.
- `.lovable/plan.md` — record decision.
