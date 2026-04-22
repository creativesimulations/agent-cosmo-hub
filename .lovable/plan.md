

# Fix permissions, sub-agent visibility, and missing approval prompts

## Three connected bugs

1. **Agent reported "no internet" even though the setting was Allow** — Ronbot's Permissions panel only intercepts prompts in the parent chat's stdout. Hermes's *own* permission engine never gets told, so it falls back to its built-in default (deny) for sub-agents and many parent actions.
2. **Sub-agents tab stayed empty** — `listSubAgents()` greps for log markers that may not match real Hermes output, and silently returns `[]` when `~/.hermes/logs/agent.log` doesn't exist.
3. **No approval modal ever appeared** — when permission is auto-handled by Hermes itself (because we never wrote anything to its config), the `Choice [o/s/a/D]:` prompt may not even be emitted; or when it is, our regex misses variant formats.

## Fix

### A. Mirror the Permissions panel into Hermes's own config (the real fix)

On every `chat()` call, write a managed block into `~/.hermes/config.yaml` derived from `settings.permissions`:

```yaml
# ─── Managed by Ronbot: permissions ───
permissions:
  shell: allow | ask | deny
  file_read: allow | ask | deny
  file_write: allow | ask | deny
  internet: allow | ask | deny
  script: allow | ask | deny
  subagent: allow | ask | deny
  default: ask
  allowed_paths: [~/Documents, ~/Downloads, ...]
  blocked_paths: [~/.ssh, ~/.aws, ...]
# ─── End managed ───
```

- New helper `writeHermesPermissions(perms)` in `hermes.ts` — same managed-block pattern as `.env`.
- Called from `chat()` after `materializeHermesEnv`.
- Also exported as a manual "Sync now" button in Settings → Permissions.
- Diagnostics gets a new "Permissions sent to agent" panel showing the active block, so you can verify it.

This makes sub-agents inherit the same rules without us needing to intercept their stdin.

### B. Make approval prompts actually fire

Make the prompt detector more robust so the modal really opens:

- Broaden `APPROVAL_PROMPT_RE` to also catch variants: `[o]nce/[s]ession/[a]lways/[d]eny`, `Approve? (o/s/a/d)`, `> Permission required`, `Awaiting approval`.
- Capture the **20 lines preceding** the prompt as the dialog's "What" body so the user sees the actual command/path the agent is about to touch.
- Add a debug toggle in Diagnostics: **"Log every prompt detection"** so we can confirm the parser is firing.
- If the agent emits a permission line but our parser misses it, fall back to a generic "Agent is waiting for input" pill in chat with a free-text reply box.

### C. Fix the Sub-Agents tab

Three improvements to `listSubAgents()`:

1. **Broaden log markers**: match `subagent`, `sub_agent`, `sub-agent`, `delegate_task`, `child agent`, `spawned agent`, `worker.start/complete`, plus any line with both `task` and one of `started/completed/failed`.
2. **Add a "Failed" bucket** for denied/error sub-agents with the reason text.
3. **Detect "logging not enabled"**: if `agent.log` is missing AND the parent chat mentioned spawning sub-agents, show a banner on the SubAgents tab:
   > "Sub-agents ran during this chat but Hermes file logging is disabled, so we can't show their details."  
   With a one-click **"Enable file logging"** button that writes `logging.file: ~/.hermes/logs/agent.log` into config.

### D. Live in-chat feedback

While a chat turn is streaming:

- Count `delegate_task` / sub-agent mentions and show a live pill above the message: **"🤖 4 sub-agents working…"** Click → SubAgents tab.
- If the agent's reply contains "no internet" / "permission denied" while the relevant Ronbot setting is **Allow**, render a system bubble:
  > "Agent reported no internet access, but Ronbot's setting is Allow. The permissions block may not have been applied. Open Diagnostics."

## Files touched

- `src/lib/systemAPI/hermes.ts` — `writeHermesPermissions()`, hook into `chat()`, broaden `listSubAgents()` markers + Failed bucket + logging-disabled detection, expose `enableFileLogging()`.
- `src/lib/approvalBridge.ts` — broaden `APPROVAL_PROMPT_RE`, capture 20-line context window.
- `src/components/permissions/ApprovalDialog.tsx` — render the multi-line "What" context.
- `src/contexts/ChatContext.tsx` — pass `settings.permissions` into `chat()`, count live sub-agent mentions, expose `liveSubAgentCount`, detect denial-vs-Allow mismatch.
- `src/pages/AgentChat.tsx` — live "N sub-agents working" pill, internet-denied warning bubble.
- `src/pages/SubAgents.tsx` — Failed bucket, "logging disabled" banner with Enable button.
- `src/pages/Diagnostics.tsx` — "Permissions sent to agent" panel + "Log every prompt detection" toggle.
- `src/pages/SettingsPage.tsx` — "Sync permissions to agent now" button in the Permissions panel.
- `src/lib/diagnostics.ts` — log every permissions-block write and every prompt detection.

## Safety

- The YAML write is **additive** — only the managed block is touched, never user-edited keys.
- "Enable file logging" is opt-in, never automatic.
- If Hermes ignores the YAML keys (older build), Diagnostics surfaces a one-line warning so you can see it instead of silently failing.

