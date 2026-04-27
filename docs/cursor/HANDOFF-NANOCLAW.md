# NanoClaw v2 Control Panel — Cursor handoff

> **Read this entire document before writing any code.** The most
> important fact about NanoClaw is in §0. If you skip it you will
> design the wrong app.

---

## 0. The non-negotiable truth

**NanoClaw v2 fundamentally requires Anthropic's Claude Code CLI at
install time and for `/customize`, `/debug`, error recovery, and every
`/add-*` skill.** This is not negotiable; it is the architecture.

The *runtime agent* provider IS swappable per agent group:

- **OpenCode** → OpenRouter / OpenAI / Google / DeepSeek / Groq / etc.
- **Ollama** → fully local models
- **Codex** → OpenAI Codex

…but the **harness** that orchestrates groups, customizes them, and
runs recovery flows is Claude Code. NanoClaw's installer pipes slash
commands into a `claude` session to bootstrap and modify the system.

The control panel makes this honest:

1. Up front, during install: explain Claude Code is required for
   setup and customization, and walk the user through installing it
   and pasting their `ANTHROPIC_API_KEY`.
2. Right after install: present a "Choose your runtime provider"
   wizard so the user can switch agent groups to OpenCode or Ollama.
3. In the help text everywhere: link to the NanoClaw README's "Best
   harness, best model" section so the user understands *why* both
   exist.

Source: NanoClaw repo at <https://github.com/qwibitai/nanoclaw>.

---

## 1. What this app is

Electron desktop control panel for the **NanoClaw v2** multi-agent
framework. Mirrors the Ronbot codebase one-for-one in architecture,
design, and IPC patterns — only the agent-specific layer
(`src/lib/systemAPI/nanoclaw.ts`) is new.

Default install location: `~/nanoclaw-v2/` (configurable in the
preflight step).

---

## 2. Install flow — three wizard stages

### Stage A — Prerequisites
Mirror `src/components/install/InstallPreflight.tsx`. Each row shows
green / yellow / red plus an "Install" button:

| Prereq | Verify | Install path |
| --- | --- | --- |
| Node 20+ | `node --version` | nvm / Homebrew / winget / apt |
| pnpm 10+ | `pnpm --version` | `npm i -g pnpm@latest` |
| Docker | `docker info` (daemon must be up) | reuse `installDocker()` from `browserSetup.ts` |
| Claude Code CLI | `claude --version` | external link to `https://claude.ai/download` — **never auto-install silently** |

### Stage B — Anthropic credential
A `SecretForm` instance pre-filled with the `ANTHROPIC_API_KEY`
preset. Optional second field for `ANTHROPIC_BASE_URL` (Bedrock /
Vertex / proxy). Stored via the existing `secretsStore` (`keytar`).

Inline help, verbatim:

> "Claude Code is used to set up and customize NanoClaw. After
> install you can switch the *agents* to OpenCode or Ollama and stop
> paying for Claude tokens during normal operation. Claude is still
> used for `/customize`, `/debug`, and adding new skills."

### Stage C — Clone + run
Stream the install live into the same scrolling log component used
by Ronbot:

```bash
git clone https://github.com/qwibitai/nanoclaw.git ~/nanoclaw-v2
cd ~/nanoclaw-v2
bash nanoclaw.sh
```

Use `runCommandStream` and store the unsubscribe in a ref. On exit
code 0 → advance to §3. On non-zero → surface the last 30 lines and
offer "Retry" / "Open install dir" / "Copy log".

---

## 3. Post-install "Choose your runtime provider" wizard

Three tiles in a card grid. Tile selection runs the corresponding
NanoClaw skill by piping a slash command into a `claude` session:

| Tile | Action | Verification |
| --- | --- | --- |
| **Keep Claude (default)** | no-op | `claude --version` |
| **Switch to OpenCode** | `claude /add-opencode` | grep group config for `provider: opencode` |
| **Switch to Ollama (local)** | `claude /add-ollama-provider` | `ollama list` returns ≥1 model |

Below the tiles, a per-agent override list:

- Read `~/nanoclaw-v2/groups/*/CLAUDE.md` (or equivalent group config).
- Show one row per group with a `Select` component for provider.
- Saving runs the matching `/add-*` skill scoped to that group.

A small "Why is Claude still required?" link opens an inline
explanation card.

---

## 4. Control-panel screens

Mirror Ronbot's sidebar exactly; rename and re-wire data sources:

| Screen | Data source |
| --- | --- |
| Dashboard | `nanoclaw.sh status`, `docker ps`, daemon health |
| Channels | `/add-telegram`, `/add-discord`, `/add-whatsapp`, `/add-slack`, `/add-imessage` — each via `ChannelWizard.tsx` clone |
| Agent Groups | list `groups/*`, edit `CLAUDE.md` in a Monaco-style textarea, view per-group memory |
| Sessions | live tail of `inbound.db` / `outbound.db` per session (sqlite read-only via IPC) |
| Skills | registry of installed `/add-*` skills; install new ones from the channels/providers branches |
| Logs | `~/nanoclaw-v2/logs/*.log` tail |
| Diagnostics | `bash nanoclaw.sh --doctor` (or equivalent) |
| Settings | install dir, Anthropic key rotation, default trigger word |
| Backup / Restore | tar of `~/nanoclaw-v2/` minus `node_modules` |

---

## 5. Branding

- App name in UI: **"NanoClaw"**.
- Window title: "NanoClaw Control Panel".
- Default agent trigger word: `@Andy` (editable on first run).
- Reuse all dark glass design tokens from Ronbot's `index.css` —
  same violet/cyan accents, Inter / JetBrains Mono. Visual continuity
  across the three apps is intentional.

---

## 6. Repo bootstrap for Cursor

1. Remix the Ronbot Lovable project → push to a fresh GitHub repo
   named `nanoclaw-control-panel`.
2. Open in Cursor. The `.cursorrules` file at repo root applies
   automatically.
3. Rename references:
   - `package.json` → `"name": "nanoclaw-control-panel"`,
     `"productName": "NanoClaw"`, update `pack:*` script names.
   - `electron/main.cjs` → window title "NanoClaw Control Panel",
     update tray icon path, single-instance lock key.
   - `index.html` → `<title>NanoClaw Control Panel</title>`.
4. Strip Hermes-specific code from `src/lib/systemAPI/`:
   - **Keep**: `core.ts`, `sudo.ts`, `secretsStore.ts`,
     `browserSetup.ts`, `prereqs.ts`, `types.ts`, `index.ts`.
   - **Replace** `hermes.ts` with a new `nanoclaw.ts` that exposes:
     - `installFromGitHub()`, `runDoctor()`, `getStatus()`,
       `cloneRepo()`, `runNanoclawScript(args)`,
       `runClaudeSlash(skill, scope?)`,
       `listGroups()`, `readGroupConfig(name)`, `writeGroupConfig(name, body)`,
       `tailSessionDb(sessionId)`, `installChannelSkill(channel)`.
5. Replace every `~/.hermes/` path with the user's chosen install dir
   (default `~/nanoclaw-v2/`). Store the dir in `SettingsContext`.
6. Replace `hermes` CLI invocations with `bash nanoclaw.sh <subcmd>`
   and `claude /<skill>` invocations.
7. Re-skin the install wizard pages to the three stages in §2.
8. Replace Ronbot-specific pages (`AgentChat`, `LLMConfig` for
   Hermes) with the screens listed in §4.

---

## 7. Things Cursor must NOT do for NanoClaw

- **Do not** try to remove the Claude Code dependency at install
  time. Removing it breaks `nanoclaw.sh` recovery and every `/add-*`
  skill. The "Choose runtime provider" wizard in §3 is the correct
  way to reduce Claude usage.
- **Do not** auto-install Claude Code silently. Always show what's
  being installed and link to the upstream download
  (`https://claude.ai/download`). Verify post-install via
  `claude --version`.
- **Do not** store the Anthropic key in `.env` files inside the
  cloned repo. Use `secretsStore` (keytar) and materialize on demand
  for processes that need it.
- **Do not** touch any `~/.hermes/` paths — completely separate
  install tree from Ronbot.
- **Do not** assume the install dir — read it from `SettingsContext`
  every time.

---

## 8. First Cursor prompt (paste verbatim into a fresh chat)

> Read `docs/cursor/HANDOFF-NANOCLAW.md` and `.cursorrules` end to
> end before writing any code. Then convert this codebase into the
> NanoClaw Control Panel as specified, starting with the install
> flow in §2. Replace `src/lib/systemAPI/hermes.ts` with
> `nanoclaw.ts`, rewire the install wizard pages, and update
> branding per §5. Do not modify the Electron IPC patterns,
> secrets storage, or design tokens — those are shared across all
> three control panels in the family.
