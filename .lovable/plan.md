Do I know what the issue is? Yes.

The current blocker is still that the running gateway rejects WhatsApp before it creates the WhatsApp adapter. The exact failing condition is the adapter preflight: `check_whatsapp_requirements()` still returns false, which means the gateway process that is actually running still cannot resolve a working Node runtime when it executes `node --version`.

There are also two UI/logging problems making this harder to diagnose:

1. The error detail still appends the raw gateway log, so Slack scope and email IMAP failures leak into the WhatsApp setup error even when those channels should not matter.
2. The adapter patch currently only checks for the marker string, not whether the live imported adapter actually rewrites `check_whatsapp_requirements()` and bridge launch commands. That can produce a false “patched” state while the gateway still imports an unpatched copy.

Plan:

1. Make Node visible to the actual gateway process without relying on fragile adapter patching alone
   - Before starting the gateway, export the official managed Node path into the same shell that launches `gateway run --replace`:
     - `PATH="$HOME/.hermes/node/bin:$HOME/.local/bin:$PATH"`
     - `NODE`, `NODE_BIN`, `HERMES_NODE_BIN`, `WHATSAPP_NODE_BIN` as absolute paths.
   - Keep `~/.hermes/node` and `~/.local/bin/node` aligned with the official installer layout.
   - Do not write a `PATH` override into `.env`; `.env` parsers do not expand `$HOME`/`$PATH` safely.

2. Patch the live Python adapter more deterministically
   - Find every installed `gateway/platforms/whatsapp.py` under `~/.hermes`, including editable source, venv, and site-packages copies.
   - Patch both:
     - `check_whatsapp_requirements()` / `subprocess.run(["node", "--version"...])`
     - bridge launch / `subprocess.Popen(["node", bridge_path...])`
   - Treat the patch as successful only if the file contains both `_ronbot_node_bin()` and at least one rewritten `_ronbot_node_bin(), "--version"` or equivalent preflight replacement.
   - Add diagnostics that report the exact adapter path Python imports with:
     - `python -c "import gateway.platforms.whatsapp as w; print(w.__file__)"`
     - and verify that same file is patched.

3. Add an automatic runtime verification step immediately before gateway start
   - Run these checks in the same shell path used for the gateway:
     - `command -v node`
     - `node --version`
     - `~/.hermes/node/bin/node --version`
     - `~/.local/bin/node --version`
     - `python -c 'from gateway.platforms.whatsapp import check_whatsapp_requirements; print(check_whatsapp_requirements())'`
   - If `check_whatsapp_requirements()` is false, run the runtime prep/adapter patch again and verify once more before starting the gateway.
   - If it still fails, show the failing diagnostic instead of the generic “runtime not configured” message.

4. Stop unrelated Slack/email failures from polluting WhatsApp setup
   - Filter `/tmp/*gateway*.log` content before adding it to the WhatsApp setup error.
   - Keep only WhatsApp-related lines and the direct Node/adapter diagnostics in the primary error.
   - Move Slack/email/Telegram/Discord/Signal lines to a separate collapsed diagnostics section only when that channel is actually enabled by the user.
   - This prevents missing Slack scopes or unused email credentials from making WhatsApp look broken.

5. Fix stale/incorrect enabled-channel state
   - If Slack/email are not intentionally configured, ensure their enabled flags are not accidentally left on from old setup attempts.
   - Add a cleanup step during WhatsApp setup that does not delete credentials, but disables unrelated channels with missing/invalid required config so the gateway does not try to connect them.
   - Preserve intentionally configured channels.

6. Improve WhatsApp “connected” recognition
   - Consider WhatsApp connected when either:
     - the gateway reports WhatsApp active, or
     - the saved WhatsApp session exists and the bridge health endpoint/log confirms a connected session after gateway start.
   - Continue requiring gateway confirmation for “live”, but show “paired, waiting for bridge” instead of failing immediately when the session exists but the adapter is still initializing.

7. Tests
   - Add tests that fail if `.env` contains a literal `PATH="$HOME...:$PATH"` override.
   - Add tests that verify adapter patch success requires the actual preflight replacement, not just a marker comment.
   - Add tests that raw Slack/email gateway lines are not appended to the primary WhatsApp error.
   - Add tests for the pre-start verification parser: imported adapter path, `command -v node`, and `check_whatsapp_requirements=True`.

Expected result:

- The gateway process sees the managed Node runtime before importing WhatsApp.
- `check_whatsapp_requirements()` returns true in the same environment the gateway uses.
- The WhatsApp adapter is created, so Ronbot can recognize the saved WhatsApp connection.
- Slack/email issues no longer appear in the WhatsApp setup error unless the user explicitly configured those channels.

<lov-actions>
<lov-open-history>View History</lov-open-history>
<lov-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</lov-link>
</lov-actions>