

# Align system analysis, secret naming & chat structure with official Hermes docs

## What's wrong today

1. **Prerequisite scan checks the wrong things.** Per the official docs, the only hard prereqs are **Python 3.11+, Git, WSL2 on Windows**. The Hermes installer brings everything else (uv, ripgrep, ffmpeg, Node, build tools) in itself. Today we mark `curl` and `ripgrep` as **required** (they're not), and we still emit "missing pip" errors when the installer would install pip into its own venv anyway.

2. **Secret env-var names don't match the official Hermes vars.** A few important mismatches:
   - We use `GEMINI_API_KEY` — the docs specify **`GOOGLE_API_KEY`** for Gemini.
   - We're missing **`NOUS_API_KEY`** (Nous Portal — the project's first-party provider).
   - We use `HUGGINGFACE_API_KEY` style — docs use **`HF_TOKEN`**.
   - We're missing **`HERMES_MODEL`** override and **`OPENAI_BASE_URL`** / **`ANTHROPIC_BASE_URL`** for self-hosted/proxied providers.
   - Our messaging vars now match docs (good — already fixed).

3. **Chat call shape doesn't follow the documented Hermes interface.**
   - Docs use **`hermes chat -p "<prompt>"`** for one-shot prompts, **`hermes --resume <id>`** at the top level (not `hermes chat --resume <id> -q`).
   - We use `-q` (legacy) and `chat --resume` (legacy subcommand). Both still work on older builds but are being removed in current Hermes. Modern installs will return "unknown option `-q`".
   - We don't pass `--no-color` / `--json` flags Hermes now offers for clean machine-readable output, so we hand-roll ANSI/box stripping that misses new chrome.

## Plan

### 1. `src/lib/systemAPI/prereqs.ts` + `src/pages/PrerequisiteCheck.tsx` — make scan match docs

- **Required (block install):** `os`, `wsl2` (Windows only), `git`, `python3.11+`.
- **Recommended (warn, don't block):** `ripgrep`, `curl`, `ffmpeg`.
- **Auto-installed (info only, never block):** `pip`, `python-venv`, Node, `uv`.
- Reorder UI into three labeled groups so users immediately see what they actually need vs. what Hermes handles.
- Keep all install buttons; just change the `required` flag and the "all required met" gate so a missing `ripgrep` no longer blocks installation.
- Add a **`hermes`** detection row at the top — if Hermes is already installed, the whole prereq screen collapses to a "✓ Hermes is already installed (vX.Y.Z)" banner with a "Re-scan" button.

### 2. `src/lib/secretPresets.ts` — align env-var names to docs

Add / rename presets so what we store matches what `hermes` reads from `~/.hermes/.env`:

| Current | Docs canonical | Action |
|---|---|---|
| `GEMINI_API_KEY` | `GOOGLE_API_KEY` | Rename, keep `GEMINI_API_KEY` as alias for back-compat (auto-mirror on save) |
| — | `NOUS_API_KEY` | Add (Nous Portal) |
| `HUGGINGFACE_API_KEY` | `HF_TOKEN` | Add `HF_TOKEN`; keep old as alias |
| — | `HERMES_MODEL` | Add (overrides `model:` in config.yaml) |
| — | `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, `OPENROUTER_BASE_URL` | Add (for self-hosted/proxy setups) |
| — | `OLLAMA_HOST`, `LMSTUDIO_BASE_URL` | Add (local LLM runtimes) |

Add a small **alias mirror** in `secretsStore.set()`: when the user saves `GEMINI_API_KEY`, also write `GOOGLE_API_KEY` (and vice versa) so both old and new Hermes builds find it. Same for `HF_TOKEN` ↔ `HUGGINGFACE_API_KEY`.

### 3. `src/lib/systemAPI/hermes.ts` — modern `hermes chat` invocation

- Replace `hermes chat -q "$PROMPT"` with **`hermes chat -p "$PROMPT" --no-color`**.
- Replace `hermes chat --resume <id> -q ...` with **`hermes --resume <id> chat -p "..." --no-color`** (matches docs: resume is a top-level flag).
- Add a **capability probe** that runs `hermes chat --help` once on first chat and caches whether `-p` and `--no-color` are supported. If the binary is older and only knows `-q`, fall back automatically — no user-visible failure when someone hasn't run `hermes update` yet.
- Update the `--resume` regex to match both the new footer (`hermes --resume <id>`) and the legacy one (`hermes chat --resume <id>`).
- After install, also run `hermes config check` (documented sanity command) and surface its output in the install summary.

### 4. `src/contexts/InstallContext.tsx` — post-install verification matches docs

After `hermes doctor` passes, run the documented post-install ping sequence:
1. `hermes config check` — schema validation
2. `hermes chat -p "ping" --no-color` — real round-trip

Report each as a separate green/red row in the install-complete screen.

### 5. `src/pages/Diagnostics.tsx` — add "Recommended packages" panel

Show non-blocking status for `ripgrep`, `ffmpeg`, `curl`, `node` with one-click install per platform, so users who skipped them at install time can add them later without re-running the wizard.

## Files edited

- `src/lib/systemAPI/prereqs.ts` — required/recommended split, `hermes` detection
- `src/pages/PrerequisiteCheck.tsx` — three-group UI, gate only on truly required
- `src/lib/secretPresets.ts` — `GOOGLE_API_KEY`, `NOUS_API_KEY`, `HF_TOKEN`, `HERMES_MODEL`, base URLs, local runtime hosts
- `src/lib/systemAPI/secretsStore.ts` — alias mirroring on `set()`
- `src/lib/systemAPI/hermes.ts` — `chat -p` / top-level `--resume`, capability probe, updated regex, `config check`
- `src/contexts/InstallContext.tsx` — post-install `config check` + `chat -p ping` rows
- `src/pages/Diagnostics.tsx` — recommended-packages panel

## Outcome

- Prereq scan blocks install only on what Hermes docs actually require — no more false-positive "ripgrep missing → can't install" loops.
- Secret names match the docs exactly, so a fresh agent picks up provider keys with zero manual `.env` editing. Old aliases keep working for users who saved the previous names.
- Chat uses the documented `hermes chat -p` / `hermes --resume` interface, with automatic fallback to the legacy `-q` form on older binaries — no user-visible breakage during the transition.
- Install completion explicitly verifies via `hermes doctor` + `hermes config check` + a real chat ping, catching every silent-failure path the docs warn about.

