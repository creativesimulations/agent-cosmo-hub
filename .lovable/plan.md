

# Universal capability gating: never silently fail again

## Goal

Every time the agent tries to use ANY feature/skill/tool — browser, search, image gen, voice, messaging, custom skills the user installs later — the user gets ONE consistent experience:

1. A clear notice (modal or chat bubble) explaining what the agent wants and why
2. Four choices: **Allow once / Allow this session / Always allow / Always deny**
3. The decision is remembered per-capability, surfaced in Settings, and revocable
4. The list of capabilities updates itself as skills are added/removed — no hardcoded toggles to maintain

## Three-layer model

```text
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: CAPABILITY REGISTRY  (single source of truth)     │
│  - Auto-discovered from installed skills + known tool list   │
│  - Each entry: id, label, risk, requiredSecrets, extras     │
└─────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: CAPABILITY POLICY  (user's stored decisions)      │
│  - Per-capability default: ask | allow | session | deny     │
│  - Stored in settings.capabilityPolicy (Map<id, choice>)    │
└─────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: RUNTIME GATE                                      │
│  - Before/during agent action: check policy                 │
│  - If "ask" → show modal → record decision                  │
│  - If failure detected post-hoc → guided fix bubble         │
└─────────────────────────────────────────────────────────────┘
```

## How the user experiences it

### Proactive (preferred): when the agent announces a tool call
- Detect tool-use markers in the agent's stream (`tool: web_search`, `Calling browser…`, `using image_gen`, etc.)
- If policy = `ask` → pause stream, show modal with capability name, what it does, risk level, four buttons
- If policy = `allow`/`session` → silent, but a small chip appears in the message ("🌐 Used web search")
- If policy = `deny` → inject a system note telling the agent it's blocked, so it stops trying

### Reactive (fallback): when detection misses and agent fails
- The existing `toolUnavailable` detector catches the failure phrasing
- Same four-button modal pops up retroactively: "The agent tried to use **Web Browser** and was blocked. What should happen next time?"
- One click to allow + offer to retry the message

### Configurable in Settings
- New "Capabilities" section in Settings (alongside Permissions)
- Auto-generated list — one row per discovered capability with the four-state selector
- Shows readiness: ✅ Ready / ⚠️ Needs key / ⚠️ Skill missing
- "Reset all to Ask" button

## Capability registry (auto-discovery)

Built from three sources, merged at runtime:
1. **Built-in catalog** — well-known capabilities the agent ships with: `shell`, `fileRead`, `fileWrite`, `internet`, `script`, `webBrowser`, `webSearch`, `imageGen`, `voice`, `messaging`, `email`, `calendar`
2. **Installed skills** — `systemAPI.listSkills()` + each skill's `requiredSecrets` and category determines its capability bucket
3. **Observed-at-runtime** — if the agent attempts a tool we've never seen (parsed from stream or failure), it gets auto-registered as `unknown:<name>` so the user can still gate it

When a new skill is installed → next chat turn re-runs discovery → new row appears in Settings → no code changes needed.

## What ships

### Core
- `src/lib/capabilities.ts` — registry types, built-in catalog, merge logic, risk classification
- `src/contexts/CapabilitiesContext.tsx` — discovery on mount + after skill changes, exposes `useCapability(id)` hook, wraps PermissionsContext
- Extend `settings.capabilityPolicy: Record<string, 'ask'|'allow'|'session'|'deny'>` in `SettingsContext`

### Detection (broadened)
- `src/lib/toolUnavailable.ts` — add new patterns ("permission error in this environment", "can't access", "not available right now") and map to capability ids
- New `src/lib/toolUseDetection.ts` — parse outbound tool-call markers from the agent stream (proactive gating)

### UI
- `src/components/permissions/CapabilityApprovalDialog.tsx` — same look as existing ApprovalDialog but capability-aware (shows what the tool does, where to find docs)
- `src/components/chat/CapabilityFixBubble.tsx` — post-failure guided checklist: permission status, missing key, missing skill, missing extras, with one-click actions
- `src/components/chat/CapabilityChip.tsx` — tiny inline marker in chat showing which tools were used in a turn
- New "Capabilities" panel in `SettingsPage.tsx` — auto-generated list, per-row 4-state selector + readiness badge + quick links
- `src/pages/Skills.tsx` — top "Capability readiness" card driven by the same registry
- `src/pages/Diagnostics.tsx` — capability matrix: id × policy × readiness × last-used

### Wiring
- `src/contexts/ChatContext.tsx` — call gate before processing each detected tool marker; record capability usage on each turn for chips
- `src/lib/systemAPI/hermes.ts` — when syncing permissions to `~/.hermes/config.yaml`, also write a `capability_policy:` block so the agent itself can pre-deny (saves a round trip)
- `src/pages/Index.tsx` — installation wizard adds an optional "Pick capabilities to enable" step using the same registry, so users discover web/search/etc. up front

## Technical notes

- **Dynamic toggles**: the Settings list is rendered from `Object.values(registry)` — adding/removing a skill re-runs discovery and the list updates with no manual maintenance
- **Backward compatibility**: existing `settings.permissions` (shell/fileRead/internet/etc.) stays as-is; capabilities is an additive layer that *references* those for the underlying built-ins
- **Failure → policy loop**: every reactive detection offers "Always allow / Always deny" so repeated failures train the policy
- **Privacy**: nothing leaves the machine; policy is stored client-side in settings and mirrored into Hermes config

## Outcome

- One uniform UX for every capability the agent ever tries to use
- The user always knows what's happening and can decide on the spot or in advance
- The capability list grows with the agent — no code change needed when a new skill arrives
- Failures stop being dead ends; they become one-click fix prompts

