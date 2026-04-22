

# Agent Permissions & Approval System

## Problem
The Hermes agent has a permission prompt for any "side-effect" action (running a shell command, writing a file, fetching from the web, etc.):

```
[o]nce  |  [s]ession  |  [a]lways  |  [d]eny
Choice [o/s/a/D]:
```

Right now Ronbot closes the agent's stdin (`</dev/null`), so every prompt auto-times-out to **deny**. The prompt text is also filtered out of the chat view, so you never even see it. That's why your QA task failed silently — every command it tried was denied behind your back.

## What we'll build

### 1. New "Permissions" settings panel
A dedicated **Settings → Permissions** section with toggle-driven defaults the agent will follow without asking:

- **Shell commands** — Ask each time / Allow read-only (`ls`, `cat`, …) / Allow all
- **File reads** — Ask / Allow inside chosen folders / Allow anywhere
- **File writes** — Ask / Allow inside chosen folders / Allow anywhere
- **Internet access** — Ask / Allow / Deny
- **Python / script execution** — Ask / Allow / Deny
- **Sub-agent spawning** — Ask / Allow / Deny
- **Default action when no rule matches** — Deny (safe) / Ask / Allow (trusted)
- **Allow-listed folders** — list of paths the agent can freely read/write in (e.g. `~/Documents/RonbotWork`)
- **Block-listed folders** — paths the agent must never touch (e.g. `~/.ssh`, `~/.hermes`)

These get persisted (localStorage + `~/.ronbot/settings.json`, same as the rest of the prefs) and mirrored into Hermes via `~/.hermes/config.yaml` keys + env vars on every chat call (so the agent itself enforces the rule and skips its own prompt when the answer is pre-decided).

### 2. Live approval dialog
When a request hits "Ask each time", instead of silently denying:

- Ronbot detects the `Choice [o/s/a/D]:` line in the streamed output.
- A glass modal slides in showing:
  - **What** the agent wants to do (e.g. "Run shell command: `python3 scripts/qa_processor.py`")
  - **Why** (the agent's stated reason / current task step)
  - **Risk badge** (Low / Medium / High based on the action class)
  - Four buttons: **Once** · **This session** · **Always** · **Deny**
- If `desktopNotifications` is on and the window isn't focused, fire a system notification ("Ron is waiting for your approval").
- The Agent Chat sidebar entry shows a pulsing "⏳ Awaiting approval" badge.
- The choice is written back to the agent's stdin and the run continues.
- "Always" choices also update the relevant Permissions setting so future sessions remember.

### 3. In-chat permission events
Inside the chat thread we'll render a compact, non-intrusive system bubble for each permission event so you can see history:

```
🔐 Approved (session): run command  python3 scripts/qa_processor.py
🚫 Denied: write file  /etc/hosts
```

These are interleaved with assistant messages so the conversation tells the full story.

### 4. Terminal tab integration
The Terminal page gets a small "Agent activity" feed at the top showing the same permission events live, plus the raw approval prompts as they arrive — so power users can watch what the agent is asking for in real time.

### 5. Wire stdin properly
Replace `</dev/null` on the `hermes chat` invocation with an attached stdin pipe. The Electron main process keeps the handle open for the lifetime of the run so we can write `o\n`, `s\n`, `a\n` or `d\n` in response to detected prompts.

## Files we'll touch

- `src/contexts/SettingsContext.tsx` — add `permissions` substructure to `AppSettings` with sensible safe defaults.
- `src/pages/SettingsPage.tsx` — new "Permissions" section with the toggles + folder list editors.
- `src/contexts/PermissionsContext.tsx` *(new)* — global event bus for pending approval requests, history, and the modal trigger.
- `src/components/permissions/ApprovalDialog.tsx` *(new)* — the four-button modal.
- `src/components/permissions/PermissionEventBubble.tsx` *(new)* — chat-thread system message.
- `src/lib/systemAPI/hermes.ts` — detect approval prompts in streamed output, expose a `respondToPrompt(streamId, choice)` helper, write Permissions settings into `~/.hermes/config.yaml` before each chat call, drop `</dev/null`.
- `electron/main.cjs` + `electron/preload.cjs` — new IPC channel `agent:write-stdin` so the renderer can answer prompts.
- `src/contexts/ChatContext.tsx` — surface detected prompts to PermissionsContext, render permission events in the message stream.
- `src/pages/TerminalPage.tsx` — subscribe to PermissionsContext for the live activity feed.
- `src/lib/diagnostics.ts` — new `agentLogs` source `'permission'` so events show up in Logs too.

## Defaults (safe out of the box)
- Shell / writes / internet / scripts → **Ask each time**
- File reads → **Allow inside `~/Documents`, `~/Downloads`, project folders; ask elsewhere**
- Block list seeded with `~/.ssh`, `~/.hermes`, `~/.aws`, `~/.config`
- Default fallback → **Ask**

You can flip everything to "Allow" in two clicks if you want headless autonomy, but you'll always have informed consent as the default.

