## Goals

1. Remove the "Chat" sidebar tab (Home already hosts the agent chat).
2. Stop the app from running Hermes CLI auth flows itself. **All Hermes setup/admin actions must be delegated to the agent via a chat prompt** — the agent already knows how to drive Hermes and will collect anything it needs from the user through the intent protocol.
3. Apply the same rule to every other place where the app shells out to do "setup-style" Hermes work (Google Workspace, channel setup, skill/plugin/MCP install, scheduled-job creation, profile management, etc.). The app keeps **read-only probes** (list/status), but every **mutating "set up X" / "install X" / "connect X"** flow becomes "draft a prompt, route to chat, let the agent do it."

## Plan

### 1. Sidebar — drop the Chat tab

`src/components/layout/AppSidebar.tsx`:
- Remove the `{ path: "/chat", icon: MessageSquare, label: "Chat", showChatBadge: true }` nav entry.
- Keep the `unreadCount` / `isStreaming` wiring removed along with the now-unused `isChatLink` branch (clean up the badge code paths).
- Keep the `/chat` route in `App.tsx` so deep-links and the personality flow still work.

### 2. Channels — Google Workspace becomes agent-driven

`src/pages/Channels.tsx`:
- Delete `handleGoogleWorkspaceSetup`, the `googleWorkspaceBusy` state, and the inline `<Loader2>` button.
- Make the Google Workspace card behave like every other `ChannelCard`: clicking "Set up" calls `setDraft(...)` with a prompt like:

  > Please set up Google Workspace for me (Gmail, Calendar, Drive, Docs, Sheets). Walk me through any login or permission steps and ask for anything you need.

  …then `navigate("/chat")`. The agent owns the OAuth/device-login flow end to end via the intent protocol.
- Remove the `setupGoogleWorkspace` import.

### 3. Stop exposing app-driven Hermes setup helpers

`src/lib/systemAPI/hermes.ts` + `src/lib/systemAPI/index.ts`:
- Delete `setupGoogleWorkspace` (the function that runs `hermes auth google-workspace || …`). It's the source of the error in the bug report and has no agent-free fallback path.
- Audit and remove any other **mutating** helpers the renderer calls directly for things the agent should drive. Concretely, retire from the public `systemAPI` surface:
  - `installSkillFromPath`, `installSkillFromGit`, `installToolFromPath` — agent installs skills/tools.
  - `setupGoogleWorkspace` — covered above.
  - `deleteScheduledJob` — agent manages cron.
  - `setSkillEnabled` (mutating) — agent toggles skills via its own tools.
  - Any `restart/repair`-style helpers that aren't strictly needed for the personality-restart flow.

  Replace each call site with a "seed a prompt, route to chat" pattern (same `setDraft` + `navigate("/chat")` shape used by `ChannelCard`). Keep a single shared helper, e.g. `useDelegateToAgent()` in `src/contexts/ChatContext.tsx`, that takes a prompt string and does the seed+navigate.

- **Keep** read-only probes (`hermesStatus`, `listScheduledJobs`, `listPlugins`, `listProfiles`, `listSkills`, `getSkillsConfig`, `listMCPServers`, `getInsights`, `chatPing`, `readEnvFile`, `readConfig`, `discoverCapabilities`, `writeRonbotAgentRules`, `restartAgent` for the personality flow). These don't conflict with "agent owns Hermes" — they just read state.

### 4. Update call sites

- `src/pages/Skills.tsx` — replace the "Install skill / install from path / install from git" buttons with "Ask the agent to install a skill" → `delegateToAgent("Please install the skill at <path or git URL the user provides>. Ask me for the path/URL if you need it.")`. Remove the dialogs that drive `systemAPI.installSkill*` directly.
  - Note: keep the skill **list** (`listSkills`) and the "open skills folder" reveal — both are read-only/UX-only.
- `src/pages/Scheduled.tsx` — replace any "delete job" UI with "Ask the agent to remove this job" → seed prompt with the job id. Listing stays as-is.
- Anywhere `setSkillEnabled` is wired to a toggle, swap the toggle for "Ask the agent to enable/disable <skill>".
- Search for remaining `systemAPI.<mutating>` call sites with `rg -n "systemAPI\.(setupGoogleWorkspace|installSkill|installTool|deleteScheduledJob|setSkillEnabled)"` and convert them all.

### 5. Wording in chat-empty-state / docs

Update any onboarding copy that still implies the app sets things up ("we'll install…", "we'll connect…") to "ask your agent — it can install skills, connect channels, schedule jobs, and more for you."

## Files touched

- **edited** `src/components/layout/AppSidebar.tsx` — remove Chat nav entry.
- **edited** `src/pages/Channels.tsx` — Google Workspace card → agent prompt.
- **edited** `src/lib/systemAPI/hermes.ts` — remove `setupGoogleWorkspace` and other mutating helpers.
- **edited** `src/lib/systemAPI/index.ts` — drop the corresponding exports.
- **edited** `src/contexts/ChatContext.tsx` — add a tiny `delegateToAgent(prompt)` helper.
- **edited** `src/pages/Skills.tsx` — convert install/enable buttons to agent prompts; drop install dialogs.
- **edited** `src/pages/Scheduled.tsx` — convert delete to an agent prompt.
- **edited** any other page using the removed mutating helpers (TBD from `rg` audit).
- **deleted** `src/components/skills/InstallSkillDialog.tsx` (no longer used) — if confirmed unused after the audit.

## Verification

- Sidebar no longer shows Chat; Home still loads chat inline; `/chat` deep-link still works.
- Clicking "Set up" on the Google Workspace card pre-fills the chat composer with the setup prompt and navigates to chat — no Hermes CLI is invoked by the renderer.
- `rg -n "hermes auth|google-workspace"` in `src/lib/systemAPI/hermes.ts` returns nothing.
- `rg -n "systemAPI\.(setupGoogleWorkspace|installSkillFromPath|installSkillFromGit|installToolFromPath|deleteScheduledJob|setSkillEnabled)\("` in `src/` returns nothing.
- Diagnostics no longer logs the failed `hermes auth google-workspace` chain.
