## Chat-First Companion Dashboard — Final Plan

Merges the prior companion-dashboard vision with your latest tweaks. Existing left sidebar structure stays. Home becomes a chat-first view with a right info panel. Advanced group stays but loses 4 tabs.

---

### 1. Left sidebar — keep current structure, trim Advanced

**Primary (unchanged):**
- Home, Chat, Channels, Settings

**Skills & Tools** — promoted out of Advanced into the primary group.

**Advanced group — kept, but remove these 4 tabs:**
- Advanced, MCP Servers, Agent Logs, Dashboard

**Advanced group — remaining tabs stay as-is:**
- LLM Config, Secrets, Sub-Agents, Updates, Backups, App Diagnostics, Terminal, Setup & Install, Scheduled, Insights

Files: `src/components/layout/AppSidebar.tsx`, `src/App.tsx` (delete the 4 routes), and delete pages `Dashboard.tsx`, `Advanced.tsx`, `MCPServers.tsx`, `LogViewer.tsx`.

---

### 2. Home tab — chat + right info sidebar

`src/pages/Home.tsx` becomes a two-column layout. Left column hosts the embedded `AgentChat` (the existing chat UI). Right column is a new `RightInfoPanel`.

```text
┌────────────────────────────────┬──────────────────────┐
│                                │  Ron        ● Online │
│                                │  Uptime 4h 23m       │
│                                │  [ Power: On ▾ ]     │
│        Chat with Ron           │  ─────────────────── │
│        (AgentChat embedded)    │  Health              │
│                                │   • Gateway   ✓      │
│                                │   • Model     ✓      │
│                                │   • Memory    ✓      │
│                                │  ─────────────────── │
│                                │  Sub-agents (2)      │
│                                │   research · idle    │
│                                │   email   · running  │
│                                │  ─────────────────── │
│                                │  Cron (3)            │
│                                │   09:00  daily brief │
│                                │   */15m  inbox sweep │
│                                │  ─────────────────── │
│                                │  Heartbeats (2)      │
│                                │   30s  presence      │
│                                │   5m   memory flush  │
└────────────────────────────────┴──────────────────────┘
```

**Right info panel sections (top → bottom):**
1. **Agent identity** — chosen name + online/offline dot + uptime.
2. **Health** — moved here from current Home tab (gateway, model, memory, etc.).
3. **Sub-agents** — active sub-agents with brief details (name, status, current task one-liner).
4. **Cron** — set cron jobs with schedule + brief note of what each does.
5. **Heartbeats** — heartbeat tasks with their interval.

**Behavior:**
- New component: `src/components/companion/RightInfoPanel.tsx`.
- New hook: `src/hooks/useAgentLiveState.ts` — single 5s poll batching `getHealth`, `listSubAgents`, `listCronJobs`, `listHeartbeats`, `getAgentName`, uptime.
- Each section is collapsible; remembers state in `localStorage`.
- At ≤1100px viewport, panel auto-collapses to a 48px icon rail with hover-popovers per section.
- Skeleton loaders during first fetch.

**Removed from Home:** the install wizard (already moved to `/install`) and the "What can your agent do" capability grid (moves to Skills & Tools, see §5).

---

### 3. Agent prompts → inline chat cards (no modals)

Per your choice, no pop-up modal layer. Reuse the existing intent-card system in `src/lib/agentIntents/` + `src/components/intents/`. Add intents as needed:
- `image.show`, `password.request`, `confirm.action`, `link.open`.

Renders inline in the chat thread — non-blocking, scrollable, reviewable later. Existing `QRCard`, `CredentialRequestCard`, `OAuthCard`, `PairingCard`, `ConfirmCard` already cover most cases.

---

### 4. Settings tab — app-level controls + personality

`src/pages/SettingsPage.tsx` adds three sections:

**App settings** (existing) — keep as-is.

**Agent power**
- On/off toggle (calls `systemAPI.setAgentRunningState`).
- Checkbox: *"Keep agent running when app is closed"* (wires to existing Electron lifecycle in `electron/main.cjs`).

**Personality**
- Card titled "Agent personality" with a "Change personality" button.
- Opens a dialog: free-text field for the user to describe the desired personality direction.
- On submit: sends a structured chat message to the agent (`intent: personality.update`) instructing it to edit its own base files per the user's direction.
- Notice in the dialog: *"Personality changes take effect after the agent restarts."*
- Prompt: *"Restart the agent now?"* with **Restart now** (default) and **Later** buttons. Restart = stop → wait for clean exit → start; chat reconnects via existing `useAgentConnection` logic.

---

### 5. Skills & Tools tab — promoted, capability grid, no toggles

`src/pages/Skills.tsx`:
- Move to the primary sidebar group (out of Advanced).
- **Replace** the on/off skill pill list — users should not be able to toggle skills.
- **Bring in** the "What can your agent do" capability grid currently on Home (read-only cards: Channels, Cron, Sub-agents, Memory, Web, Files, Webhooks, MCP tools, …) sourced from the discovery registry in `CapabilitiesContext`.
- Keep the Plugins panel as a read-only list.
- Helper line at the top: *"Want a new tool, skill, or external integration? Just ask Ron in chat — including MCP servers, new channels, and custom skills."*

This replaces the deleted MCP Servers tab — users learn that the agent handles it.

---

### 6. First-launch welcome

One-time dialog after first successful agent connection:

> *"Hi, I'm {agentName}. Chat with me to do anything — connect WhatsApp, add skills, schedule tasks, connect external tools, or change my personality. The right panel shows what I'm doing right now."*

Stored in `localStorage` (`ronbot.welcomeShown = true`).

---

### 7. Technical notes

- **System API additions** (`src/lib/systemAPI/hermes.ts`): `listHeartbeats()`, `getHealth()` (consolidated), `restartAgent()`, `setAgentAutostart(bool)`, `updatePersonality(text)`. `listSubAgents`, `listScheduledJobs`, `getAgentName` already exist.
- **Live state hook** batches all right-panel reads on a 5s interval.
- **Personality flow** uses an `intent: personality.update` envelope; the agent edits its own base files.
- **Restart** = stop + immediate start (no confirmation).
- No backend / Lovable Cloud changes.

---

### 8. Files touched

**New:**
- `src/components/companion/RightInfoPanel.tsx`
- `src/components/companion/sections/{Identity,Health,SubAgents,Cron,Heartbeats}.tsx`
- `src/hooks/useAgentLiveState.ts`
- `src/components/settings/PersonalityDialog.tsx`
- `src/components/companion/WelcomeDialog.tsx`

**Edited:**
- `src/pages/Home.tsx` (chat + right panel layout)
- `src/pages/Skills.tsx` (capability grid, remove toggles, plugins read-only)
- `src/pages/SettingsPage.tsx` (power, autostart, personality)
- `src/components/layout/AppSidebar.tsx` (move Skills out of Advanced; remove 4 tabs)
- `src/App.tsx` (drop 4 routes)
- `src/lib/systemAPI/hermes.ts` + `index.ts` (new methods)
- `src/lib/agentIntents/protocol.ts` (new intents if missing)

**Deleted:**
- `src/pages/Dashboard.tsx`
- `src/pages/Advanced.tsx`
- `src/pages/MCPServers.tsx`
- `src/pages/LogViewer.tsx`