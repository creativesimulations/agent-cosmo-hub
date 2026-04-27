

# Cursor handoff: working on Ronbot, plus replicas for NanoClaw v2 and OpenClaw

## What you'll get

Three Markdown handoff files committed to `docs/cursor/` in this repo, plus a shared `.cursorrules` Cursor will auto-load when you open the project. Each per-app doc is self-contained: architecture, install flow, branding, and copy-paste prompts you can hand Cursor as it scaffolds the two new apps.

```text
docs/cursor/
  HANDOFF-RONBOT.md       ← this app, today, with Cursor onboarding
  HANDOFF-NANOCLAW.md     ← spec for the new NanoClaw control panel
  HANDOFF-OPENCLAW.md     ← spec for the new OpenClaw control panel
.cursorrules              ← shared TS/Tailwind/Electron/glass conventions
```

The two new app docs are *specs Cursor builds from*, not code we ship here. You take the doc + this codebase as a starting template, ask Cursor to "remix" it into a new repo, and iterate.

---

## File 1 — `docs/cursor/HANDOFF-RONBOT.md` (this app)

Sections, in order:

1. **What this app is** — Electron desktop installer + control panel for the Hermes agent (NousResearch). White-label-ready, currently branded "Ronbot" but Hermes name is now allowed in UI per latest direction.
2. **Tech stack** — Vite 5 + React 18 + TypeScript 5 + Tailwind 3 + shadcn/ui + framer-motion + Electron 41 packaged with `@electron/packager`. HashRouter (file:// safe). State via React contexts (no Redux/Zustand).
3. **Repo map** — annotated tree of `src/contexts/`, `src/lib/systemAPI/`, `src/pages/`, `electron/main.cjs` (IPC handlers), `electron/preload.cjs` (bridge surface).
4. **Critical patterns Cursor must preserve**
   - All OS access goes through `window.electronAPI` → `src/lib/systemAPI/*`. Never `child_process` from renderer.
   - Secrets via `keytar` (`secretsStore`), never written raw to `.env` by the UI; we materialize on demand.
   - Streaming commands: `runCommandStream` + `onCommandOutput` listener; always store the unsubscribe and call it on unmount.
   - YAML edits to `~/.hermes/config.yaml` use the `BROWSER_BEGIN`/`BROWSER_END`-style managed-block markers + `repairBrokenYamlList` heal step. Don't free-form edit YAML.
   - Capability/permission decisions live in `CapabilitiesContext`; never check role/permission from a component.
5. **Build & package** — `bun install`, `bun run dev`, `bun run pack:mac`/`pack:win`/`pack:linux`. Electron entry: `electron/main.cjs`. Vite `base: "./"` is mandatory.
6. **Cursor onboarding prompts** — five copy-paste prompts: "Add a new page", "Add a new IPC handler", "Add a new managed YAML block", "Wire a new secret preset", "Add a new browser backend". Each prompt explicitly references the patterns in §4.
7. **Things Cursor must NOT do** — no Anthropic Claude SDK in the agent backend (Hermes is provider-agnostic), no Supabase / Lovable Cloud (this is a pure local desktop app), no React Router `BrowserRouter`, no inline styles for theming (use design tokens from `index.css`).
8. **Known live issues / tech debt** — link to recent fixes (browser self-test, session-not-found auto-retry, Skills badge noise) so Cursor doesn't reintroduce them.

---

## File 2 — `docs/cursor/HANDOFF-NANOCLAW.md`

The truth Cursor needs first, before any UI work:

**NanoClaw fundamentally requires Claude Code (Anthropic's Claude Agent SDK) at install time and for `/customize`, `/debug`, error recovery, and every `/add-` skill.** The runtime *agent* provider is swappable per-group (OpenCode → OpenRouter/OpenAI/Google/DeepSeek, Ollama for local, Codex for OpenAI), but Anthropic credentials and the Claude Code CLI are non-negotiable for setup.

Per your latest direction, the panel will:

1. **Install flow (3 stages, each its own wizard step)**
   - **Stage A — Prerequisites:** Node 20+, pnpm 10+, Docker Desktop / Docker Engine, **Claude Code CLI** (download from claude.ai/download). Each gets a green/yellow/red status row mirroring our current `InstallPreflight.tsx`. The Claude Code row links to install docs and verifies via `claude --version`.
   - **Stage B — Anthropic credential:** clear explanation that Claude Code is needed *only to set up and customize* NanoClaw. Stores `ANTHROPIC_API_KEY` via the same `keytar`-backed `secretsStore` we already use. Optional: paste an `ANTHROPIC_BASE_URL` for proxy/Bedrock/Vertex.
   - **Stage C — Clone + run:** `git clone https://github.com/qwibitai/nanoclaw.git nanoclaw-v2 && cd nanoclaw-v2 && bash nanoclaw.sh`, streamed live into the same scrolling log component we use for Hermes.

2. **Post-install "Choose your runtime provider" wizard** *(this is the user's added requirement)*
   - Card grid with three tiles: **Keep Claude (default)**, **Switch to OpenCode** (OpenRouter/OpenAI/Google/DeepSeek/etc.), **Switch to Ollama (local)**. Each tile, when chosen, runs the corresponding NanoClaw skill (`/add-opencode` or `/add-ollama-provider`) by piping the slash command into a `claude` session, then verifies the new provider is registered.
   - Per-agent override UI: list agent groups from `groups/`, show current provider, allow per-group switching.
   - "Why is Claude still required?" inline help that links to NanoClaw's README §"Best harness, best model" so the user understands the architecture.

3. **Control-panel screens (mirrors current Ronbot layout)**
   - Dashboard (host process status, container status per agent group, Docker daemon health)
   - Channels (Telegram / Discord / WhatsApp / Slack / iMessage — installed on demand via `/add-<channel>` skills, each renders a wizard like our current `ChannelWizard.tsx`)
   - Agent groups (list `groups/*`, edit `CLAUDE.md`, view per-group memory)
   - Sessions (live tail of `inbound.db`/`outbound.db` per session)
   - Skills (registry of installed `/add-` skills; install new from the channels/providers branches)
   - Logs, Diagnostics (`bash nanoclaw.sh --doctor` equivalent), Settings, Backup/Restore

4. **Branding**
   - App name visible in UI: "NanoClaw" (your latest direction allows it). Window title: "NanoClaw Control Panel". Default agent trigger word stays `@Andy` but is editable on first run.
   - Reuse the dark glass design tokens (violet/cyan, Inter, JetBrains Mono) for visual continuity across all three apps.

5. **Repo bootstrap instructions for Cursor**
   - Remix this Lovable project to a fresh repo, rename to `nanoclaw-control-panel`.
   - Strip everything Hermes-specific from `src/lib/systemAPI/` (keep `core.ts`, `sudo.ts`, `secretsStore.ts`, `browserSetup.ts`; replace `hermes.ts` with a new `nanoclaw.ts`).
   - Replace `~/.hermes/` paths with the user's chosen install dir (default `~/nanoclaw-v2/`).
   - Replace `hermes` CLI invocations with `bash nanoclaw.sh <subcommand>` and `claude /<skill>` invocations.
   - Update `package.json` `pack:*` scripts to output `NanoClaw` artifacts.

6. **Things Cursor must NOT do for NanoClaw**
   - Do **not** try to remove the Claude Code dependency at install time — it's the recovery path; removing it breaks `nanoclaw.sh`.
   - Do **not** auto-install Claude Code silently; always show the user what's being installed and link to the upstream download.
   - Do **not** store the Anthropic key in `.env` files inside the repo; use `keytar` only.
   - Do **not** touch `~/.hermes/` paths — completely separate install tree.

---

## File 3 — `docs/cursor/HANDOFF-OPENCLAW.md`

Cleaner story — OpenClaw has no Anthropic dependency. Default provider is configurable (Anthropic, OpenAI, OpenRouter, Google, Ollama, Groq, Mistral, …~40 providers).

1. **Install paths exposed in UI (your choice: installer + local prefix + Docker)**
   - **Recommended:** `curl -fsSL https://openclaw.ai/install.sh | bash` (mac/Linux/WSL2) or `iwr -useb https://openclaw.ai/install.ps1 | iex` (Windows). One green "Install" button, optional `--no-onboard` toggle.
   - **Sandboxed (local prefix):** `curl -fsSL https://openclaw.ai/install-cli.sh | bash` — installs under `~/.openclaw`, no system Node touched. Recommended for users who already manage Node.
   - **Containerized (Docker):** docker-compose template + `openclaw onboard --install-daemon` inside the container. Wizard checks Docker Desktop/Engine first using the same detection we already have in `browserSetup.ts`.

2. **Post-install onboarding wizard**
   - Picks a model provider from the OpenClaw provider catalog (we'll ship a curated default list of 8: Anthropic, OpenAI, OpenRouter, Google, Groq, DeepSeek, Mistral, Ollama-local; "Show all" expands to the full ~40). Each provider tile uses our existing `SecretForm`/`secretPresets` flow.
   - Sets default model: `openclaw config set agents.defaults.model.primary "<provider>/<model>"`.
   - Runs `openclaw doctor` and `openclaw gateway status`; surfaces results in the same diagnostics panel pattern we use today.

3. **Control-panel screens (1:1 with the OpenClaw CLI tree from docs)**
   - Dashboard (`openclaw dashboard` + `gateway status` + `health`)
   - Channels (`openclaw channels list/add/remove/login`) — covers WhatsApp/Telegram/Discord/Slack/Mattermost
   - Agents (`openclaw agents list/add/delete/bind`)
   - Models / Providers (`openclaw models`, provider swap UI)
   - Skills & Plugins (`openclaw skills search/install`, `openclaw plugins list/install`)
   - Memory & Wiki (`openclaw memory status/search`, `openclaw wiki status/search`)
   - Sessions, Logs (`openclaw sessions`, `openclaw logs`)
   - Cron / Tasks / Hooks / Webhooks (`openclaw cron|tasks|hooks|webhooks`)
   - Sandbox & Approvals (`openclaw approvals`, `openclaw sandbox`) — important: surface the runtime exec policy clearly
   - Backup / Reset / Update / Uninstall (`openclaw backup|reset|update|uninstall`)
   - Diagnostics (`openclaw doctor`, `openclaw security audit`, `openclaw secrets audit`)

4. **Daemon management**
   - macOS LaunchAgent, Linux/WSL2 systemd user service, Windows Scheduled Task — all via `openclaw onboard --install-daemon` / `openclaw gateway install`. The wizard offers "Auto-start at login" as a checkbox; we run the right command per platform (we already detect platform in `coreAPI.getPlatform()`).

5. **Branding**
   - App name visible in UI: "OpenClaw" (allowed). Window title: "OpenClaw Control Panel". Reuse dark glass tokens.

6. **Repo bootstrap for Cursor**
   - Same remix-this-repo flow as NanoClaw. Replace `hermes.ts` with `openclaw.ts` in `src/lib/systemAPI/`. Install dir: `~/.openclaw` or `~/.openclaw-<profile>` if user picks `--profile`.
   - Honor the `--dev` and `--profile <name>` global flags throughout the UI (settings → "Profile" dropdown that prepends to every CLI call).

7. **Things Cursor must NOT do for OpenClaw**
   - Do **not** assume Anthropic — the user picks the provider. Default tile in onboarding is OpenRouter, not Anthropic.
   - Do **not** hardcode `~/.openclaw` — read it from `--profile` and `--dev`.
   - Do **not** call `pnpm`/`npm`/`bun` directly from the renderer — go through `runCommand` like everything else.

---

## File 4 — `.cursorrules` (root of every repo)

Single shared file Cursor auto-loads. Key rules:

```text
- Stack: Vite 5 + React 18 + TS 5 + Tailwind 3 + shadcn/ui + Electron 41
- Package manager: bun. Lockfile: bun.lockb. Don't switch to pnpm/npm.
- HashRouter only (file:// compatible). Vite base must stay "./".
- All OS access via window.electronAPI → src/lib/systemAPI/*. No child_process in renderer.
- Secrets: keytar via secretsStore. Never write secrets to .env from the UI.
- Long commands: runCommandStream + onCommandOutput. Always unsubscribe on unmount.
- Managed YAML: use BEGIN/END markers + repair routine; never free-form edit user config.
- Permissions / capabilities: check via CapabilitiesContext, never inline in components.
- Roles, if added: separate user_roles table + has_role() definer fn (Lovable security rule).
- Design tokens: HSL CSS vars in src/index.css. Never use raw colors in components.
- Glass utilities: .glass, .glass-subtle, .glass-strong, .gradient-bg, .glow-primary.
- Fonts: Inter (body), JetBrains Mono (code/terminal).
- shadcn variants only. If you need a new variant, edit the variant file, don't override className.
- Tests: vitest + @testing-library/react. Co-locate as *.test.ts(x).
- Commit style: conventional commits (feat:, fix:, chore:, refactor:, docs:).
- Never reintroduce Lovable Cloud / Supabase to these apps — they're local-first desktop apps.
```

---

## How you'll use this

1. I generate the four files in this repo. You commit and push to GitHub — Cursor opens the repo and immediately sees `.cursorrules` and `docs/cursor/HANDOFF-RONBOT.md`.
2. For NanoClaw: in the Lovable dashboard, "Remix" this project → rename → open in Cursor. First Cursor prompt: "Read `docs/cursor/HANDOFF-NANOCLAW.md` and convert this Ronbot codebase into the NanoClaw Control Panel as specified, starting with the install flow." The doc is written in imperative form so it doubles as Cursor's first prompt.
3. Same for OpenClaw with `HANDOFF-OPENCLAW.md`.

---

## Files created

- `.cursorrules`
- `docs/cursor/HANDOFF-RONBOT.md`
- `docs/cursor/HANDOFF-NANOCLAW.md`
- `docs/cursor/HANDOFF-OPENCLAW.md`

No source code in `src/` or `electron/` is modified — this is a pure documentation drop on the current app, plus two specs for the forks.

