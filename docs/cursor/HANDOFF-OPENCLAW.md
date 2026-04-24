# OpenClaw Control Panel — Cursor handoff

> **Read this entire document before writing any code.** OpenClaw is
> the cleanest of the three apps in this family — no mandatory
> Anthropic dependency, full provider freedom from day one.

---

## 1. What this app is

Electron desktop control panel for the **OpenClaw** agent framework
(<https://github.com/openclaw/openclaw>, docs at
<https://docs.openclaw.ai/>). Mirrors the Ronbot codebase one-for-one
in architecture, design, and IPC patterns — only the agent-specific
layer (`src/lib/systemAPI/openclaw.ts`) is new.

OpenClaw supports ~40 model providers and exposes the full lifecycle
through a single CLI: `openclaw <subcommand>`. The control panel is a
visual wrapper over that CLI, not a re-implementation.

Default install location: `~/.openclaw/` (or `~/.openclaw-<profile>`
when a profile is active).

---

## 2. Install paths — installer + local prefix + Docker

Show three install tiles. Each runs the matching upstream installer
through `runCommandStream` and tails the output into the standard
log panel.

### 2.1 Recommended installer
- **macOS / Linux / WSL2**: `curl -fsSL https://openclaw.ai/install.sh | bash`
- **Windows**: `iwr -useb https://openclaw.ai/install.ps1 | iex`

A single green "Install" button. Optional toggle: "`--no-onboard`"
(skip onboarding to do it later in the panel).

### 2.2 Sandboxed (local prefix)
`curl -fsSL https://openclaw.ai/install-cli.sh | bash`

Installs entirely under `~/.openclaw/` without touching system Node.
Recommended for users who already manage their own Node toolchain.

### 2.3 Containerized (Docker)
Reuse the Docker detection from `src/lib/systemAPI/browserSetup.ts`
(`detectDocker()`, `installDocker()`, `startDockerDaemon()`).

When Docker is up, write a `docker-compose.yml` template to the
chosen install dir and run:

```bash
docker compose up -d
docker compose exec openclaw openclaw onboard --install-daemon
```

Show container health in the Dashboard.

---

## 3. Post-install onboarding wizard

### 3.1 Provider picker
Curated default grid of 8 tiles, in this order:

1. **OpenRouter** ← default highlighted tile
2. OpenAI
3. Anthropic
4. Google
5. Groq
6. DeepSeek
7. Mistral
8. **Ollama (local)**

A "Show all" expander reveals the full ~40 OpenClaw providers. Each
tile uses the existing `SecretForm` + `secretPresets` flow — add
missing presets to `src/lib/secretPresets.ts` as needed.

### 3.2 Default model
After the key is saved, present a model dropdown scoped to the
chosen provider. On confirm:

```bash
openclaw config set agents.defaults.model.primary "<provider>/<model>"
```

### 3.3 Verify
Run `openclaw doctor` and `openclaw gateway status`. Surface results
in the same diagnostics panel pattern Ronbot uses.

---

## 4. Control-panel screens (1:1 with the OpenClaw CLI)

| Sidebar item | CLI surface |
| --- | --- |
| Dashboard | `openclaw dashboard`, `openclaw gateway status`, `openclaw health` |
| Channels | `openclaw channels list/add/remove/login` (WhatsApp, Telegram, Discord, Slack, Mattermost) |
| Agents | `openclaw agents list/add/delete/bind` |
| Models / Providers | `openclaw models`, provider swap UI, per-agent model override |
| Skills & Plugins | `openclaw skills search/install`, `openclaw plugins list/install` |
| Memory & Wiki | `openclaw memory status/search`, `openclaw wiki status/search` |
| Sessions | `openclaw sessions` (list, tail, export) |
| Logs | `openclaw logs` |
| Cron | `openclaw cron list/add/remove` |
| Tasks | `openclaw tasks list/run/cancel` |
| Hooks | `openclaw hooks list/add/remove` |
| Webhooks | `openclaw webhooks list/add/remove` |
| Sandbox & Approvals | `openclaw approvals`, `openclaw sandbox` — surface the runtime exec policy clearly with red/yellow/green chips |
| Backup / Restore | `openclaw backup`, `openclaw reset` |
| Update / Uninstall | `openclaw update`, `openclaw uninstall` |
| Diagnostics | `openclaw doctor`, `openclaw security audit`, `openclaw secrets audit` |
| Settings | profile switcher, install dir, daemon controls, `--dev` toggle |

Every CLI call goes through a single helper:

```ts
runOpenclaw(['agents', 'list'], { profile, dev });
```

`profile` and `dev` come from `SettingsContext` and are prepended as
global flags (`--profile foo --dev`) on every invocation.

---

## 5. Daemon management

OpenClaw installs a background gateway. Platform per-OS:

- **macOS** → LaunchAgent in `~/Library/LaunchAgents/`
- **Linux / WSL2** → systemd user service (`systemctl --user`)
- **Windows** → Scheduled Task

All managed through `openclaw onboard --install-daemon` and
`openclaw gateway install/uninstall/start/stop/status`. Detect the
platform via `coreAPI.getPlatform()` and call the matching subcommand.

Settings page exposes:

- "Auto-start at login" checkbox (install/uninstall daemon)
- "Restart gateway" button
- Live status pill (running / stopped / unhealthy)

---

## 6. Branding

- App name in UI: **"OpenClaw"**.
- Window title: "OpenClaw Control Panel".
- Reuse all dark glass design tokens from Ronbot's `index.css` —
  same violet/cyan accents, Inter / JetBrains Mono.

---

## 7. Repo bootstrap for Cursor

1. Remix the Ronbot Lovable project → push to a fresh GitHub repo
   named `openclaw-control-panel`.
2. Open in Cursor. The `.cursorrules` file at repo root applies
   automatically.
3. Rename references:
   - `package.json` → `"name": "openclaw-control-panel"`,
     `"productName": "OpenClaw"`, update `pack:*` script names.
   - `electron/main.cjs` → window title, tray icon, single-instance
     lock key.
   - `index.html` → `<title>OpenClaw Control Panel</title>`.
4. Strip Hermes-specific code from `src/lib/systemAPI/`:
   - **Keep**: `core.ts`, `sudo.ts`, `secretsStore.ts`,
     `browserSetup.ts`, `prereqs.ts`, `types.ts`, `index.ts`.
   - **Replace** `hermes.ts` with a new `openclaw.ts` that exposes:
     - `runOpenclaw(args, { profile?, dev? })` — single helper every
       other function uses.
     - Install path helpers: `installViaCurl()`, `installLocalPrefix()`,
       `installDocker()`.
     - Lifecycle: `doctor()`, `gatewayStatus()`, `gatewayInstall()`,
       `gatewayStart()`, `gatewayStop()`, `update()`, `uninstall()`,
       `backup()`, `reset()`.
     - Domain helpers: `listAgents()`, `addAgent()`, `bindAgent()`,
       `listChannels()`, `loginChannel()`, `listSkills()`,
       `installSkill()`, `listSessions()`, `tailLogs()`, `listCron()`,
       `listTasks()`, `listHooks()`, `listWebhooks()`,
       `securityAudit()`, `secretsAudit()`.
5. Add the profile switcher to `SettingsContext` — every CLI call
   reads the active profile and `--dev` flag from there.
6. Re-skin the install wizard pages to the three install paths in §2.
7. Replace Ronbot-specific pages with the screens in §4.

---

## 8. Things Cursor must NOT do for OpenClaw

- **Do not** assume Anthropic. The user picks the provider in §3.1.
  Default highlighted tile is **OpenRouter**, not Anthropic.
- **Do not** hardcode `~/.openclaw/`. Read the install dir from the
  active profile (`~/.openclaw-<profile>` when a profile is set).
- **Do not** call `pnpm` / `npm` / `bun` directly from the renderer.
  Everything goes through `runCommand` so Electron handles env, sudo,
  and stream lifecycle.
- **Do not** swallow `openclaw doctor` warnings — surface them
  verbatim in Diagnostics.
- **Do not** auto-approve sandbox / approval requests. Always
  surface them in the Approvals screen with the same dialog pattern
  Ronbot uses (`CapabilityApprovalDialog.tsx`).

---

## 9. First Cursor prompt (paste verbatim into a fresh chat)

> Read `docs/cursor/HANDOFF-OPENCLAW.md` and `.cursorrules` end to
> end before writing any code. Then convert this codebase into the
> OpenClaw Control Panel as specified, starting with the three
> install paths in §2. Replace `src/lib/systemAPI/hermes.ts` with
> `openclaw.ts` exposing the helpers in §7.4, rewire the install
> wizard pages, and update branding per §6. Do not modify the
> Electron IPC patterns, secrets storage, or design tokens — those
> are shared across all three control panels in the family.
