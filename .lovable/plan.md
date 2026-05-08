## Plan: Agent-aware personality + sub-agent panel fixes

### 1. Split agent guidance into two files

**`~/.hermes/AGENTS.md`** — shrink to ~15 lines. Just the unconditional essentials:
- You run inside the Ronbot desktop app, which has a real terminal and file tools.
- Never tell the user to "open a terminal" or "run this elsewhere" — run commands yourself.
- For passwords, QR codes, OAuth, confirms, file picks, progress: emit a fenced ```ronbot-intent``` JSON card. Never ask for secrets in plain prose.
- Full protocol reference and recipes: `~/.ronbot/APP_GUIDE.md` (grep it when unsure).
- User responses come back as ```ronbot-intent-response``` blocks correlated by `id`.

**`~/.ronbot/APP_GUIDE.md`** — full reference, refreshed on connect. Sections:
- Intent envelope spec (id, type, title, description).
- Each intent type with a JSON example: `credential_request`, `confirm`, `choice`, `qr_display`, `oauth_open`, `file_pick`, `progress`, `done`, `pairing_approve`.
- Recipes: WhatsApp setup (`hermes whatsapp` → capture QR → `qr_display`), Google Workspace (`hermes auth google-workspace` → `oauth_open` + `progress`), Telegram, generic credential prompts.
- When to use intents vs prose; how responses arrive.

### 2. New `systemAPI.writeRonbotAppGuide()`

- Mirrors existing `writeRonbotAgentRules`. Idempotent, versioned header (`<!-- ronbot-app-guide v1 -->`), rewrites only when version changes or file missing.
- Called from `RonbotRulesBridge` alongside `writeRonbotAgentRules` on connect.

### 3. SOUL.md / personality addendum

- One line appended (idempotent, marker-guarded) into the default persona pre-fill in `PersonalityDialog.tsx`: "You operate inside the Ronbot desktop app and proactively manage it for the user — see `~/.ronbot/APP_GUIDE.md`."
- Existing user-edited personalities are not overwritten.

### 4. Fix sub-agent goal capture (`ChatContext.tsx`)

Replace the current `delegate_task` regex with matchers covering Hermes' real call shapes:
- `delegate_task(... goal="...")` (single)
- `delegate_task(tasks=[{ goal: "..." }, ...])` (batch — spawn one per goal)
- Keep prose fallback + deferred goal updater.

### 5. Active-only sub-agents in right panel

- In `useAgentLiveState.ts` / `RightInfoPanel.tsx`, filter `liveSubAgents.list()` to `status === "running"`.
- Empty-state copy → "No active sub-agents."
- SubAgents tab still shows full history.

### Files touched
- `src/lib/systemAPI/index.ts` — add `writeRonbotAppGuide`.
- `src/lib/systemAPI/hermes.ts` — shrink `RONBOT_RULES_BLOCK`; add APP_GUIDE writer + content constant.
- `src/components/companion/RonbotRulesBridge.tsx` — call both writers.
- `src/components/settings/PersonalityDialog.tsx` — persona one-liner.
- `src/contexts/ChatContext.tsx` — goal-capture regex.
- `src/hooks/useAgentLiveState.ts` and/or `src/components/companion/RightInfoPanel.tsx` — active-only filter + copy.

### Verification
- Connect agent → both files exist with current version headers.
- Trigger a `delegate_task` → goal text appears on right panel; panel empties when turn ends; SubAgents tab keeps history.
- Ask agent "set up WhatsApp" → it runs the command itself and emits a `qr_display` intent rather than asking the user to open a terminal.
