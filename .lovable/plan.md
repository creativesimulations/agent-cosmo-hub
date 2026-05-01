# Plan: Hermes recommendations + auto-discovery of capabilities

Two coordinated tracks. Track A delivers the Hermes-doc recommendations you approved. Track B replaces hard-coded catalogs with runtime discovery so the app stays in sync with whatever the agent actually supports — no code edits needed when Hermes adds a channel, skill, or tool.

---

## Track B — Auto-discovery (the core architectural change)

### Today (the problem)
Three hard-coded catalogs drive the UI:
- `src/lib/capabilities/catalog.ts` — capability tiles on Dashboard / chat empty state.
- `src/lib/channels.ts` — Channels page cards + setup copy.
- `src/lib/capabilities.ts` `BUILTIN_CAPABILITIES` — permissions panel rows.

Every time Hermes ships a new channel, skill, or tool, all three must be hand-edited.

### Target architecture

```text
                    ┌─────────────────────────────┐
                    │      Hermes agent (CLI)     │
                    │  hermes capabilities --json │
                    │  hermes skills list --json  │
                    │  hermes channels list --json│
                    │  hermes tools list  --json  │
                    └──────────────┬──────────────┘
                                   │ stdout JSON
                                   ▼
                ┌─────────────────────────────────────┐
                │  systemAPI.discoverCapabilities()   │  ← new
                │  - cached 60s, refreshed on connect │
                │  - falls back to a tiny seed list   │
                │    if the CLI doesn't support it    │
                └──────────────┬──────────────────────┘
                               │
                               ▼
                ┌─────────────────────────────────────┐
                │  CapabilitiesContext.registry       │
                │  = merge(seed, discovered, skills,  │
                │          observed-at-runtime)       │
                └──┬───────────────┬──────────────────┘
                   │               │
                   ▼               ▼
          Dashboard tiles   Channels page    Permissions panel
          Chat empty state  Slash palette    Capability dialogs
```

### What we build

1. **New CLI bridge: `systemAPI.discoverCapabilities()`** in `src/lib/systemAPI/hermes.ts`. Tries, in order:
   - `hermes capabilities --json` (preferred — single call returns channels + tools + skills + media + connectors with metadata).
   - Falls back to parallel `hermes channels list --json`, `hermes tools list --json`, plus existing `listSkills()`.
   - Falls back to a hand-written seed (current `BUILTIN_CAPABILITIES` minus channel-specific copy) so the UI is never empty on first launch / older Hermes versions.
   - 60s in-memory cache + invalidation on agent reconnect, skill install, or secret write.

2. **Normalized shape** (`src/lib/capabilities/types.ts`):
   ```ts
   DiscoveredCapability {
     id, kind: "channel"|"tool"|"skill"|"media"|"connector",
     name, oneLiner, icon?, category,
     requiresSetup, requiredSecrets[], optionalSecrets[],
     setupPromptTemplate?, // agent-supplied or derived
     docsUrl?, source: "hermes"|"skill"|"seed"|"observed"
   }
   ```

3. **Replace the three hard-coded catalogs** with thin views over the registry:
   - `CAPABILITY_CATALOG` → derived from `registry` filtered by `kind in {tool,media,connector,channel}`.
   - `CHANNELS` → derived from `registry` filtered by `kind === "channel"`. Per-channel setup copy moves out of the app: the agent provides a `setupPromptTemplate` (e.g. "Walk me through Telegram setup") and owns the actual instructions in chat. The static step lists in `channels.ts` are deleted — they were already redundant with the agent-driven flow.
   - `BUILTIN_CAPABILITIES` becomes the **seed/fallback only**, used when discovery fails.

4. **Icon resolution stays declarative.** Hermes returns a lucide icon name when known; we keep a small lookup table (`MessageCircle`, `Send`, `Hash`, …) and fall back to `Sparkles` so unknown future channels still render.

5. **Cache + freshness UX.**
   - On first paint show the seed (instant).
   - Kick off discovery in the background; swap in the live list when it resolves.
   - Add a tiny "Refresh" affordance on the Capabilities panel and a manual `rediscover()` already in `CapabilitiesContext`.

6. **Tests.** Vitest cases for: discovery happy path, CLI-missing fallback, skill-only fallback, icon resolution, observed-tool merging.

### Why this works
- The agent is already the source of truth for everything it can do — Hermes' CLI exposes its own catalog. We just stop duplicating it.
- The seed list keeps the UI usable offline and during a cold start.
- The observed-tool path (already wired in `CapabilitiesContext`) means even capabilities Hermes doesn't pre-declare get registered the first time the agent uses them.

### Tradeoffs / risks
- If `hermes capabilities --json` doesn't exist on the user's installed Hermes version, we depend on the fallback chain. That's why the seed stays.
- Hermes-supplied copy ("oneLiner", setup prompts) may be sparse or terse. We'll keep light client-side overrides keyed by id for the ~5 channels where copy quality matters most, but treat them as cosmetic — never as gating logic.

---

## Track A — Hermes-doc recommendations (in priority order)

1. **Pairing intent** — new `pairing.approve` agent-intent card in `src/lib/agentIntents/protocol.ts` + matching renderer in `src/components/intents/`. Used wherever Hermes emits a one-time pairing code (Matrix, iMessage, etc.). No more terminal copy-paste.

2. **MCP server management UI** — new `src/pages/MCPServers.tsx` listing servers from `~/.hermes/config.yaml` (read via `systemAPI`). Add/remove flows are agent-driven via existing intent cards (`credential_request` for tokens, `confirm` for "install GitHub MCP server?"). Sidebar entry under Settings.

3. **Auth flow audit** — sweep `hermes login` references; switch to `hermes auth` where the docs now recommend it. Affects `prereqs.ts`, any onboarding copy, and the OAuth intent card.

4. **Cron / Scheduled tasks page** — `src/pages/Scheduled.tsx`. Lists jobs via `hermes cron list --json`, lets the user create one in natural language (seeds a chat prompt; agent emits a `confirm` intent before saving). No bespoke cron UI.

5. **Skill env-var prompts** — when `listSkills()` returns `requiredEnvironmentVariables`, surface them on the Secrets page with an "Add" button per missing key (already partially wired; finish + style).

6. **Voice mode toggle + `/voice` slash command** — extends `SlashCommandPalette.tsx` and the chat composer. Backed by the existing `voice` capability gate.

7. **`/background` session toggle** — uses existing `setRunInBackground` IPC; adds a chat affordance + status pill.

8. **`/insights` analytics** — lightweight dashboard reading from agent log/telemetry endpoints. Lowest priority; ship last.

These all consume the discovered registry from Track B — e.g. the MCP page lists *whatever* MCP servers Hermes reports, the cron page lists *whatever* schedule entries exist, and the slash palette pulls its command list from the registry instead of a hard-coded array.

---

## Suggested execution order

1. Track B steps 1–3 (discovery API + normalized type + replace catalogs). One PR-sized chunk.
2. Track B steps 4–6 (icon/fallback/refresh/tests).
3. Track A items 1–3 (pairing intent, MCP page, auth audit) — these are highest user impact.
4. Track A items 4–5 (cron, skill env vars).
5. Track A items 6–8 (voice, background, insights) — polish tier.

## Files touched (high level)
- new: `src/lib/capabilities/discovery.ts`, `src/lib/capabilities/types.ts`, `src/pages/MCPServers.tsx`, `src/pages/Scheduled.tsx`, `src/components/intents/PairingApproveCard.tsx`
- edited: `src/lib/systemAPI/hermes.ts`, `src/lib/systemAPI/index.ts`, `src/lib/capabilities.ts`, `src/lib/capabilities/catalog.ts`, `src/lib/channels.ts`, `src/contexts/CapabilitiesContext.tsx`, `src/components/chat/SlashCommandPalette.tsx`, `src/lib/agentIntents/protocol.ts`, `src/components/intents/index.ts`, sidebar/route registration
- deleted: per-channel hard-coded `setupSteps` arrays in `channels.ts` (moved to agent-driven copy)

After approval I'll start with Track B step 1 (the discovery bridge) since everything else depends on it.
