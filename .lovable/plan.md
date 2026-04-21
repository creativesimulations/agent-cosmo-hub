

## Skills & Tools management + cross-platform polish

### 1. Rename Skills → "Skills & Tools"
Sidebar label + page heading updated. No new tab.

### 2. Per-skill enable/disable
- Switch on each skill card. State written to `~/.hermes/config.yaml` under a `skills:` block (`enabled: []` / `disabled: []`) without disturbing other YAML.
- Toast on toggle: **"Saved. Takes effect the next time the agent restarts."** with a "Restart agent now" button for users who want it immediately.
- "Bulk" dropdown: Enable all / Disable all / Enable only [category].

### 3. "What this skill needs" panel
Each card expands to show:
- Description (from SKILL.md).
- **Required secrets** parsed from SKILL.md's Configuration/Environment section. For each:
  - ✅ "Configured" if present in Secrets.
  - ⚠️ "Add" button → deep-links to `/secrets?addKey=<NAME>` (already supported).
- Status pill: **Ready / Needs setup / Disabled**.

### 4. Secrets page clarity
- Header explainer: "Secrets are anything the agent uses to log in — API keys, bot tokens, email passwords. The **name** matters: skills look for exact env-var names like `OPENAI_API_KEY`."
- **"Used by" badge** on each row showing which installed skills reference that env var. Unused secrets get a subtle "Not used by any skill" hint (catches typos like `X` vs `X_BEARER_TOKEN`).
- In Add form, when a multi-field preset is picked (e.g. `SMTP_HOST`), show: "Email also needs SMTP_PORT, SMTP_USER, SMTP_PASS."
- Link from the Add form: "Don't see your service? Open Skills & Tools to find the exact name a skill expects."

### 5. Cross-platform correctness pass (Mac / Windows / Linux)

Audit + fix every place that touches the OS so all three platforms behave identically:

| Area | Fix |
|---|---|
| **Secrets storage** | Already routed through Electron `safeStorage` + keytar — verify keychain works on macOS (Keychain), Windows (DPAPI/Credential Manager), Linux (libsecret). Show clear backend label per OS. |
| **Paths** | All shell commands go through a `wrapBash` helper that uses `wsl bash -lc` on Windows and native `bash -lc` on macOS/Linux. Convert `C:\Users\…` ↔ `/mnt/c/users/…` consistently. Already done for Backups — extend to Skills config read/write, env materialization, and Diagnostics. |
| **Reveal in file manager** | Use `explorer.exe` (Win), `open` (macOS), `xdg-open` (Linux). |
| **Tray icon** | Provide platform-appropriate tray icon (template image on macOS so it tints with menu bar; full-color PNG on Win/Linux). |
| **App quit vs hide** | macOS convention: closing window keeps app in dock; Win/Linux: closing exits unless background mode is on. Already partially done — verify per platform. |
| **Sudo / admin prompts** | macOS uses `osascript` for GUI prompts, Linux uses `pkexec`/passworded `sudo`, Windows uses elevated PowerShell when needed. Existing `SudoPasswordDialog` handles Linux/WSL — add macOS branch. |
| **Keyboard shortcuts** | Use `Cmd` on macOS, `Ctrl` on Win/Linux in any visible hints. |
| **Line endings & file perms** | Write `.env` with `\n` and chmod 600 on macOS/Linux; on Windows write to the WSL-side path with the same perms. |

### 6. Files

**Edit**
- `src/pages/Skills.tsx` — rename, toggles, expandable detail, status pills, bulk actions.
- `src/components/layout/AppSidebar.tsx` — relabel to "Skills & Tools".
- `src/lib/systemAPI/hermes.ts` — add `getSkillsConfig()`, `setSkillEnabled()`; extend `listSkills()` to parse `requiredSecrets` from SKILL.md.
- `src/pages/Secrets.tsx` — header explainer, "Used by" badges, naming-help link.
- `src/components/secrets/SecretForm.tsx` — companion-vars hint.
- `src/lib/systemAPI/sudo.ts` — add macOS `osascript` branch.
- `electron/main.cjs` — platform-aware tray icon, reveal-in-file-manager IPC, macOS dock behavior.
- `electron/preload.cjs` — expose `revealInFolder` IPC.

**No new files. No new sidebar entries.**

### 7. Out of scope (ask after)
- Marketplace for installing *new* skills.
- Editing skill code in-app.
- Real macOS code-signing/notarization (needs an Apple Developer cert; can document but can't do in sandbox).

