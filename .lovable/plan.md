# Approved plan — WhatsApp authorization + adapter patch fix

Status: APPROVED by user. Ready to implement on next build-mode loop.

## Root cause summary

1. `patchHermesWhatsAppAdapterForNode()` builds a Python script as a JS array
   joined with `\n`, embeds it in a bash heredoc, base64-encodes the whole
   bash wrapper, and pipes it through `bash -lc` (and on Windows through
   `wsl` and `cmd.exe`). The mixed JS-string + heredoc + cmd.exe escaping
   produces a malformed Python regex literal:
   `re.sub(r"subprocess\.run\(\s*\[\s*(['"])...)` →
   `SyntaxError: closing parenthesis ']' does not match opening parenthesis '('`.
   Result: every patch run logs `adapter patched=false` / `PATCH_FAILED`,
   so the running gateway adapter still calls bare `node`.
2. Hermes denies messages from `112966246649933@lid` because
   `WHATSAPP_ALLOWED_USERS` is empty/missing in the runtime config and the
   wizard only accepts E.164 digits — not WhatsApp `@lid` / `@s.whatsapp.net`
   JIDs that Hermes actually compares against.
3. `WHATSAPP_ENABLED` and `WHATSAPP_MODE` show as empty in some flows, so
   the channel can finalize visually while the gateway still lacks required
   runtime values.

## Implementation steps

### 1. Rewrite `patchHermesWhatsAppAdapterForNode` with base64 Python payload
- Author the Python patcher as a single normal multi-line JS template
  string (real newlines, real quotes, no `\\s` / `\\[` gymnastics).
- Hoist it to a top-level `WHATSAPP_ADAPTER_PATCH_PY` constant so a unit
  test can compile-check it.
- Bash side: `echo <B64> | base64 -d > $PATCHER && python3 $PATCHER "$F"`.
  No heredoc, no nested quoting.
- Bump the marker to `RONBOT_NODE_BIN_PATCH_V5` so previously
  half-patched files get re-patched cleanly.
- Verify success by checking the rewritten file contains
  `_ronbot_node_bin()` call sites, not just the marker comment.

### 2. JID-aware WhatsApp allowlist
- Add `isValidWhatsAppAllowEntry(value)` accepting:
  - E.164 digits (existing rule)
  - `<digits>@lid`
  - `<digits>@s.whatsapp.net`
- Update `ChannelWizard.tsx` validation + input copy.
- Update `channels.ts` hint text.
- Normalizer keeps user entries verbatim and de-duplicates.

### 3. Auto-capture unauthorized senders from logs
- New `hermesAPI.findUnauthorizedWhatsAppSenders()` that tails
  `/tmp/hermes-gateway.log`, `~/.hermes/platforms/whatsapp/bridge.log`,
  and `~/.hermes/logs/whatsapp-bridge.log` for
  `Unauthorized user: <jid>` lines and returns unique JIDs.
- After WhatsApp finalize fails OR after gateway restart, if any
  unauthorized JIDs are found AND none are in the current allowlist,
  surface a one-click "Authorize this sender" action that appends them
  to `WHATSAPP_ALLOWED_USERS`, materializes env, and restarts gateway.

### 4. Defensive runtime-secret writer
- New `ensureWhatsAppRuntimeSecrets()` that writes:
  - `WHATSAPP_ENABLED=true`
  - `WHATSAPP_MODE=self-chat` if empty
  - `WHATSAPP_DEBUG=true`
  - leaves `WHATSAPP_ALLOWED_USERS` alone if non-empty
- Called from `startGateway()` (when WhatsApp is opted-in) and from the
  wizard finalize path before `materializeEnv`.

### 5. Tests (`hermes.whatsapp-audit.test.ts` + new file)
- Compile-check: write `WHATSAPP_ADAPTER_PATCH_PY` to a temp file, run
  `python3 -c "compile(open(p).read(),p,'exec')"` via `child_process`.
  Skip gracefully if `python3` is unavailable in CI.
- End-to-end patcher test on a fixture adapter file containing
  `subprocess.run(["node","--version"])` and
  `subprocess.Popen(["node", bridge_path])`. After running the patcher
  the file must contain `_ronbot_node_bin()` call sites.
- Unit test for `isValidWhatsAppAllowEntry`: digits, `@lid`,
  `@s.whatsapp.net` accepted; `+15551234567`, `foo@bar`, empty rejected.
- Unit test for the unauthorized-sender log parser: extracts
  `112966246649933@lid` from a sample log line.

## Files to change
- `src/lib/systemAPI/hermes.ts` — patcher rewrite, runtime-secrets helper,
  unauthorized-sender parser, `WHATSAPP_ADAPTER_PATCH_PY` constant.
- `src/lib/channels.ts` — JID-aware hint copy.
- `src/components/channels/ChannelWizard.tsx` — JID-aware validation,
  "Authorize this sender" UI on finalize failure.
- `src/lib/systemAPI/hermes.whatsapp-audit.test.ts` (extend) and a new
  `hermes.whatsapp-patch.test.ts` for the Python-payload tests.

## Expected outcome
- `adapter patched=false` / `PATCH_FAILED` disappear.
- `112966246649933@lid` is accepted and stored in
  `WHATSAPP_ALLOWED_USERS` (manually or via auto-detect).
- `WHATSAPP_ENABLED`, `WHATSAPP_MODE`, `WHATSAPP_ALLOWED_USERS` are all
  present in `~/.hermes/.env` before the gateway starts.
- The gateway stops rejecting messages and Ron replies on WhatsApp.
