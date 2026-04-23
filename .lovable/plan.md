

# Align Ronbot with official Hermes setup + correct permissions, skills & tools intake

## Why this is needed

The agent currently can't browse the web because we write `toolsets: [hermes-web]` (not a real Hermes toolset) plus invented keys (`browser.enabled`, `browser.allow_network`, `browser.tool_allowlist`) that Hermes ignores or rejects. We also gate trivial web access behind a browser-backend wizard, miss `ripgrep`, and don't surface terminal sandboxing or a path for users to drop in their own Hermes skills/tools.

## Part 1 — Toolsets, config schema & defaults

**`src/lib/systemAPI/hermes.ts`**
- Replace `BROWSER_DEFAULT_TOOLSETS = ['hermes-web']` with the official platform bundle: `toolsets: [hermes-cli]`. This natively registers `web`, `browser`, `terminal`, `file`, `vision`, `image_gen`, `tts`, `memory`, `todo`, `clarify`, `delegation`, `code_execution`, `cronjob`, `skills`, `session_search`, `messaging`.
- Reduce the `browser:` block to documented keys only: `cdp_url` (when set) and Camofox `managed_persistence`. Drop `enabled`, `allow_network`, `tool_allowlist`.
- `writeInitialConfig` writes `toolsets: [hermes-cli]` from the start so a fresh agent has working web/terminal/file/browser immediately.
- New `repairConfig()` helper: rewrites `toolsets`, strips bogus keys, re-chmods `node_modules/.bin/*`, re-runs `hermes doctor`, then sends a chat ping.
- Update `getBrowserDiagnostics()` to look for `hermes-cli` (not `hermes-web`).

## Part 2 — Permissions aligned to the new toolset

Currently `PermissionsConfig` (`src/lib/permissions.ts`) only knows `shell / fileRead / fileWrite / internet / script`. With `hermes-cli` loaded, the agent now has `browser_*`, `vision`, `image_gen`, `tts`, `code_execution`, `delegation`, `cronjob`, `messaging` — all currently falling into the generic `fallback` bucket.

**`src/lib/permissions.ts`**
- Extend `PermissionAction` with: `browser`, `codeExecution`, `delegation`, `cronjob`, `messaging`, `imageGen`, `tts`.
- Extend `PermissionsConfig` with matching defaults (sensible: `browser: ask`, `codeExecution: ask`, `delegation: allow`, `cronjob: ask`, `messaging: ask`, `imageGen: allow`, `tts: allow`).
- Update `RISK_BY_ACTION` and `PERMISSION_LABELS` for each.
- Bump `DEFAULT_PERMISSIONS.internet` to `'allow'` so the basic web tool works on first run (it's the #1 user complaint).

**`src/lib/systemAPI/hermes.ts` → `writeHermesPermissions`**
- Emit the new keys in the managed permissions block in `config.yaml` using Hermes' documented permission schema (per-tool `allow|ask|deny`).

**`src/components/permissions/PermissionsPanel.tsx`**
- Add rows for the new permission classes, grouped under "Web & browsing", "Code & execution", "Agent collaboration", "Media".

**`src/lib/toolUseDetection.ts` & `src/lib/capabilities.ts`**
- Map the official `hermes-cli` tool names (`web_search`, `web_extract`, `browser_navigate`, `browser_click`, `code_execution_run`, `image_gen_create`, `tts_speak`, `delegation_spawn`, `cronjob_create`, `messaging_send`) to the new capability IDs so proactive gating fires correctly.

## Part 3 — Skills & tools intake (user-supplied Hermes packs)

So users can drop in any Hermes-compatible skill they download:

**`src/lib/systemAPI/hermes.ts`**
- New `installSkillFromPath(srcPath)`: copies a folder into `~/.hermes/skills/<name>/`, validates it has the Hermes-required `manifest.yaml` (or `skill.yaml`), then reloads the skills list.
- New `installSkillFromGit(url)`: `git clone` into `~/.hermes/skills/<name>` then validate.
- New `installToolFromPath(srcPath)`: same flow but into `~/.hermes/tools/`.
- All three auto-add the skill/tool name to `config.yaml` `skills.enabled:` / `tools.enabled:` and re-chmod any executables.

**`src/pages/Skills.tsx`**
- Add an "Install skill" button with two options: "From folder…" (uses the existing `selectFolder` API) and "From Git URL…".
- After install, show validation result (manifest found, required secrets, executables fixed) and offer to open the secrets page if any are missing.

**`src/pages/SettingsPage.tsx`** (new collapsible "Tools & skills" section)
- "Install tool from folder / Git" mirroring the skills flow.
- "Reload toolsets" button calling a new `hermesAPI.reloadToolsets()`.
- "Open `~/.hermes/skills` folder" using `revealInFolder` so power users can drop files in directly.

## Part 4 — Don't gate basic web on the browser wizard

**`src/components/skills/BrowserSetupDialog.tsx`** and the post-install screen
- Reframe as a two-tier UX:
  - **Tier 1 (automatic)**: `web_search`, `web_extract`, terminal, files, vision, code execution — work out of the box.
  - **Tier 2 (optional)**: pick Chrome / Camofox / Browserbase only for click/type/screenshot automation.
- Show a "Web is already working" banner when `hermes-cli` is loaded so users stop being told they need a backend.

## Part 5 — Prereqs trimmed to what Hermes actually requires

**`src/lib/systemAPI/prereqs.ts`** & **`src/pages/PrerequisiteCheck.tsx`**
- Add `checkRipgrep` + `installRipgrep` (apt / brew / WSL winget).
- Demote Python, pip, Node, ffmpeg from "required" to "auto-installed by Hermes" (the official `install.sh` brings them in via `uv`).
- Required list becomes: **git** (all), **WSL2** (Windows), **ripgrep** (all).

## Part 6 — Optional but high-value polish

- **`src/contexts/InstallContext.tsx`**: after `hermes doctor` passes, do one silent `hermes chat -p "ping"` round-trip and report success/failure as the final wizard step. Catches "doctor green but provider auth wrong" — the #1 silent failure in the docs.
- **`src/pages/SettingsPage.tsx`**: new collapsible "Sandbox" section with a `terminal.backend` dropdown (`local` / `docker` / `ssh`) + relevant env-var fields routed through the secrets store.
- **`src/pages/Diagnostics.tsx`**: "Repair config" button calling the new `repairConfig()` helper. Single click fixes any machine broken by previous attempts.

## Files edited

- `src/lib/systemAPI/hermes.ts` (toolsets, browser block, permissions writer, skill/tool installers, repair, reloadToolsets)
- `src/lib/systemAPI/prereqs.ts` (ripgrep + demotions)
- `src/lib/permissions.ts` (new actions + defaults)
- `src/components/permissions/PermissionsPanel.tsx` (new rows + groups)
- `src/lib/toolUseDetection.ts`, `src/lib/capabilities.ts` (new tool→capability mappings)
- `src/pages/Skills.tsx` (install from folder/Git, validation, missing-secret prompts)
- `src/pages/SettingsPage.tsx` (Tools & skills section, Sandbox section)
- `src/pages/PrerequisiteCheck.tsx` (split required vs auto-installed)
- `src/components/skills/BrowserSetupDialog.tsx` (Tier 1 / Tier 2 reframe)
- `src/contexts/InstallContext.tsx` (post-doctor chat ping; default `web` description)
- `src/pages/Diagnostics.tsx` ("Repair config" button)

## Outcome

After this change, a fresh install on Linux / macOS / WSL2:

1. Browses the web and reads pages immediately — no extra setup.
2. Has the official `hermes-cli` toolset loaded with all 36 tools the docs describe.
3. Has fine-grained per-tool permissions (browser, code execution, delegation, cron, messaging, image, tts) shown in the Permissions panel and synced to `config.yaml`.
4. Lets users drop in any downloaded Hermes skill or tool from a folder or Git URL — auto-validated, auto-enabled, secrets prompted.
5. Has a one-click "Repair config" path for machines broken by prior installer attempts.
6. Optionally upgrades to full browser automation, Docker/SSH terminal sandboxing, and other extras — but never blocks basic web behind them.

