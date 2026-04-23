

# Browser backend selector for Ron — with Browserbase as a paid upgrade

Combines the three-backend setup wizard with the paid-unlock pattern already used by the Discord channel.

## What gets built

### 1. Backend catalog (`src/lib/browserBackends.ts` — new)
Typed registry of all backends with a `tier` field:

| Backend | Tier | Required env | Notes |
|---|---|---|---|
| Browserbase | **paid** (`upgradeId: 'browserbase'`) | `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID` (+ optional stealth/proxy/keep-alive vars) | Cloud, strongest anti-bot |
| Camofox | free | `CAMOFOX_URL` (default `http://localhost:9377`) + optional `managed_persistence` toggle | Local, self-hosted |
| Local Chrome (CDP) | free | none stored — manual `/browser connect` | Uses user's own Chrome |
| Browser Use | free | `BROWSER_USE_API_KEY` | Quick-add chip |
| Firecrawl | free | `FIRECRAWL_API_KEY` | Quick-add chip |

Plus `getActiveBrowserBackend(secretKeys)` following Hermes precedence (Browserbase → Browser Use → Camofox → Firecrawl → default).

### 2. Browserbase added to upgrades catalog (`src/lib/licenses.ts`)
Append a second `UPGRADES` entry:
```ts
{
  id: 'browserbase',
  name: 'Browserbase browser',
  tagline: 'Strongest anti-bot — cloud browsers with stealth, proxies & CAPTCHA solving.',
  description: 'Browserbase is a paid cloud browser service. This upgrade unlocks the in-app setup wizard so Ron can use Browserbase as its backend without touching a config file. Camofox and Local Chrome remain free.',
  buyUrl: 'https://ronbot.com/upgrades/browserbase',
  priceLabel: 'One-time · $29',
}
```
Auto-renders on `/upgrades` via the existing loop.

### 3. Shared license-key dialog (`src/components/upgrades/EnterLicenseKeyDialog.tsx` — new)
Extract the key-entry dialog out of `UpgradeCard.tsx` so both the Upgrades page and the new browser wizard use one component. `UpgradeCard.tsx` updated to consume it (no UX change).

### 4. Browser setup wizard (`src/components/skills/BrowserSetupDialog.tsx` — new)
One dialog, multi-step:

**Step 1 — Pick backend**
- Three primary cards: Browserbase (with **Paid · $29** chip + lock icon if locked), Camofox (Free · Local), Local Chrome (Free · Advanced)
- Secondary "quick add" chips: Browser Use, Firecrawl

**Step 2 — Configure**
- **Browserbase + locked** → mini paywall: *Buy ($29)* button (opens `buyUrl`) and *Enter key* button (opens shared `EnterLicenseKeyDialog`). On unlock, auto-advances to the API-key form.
- **Browserbase + unlocked** → two inputs (API key + project ID) + "Get keys" link → save to secrets → "Restart Ron" toast.
- **Camofox** → URL field (default `http://localhost:9377`) + persistent-sessions toggle (writes `browser.camofox.managed_persistence: true` via new `hermesAPI.setBrowserCamofoxPersistence`) + collapsible "How to run Camofox" with copyable docker/git commands.
- **Local Chrome** → OS-detected launch command + "Open terminal" helper + marks capability as "manually configured" in `capabilityPolicy` so the probe stops nagging.

After any successful save: invalidate `capabilityProbe` cache, re-run probe, close dialog.

### 5. Active-backend badge (`src/components/skills/BrowserBackendBadge.tsx` — new)
Small pill on the Web Browsing capability row: *Active: Browserbase* / *Camofox @ localhost:9377* / *Local Chrome (manual)* / *Default (no anti-bot)*. Includes "Switch backend" link that reopens the wizard.

### 6. Entry points
- **Skills page** (`src/pages/Skills.tsx`) — Web Browsing row gets **Set up browser** (replaces generic "Add key" when no backend configured) + the badge.
- **Capability fix bubble** (`src/components/chat/CapabilityFixBubble.tsx`) — for `webBrowser` hits, primary CTA becomes "Set up browser" → opens wizard.
- **First-run banner** (`src/pages/AgentChat.tsx`) — banner CTA opens the wizard directly.

### 7. Probe + presets updates
- `src/lib/capabilities.ts` — extend `webBrowser.candidateSecrets` with `BROWSER_USE_API_KEY`, `CAMOFOX_URL`. Add `webBrowserReadyVia(keys)` helper.
- `src/lib/secretPresets.ts` — add presets for `BROWSERBASE_PROJECT_ID`, `BROWSER_USE_API_KEY`, `CAMOFOX_URL`, plus optional Browserbase tuning vars.
- `src/lib/capabilityProbe.ts` — webBrowser branch returns `ready` when any backend env var is present (names the active backend in `message`); otherwise `noKey` with *"No browser backend configured. Click Set up browser to pick Browserbase, Camofox, or Local Chrome."*
- `src/lib/systemAPI/hermes.ts` — add `setBrowserCamofoxPersistence(enabled: boolean)` that surgically updates the `browser.camofox.managed_persistence` block in `config.yaml` (same pattern as the permissions block).

## Files

**New**
- `src/lib/browserBackends.ts`
- `src/components/skills/BrowserSetupDialog.tsx`
- `src/components/skills/BrowserBackendBadge.tsx`
- `src/components/upgrades/EnterLicenseKeyDialog.tsx`

**Edited**
- `src/lib/licenses.ts` — add Browserbase upgrade
- `src/lib/capabilities.ts` — extend webBrowser candidates + helper
- `src/lib/secretPresets.ts` — new env-var presets
- `src/lib/capabilityProbe.ts` — backend-aware readiness
- `src/lib/systemAPI/hermes.ts` — Camofox config writer
- `src/pages/Skills.tsx` — wizard entry + backend badge
- `src/components/chat/CapabilityFixBubble.tsx` — "Set up browser" CTA
- `src/pages/AgentChat.tsx` — first-run banner CTA opens wizard
- `src/components/channels/UpgradeCard.tsx` — consume shared key dialog

**Untouched**
- `src/pages/Upgrades.tsx`, all gating/probe/sidebar-badge logic, license verification.

## Outcome

- Three working browser options the user can pick from one screen.
- Browserbase is gated by the same one-time license-key flow as the Discord channel — Camofox and Local Chrome stay free so there's always a no-cost path to working web access.
- The Web Browsing row always shows which backend is active and offers a one-click switch.
- The "permission error" dead end now ends in a button that fixes it.

