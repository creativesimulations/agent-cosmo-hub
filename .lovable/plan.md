

## Diagnosis: why nothing reaches the agent

The error in your Diagnostics panel is the smoking gun:
```
materializeEnv failed: cp: missing destination file operand after '/mnt/c/Users/Kadosh/.ainoval/tmp/write-xxx.dat'
chmod: missing operand after '600'
```

That filename pattern (`write-<stamp>.dat`) is built by `writeHermesFile` in `src/lib/systemAPI/hermes.ts` (line 153). It's the function the chat path uses to materialize `~/.hermes/.env` before every chat.

### Root cause: cmd.exe is eating the destination argument

`writeHermesFile` on Windows builds this script and passes it through `cmd.exe → wsl bash -lc "..."`:

```bash
TARGET="$HOME/.hermes/.env"
mkdir -p "$(dirname "$TARGET")"
cp "/mnt/c/.../write-xxx.dat" "$TARGET"
chmod 600 "$TARGET"
```

The whole script is wrapped in **outer double quotes** for `wsl bash -lc "<script>"`. But the script itself contains many **inner double quotes** (`"$HOME/.hermes/.env"`, `"$(dirname "$TARGET")"`, the `cp` operands, etc.). `cmd.exe` does not honor backslash-escaping of `"` — every inner `"` closes the outer argument prematurely.

Result: by the time bash sees the command, `cp`'s second argument and `chmod`'s argument have been chopped off → the materialization aborts → `~/.hermes/.env` is never written → the agent has no `OPENROUTER_API_KEY` → "No inference provider configured."

The local-model error has the **same root cause**: even local providers fail because materializeEnv crashes early (`set -e` in chat script aborts before any model logic runs), and even when it doesn't abort, the chat code's diagnostics show the env wasn't sourced.

We previously fixed this exact bug in `secretsStore.materializeEnv` by base64-encoding the script before handing it to cmd.exe. `writeHermesFile` was never given the same treatment — so every `writeConfig` / `materializeHermesEnv` / `setEnvVar` call on Windows is broken in the same way.

### Why the LLM Config tab also says "No API key found"
That tab reads the materialized `~/.hermes/.env` to verify the key is present. Since materialization silently fails on Windows, the file never contains the key the user just added → false "missing key" warning, even though it's correctly stored in the OS keychain.

---

## The fix

### 1. Make `writeHermesFile` cmd-safe on Windows (the actual bug)
In `src/lib/systemAPI/hermes.ts`, the Windows branch of `writeHermesFile` will be rewritten to base64-encode the entire bash script before passing it through cmd.exe — same pattern that already works for `runHermesShell`. cmd.exe then sees only safe characters (`echo <b64> | base64 -d | bash`), and bash receives the script intact with all its nested quotes preserved.

This single change unblocks: `materializeHermesEnv`, `writeConfig`, `setEnvVar`, `removeEnvVar`, and the install flow's first-time config write.

### 2. Add a persistent, user-visible diagnostics layer
Right now diagnostics only appear inline in failed chat bubbles. We will add:

- **A "Diagnostics" page** (new route `/diagnostics`, sidebar entry under Settings) that shows:
  - Last materialization attempt: timestamp, result, full stderr/stdout
  - Current contents of `~/.hermes/.env` (key names + value lengths only — never the raw secret)
  - Current `~/.hermes/config.yaml` model line
  - Output of a one-click "Run hermes doctor" button
  - Output of a one-click "Test chat round-trip" button (sends "ping", shows full raw stdout/stderr)
- **A rolling in-memory log buffer** (`src/lib/diagnostics.ts`) that every shell call in `systemAPI` appends to: `{ timestamp, label, command, exitCode, stdout, stderr, durationMs }`. Capped at the last 200 entries. Viewable + copy-to-clipboard + download-as-text from the Diagnostics page.
- **Toast on materialize failure** anywhere in the app (not just chat), with a "View diagnostics" action that deep-links to the page.

### 3. Tighten the chat error path
- When materialization fails, the chat bubble will show a hard error ("Failed to sync secrets to agent — open Diagnostics") instead of the misleading "No API key found" CTA.
- Stop attempting to call `hermes chat` at all if materialization failed; the result is guaranteed wrong and the noisy banner only confuses things further.

### 4. Defensive verification step
After every materialize, immediately read `~/.hermes/.env` back and assert the expected keys are present (length > 0). If not, surface a clear error rather than letting the chat run against a stale/empty env.

---

## Files touched

```text
src/lib/systemAPI/hermes.ts          (fix writeHermesFile Windows path,
                                      tighten chat materialize-fail handling,
                                      add post-write verification)
src/lib/diagnostics.ts               (new — in-memory log buffer + helpers)
src/lib/systemAPI/core.ts            (hook runCommand/runCommandStream into
                                      the diagnostics buffer)
src/pages/Diagnostics.tsx            (new — diagnostics dashboard)
src/components/layout/AppSidebar.tsx (add "Diagnostics" nav entry)
src/App.tsx                          (register /diagnostics route)
src/pages/AgentChat.tsx              (clearer error bubble + link to Diagnostics
                                      when materialize fails)
```

## How you'll verify it worked

1. Open the new **Diagnostics** page → click "Sync secrets now" → see "OK, wrote N keys to ~/.hermes/.env" with the file contents listed (key names only).
2. Switch back to **Agent Chat** with OpenRouter selected → send "hi" → get a real reply.
3. Switch model to your local Qwen → send "hi" → get a real reply (no key needed for local).
4. If anything still fails, the Diagnostics page will show the exact shell command that ran, its exit code, and full stdout/stderr — so we can pinpoint any remaining issue in one screenshot.

