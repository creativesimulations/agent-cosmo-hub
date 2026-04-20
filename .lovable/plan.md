

## Channels feature — final scope

### Free channels (native Hermes setup, guided UI)
1. **Telegram** — `@BotFather` → bot token → done. Easiest.
2. **Slack** — workspace install → bot token + app token.
3. **Email (IMAP/SMTP)** — works with Gmail / iCloud / any provider via app password.
4. **WhatsApp** — Hermes ships a WhatsApp gateway. We'll guide the user through Meta Cloud API setup (free tier from Meta covers most personal use). It's the hardest of the four; the wizard will be the longest, with screenshots and copy-paste-ready values.

### Paid channel (one-time unlock, lifetime)
5. **Discord** — locked behind a one-time "Discord Channel" upgrade purchased on your website. Once unlocked, the user enters a license key in the app and it's theirs forever, updates included. Same model as a future "BRAID" upgrade or other paid customizations.

> Why Discord as the paid one: it's the second-most-requested but most users buying this app are non-technical and will not set up a Discord developer app on their own. It's substantial enough to charge for, but not so essential that gating it feels punitive (Telegram + WhatsApp + Email already cover the mass market).

---

## Licensing model (reusable for future paid upgrades)

A single, generic **"Upgrades"** system so Discord today and BRAID/other add-ons tomorrow all flow through the same code path.

- User buys on your website → receives a license key by email.
- In-app: **Settings → Upgrades** (new card) shows a list of available upgrades. Each has:
  - Title, one-line description, "Buy" button (opens your website in browser), "Enter license key" button.
- License keys are stored locally (OS keychain via existing `secretsStore`, key name `LICENSE_<UPGRADE_ID>`).
- Validation: offline signature check (Ed25519 public key embedded in the app, signature in the key). No phone-home, works offline forever, survives reinstall as long as the user keeps the key.
- A tiny `licenses.ts` module exposes `isUpgradeUnlocked('discord')` used by the Channels page to gate the Discord card.

This means: no subscriptions, no server, no recurring billing infrastructure. You generate signed keys with a small offline tool and email them to buyers.

---

## UI plan

### New page: `src/pages/Channels.tsx` (route `/channels`, sidebar entry between Agent Chat and Sub-Agents)

```text
┌─ Channels ────────────────────────────────────────────────┐
│ Free                                                       │
│  ┌─────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐         │
│  │Telegram │ │ Slack  │ │  Email   │ │ WhatsApp │         │
│  │ Set up  │ │Set up  │ │  Set up  │ │  Set up  │         │
│  └─────────┘ └────────┘ └──────────┘ └──────────┘         │
│                                                            │
│ Premium upgrades (one-time, yours forever)                 │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ Discord channel · 🔒 Locked                         │  │
│  │ One-time upgrade · lifetime access · free updates   │  │
│  │ [Buy on website]   [I have a license key]           │  │
│  └─────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

Each card shows live status: *Not configured* / *Configured* / *Running* (green dot).

### Wizard: `src/components/channels/ChannelWizard.tsx`
Reusable 4-step dialog used by all five channels:
1. **What this does** — plain-English explainer + example screenshot.
2. **Get your credentials** — numbered click-by-click steps, each with an "Open in browser" button.
3. **Paste credentials** — validated fields (reuses prefix detection from `secretPresets.ts`).
4. **Test & enable** — sends a test message, then flips the gateway on.

### Sidebar
Add **Channels** entry. Small green dot when ≥1 gateway is running.

### Settings
- **Upgrades** card listing all available paid upgrades, their unlock status, and a "Restore by entering license key" action.
- "Install messaging extra" toggle in Behavior (one-time `pip install [messaging]`).

---

## Backend wiring

Extend `src/lib/systemAPI/hermes.ts`:
- `installMessagingExtra()` — runs the pip extra install, idempotent.
- `startGateway(channel)` / `stopGateway(channel)` — writes the enabled list into `~/.hermes/config.yaml` `gateways:` section, then starts/stops.
- `gatewayStatus()` — returns per-channel status object.

Extend `src/lib/secretPresets.ts` with: `TELEGRAM_BOT_TOKEN`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `DISCORD_BOT_TOKEN`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `IMAP_HOST`, `IMAP_USER`, `IMAP_PASS` — each with docs URLs and prefix detection where applicable.

New `src/lib/licenses.ts`:
- `UPGRADES` catalog (today: just `discord`).
- `isUpgradeUnlocked(id)` — reads license key from secrets store, verifies Ed25519 signature against embedded public key.
- `enterLicenseKey(id, key)` — validates + stores. Returns ok/error.
- `buyUrl(id)` — returns your website URL for that upgrade.

New `src/lib/channels.ts` — channel catalog (id, label, env-vars needed, docs link, paid?, upgradeId?).

---

## Files

**New**
- `src/pages/Channels.tsx`
- `src/components/channels/ChannelCard.tsx`
- `src/components/channels/ChannelWizard.tsx`
- `src/components/channels/UpgradeCard.tsx`
- `src/lib/channels.ts`
- `src/lib/licenses.ts`

**Edited**
- `src/lib/systemAPI/hermes.ts` — gateway control + messaging extra
- `src/lib/systemAPI/index.ts` — export new methods
- `src/lib/secretPresets.ts` — new env vars
- `src/App.tsx` — `/channels` route
- `src/components/layout/AppSidebar.tsx` — Channels entry + status dot
- `src/pages/SettingsPage.tsx` — Upgrades card

---

## What you'll need to provide later (not blocking this build)

1. The website URL where Discord upgrade is sold (placeholder until you have one).
2. An Ed25519 keypair — you keep the private key on your machine to sign license keys; the public key is embedded in the app. I'll generate placeholder keys and document how to swap them in.

