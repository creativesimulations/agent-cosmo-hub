
# Installation Wizard — Hardening Plan

## What the wizard does today

```
SetupHub → (optional) ConnectPanel / ExistingInstallGuard
        → WizardChrome
              ├── PrereqsStep        (scan + auto-fix)
              ├── InstallStep        (preflight → apt → curl|bash → verify)
              └── DoneStep
```

- Probe order: `setupService.probeAgent()` → if not ready → `evaluateInstallContract()` → optional recommended (`ripgrep`, host `curl`).
- All "guest" checks (git, curl/wget, python3, network) run inside the shell where Hermes installs: WSL Ubuntu on Windows, native bash on macOS/Linux.
- The actual install is the **official Hermes curl-pipe**: `bash <(curl … hermes-agent/main/scripts/install.sh)` — this stays. It always pulls the latest Hermes from the official repo, which is what the user asked for.

## Bugs causing false negatives + manual terminal trips

### 1. Guest probes use a sterile PATH — biggest source of false negatives
`installContract.ts → runInHermesDomain` invokes `bash -lc "command -v git && git --version"` **without** exporting the standard install paths.

Consequences:
- **macOS (Apple Silicon)**: Homebrew lives in `/opt/homebrew/bin`. A non-interactive `bash -lc` (the user's default shell is usually zsh, so bash login files are empty) misses it → `git`, `curl`, `python3` all report missing even though they are installed.
- **Linux**: tools in `/usr/local/bin`, `~/.local/bin`, snaps in `/snap/bin`, and asdf/pyenv shims are missed.
- **Windows/WSL**: similar — anything the user installed via `~/.local/bin` (e.g. `uv`) is missed.

Fix: Reuse the same `HERMES_PATH_EXPORT` constant already defined in `src/lib/systemAPI/hermes/shell.ts` (it exports venv + `~/.local/bin` + `/usr/local/bin` + `/opt/homebrew/bin` + `/snap/bin`) and prepend it to every guest probe in `installContract.ts`. Switch `runInHermesDomain` to call `runHermesShell` (which already handles base64-encoding, WSL wrapping, quoting safely) instead of hand-rolled `bash -lc "${escaped}"`.

### 2. `checkGuestBinary` returns false when the binary prints to stderr
`command -v X >/dev/null 2>&1 && X --version 2>/dev/null | head -1` — for tools like `wget --version` exit code is 0 and stdout works, but combined with stricter shells / SIGPIPE on `head` we sometimes get empty stdout → "installed: false". Replace with a more tolerant probe: rely on `command -v` for "installed" and fall back to a separate `--version` call for the version label.

### 3. WSL detection on Windows is fragile
`wsl --status` and `wsl -l -v` output **UTF-16LE** on stock Windows. `child_process.exec` returns it as a UTF-8 string with null bytes between every character → the regexes `Default Version:\s*(\d+)` and `\*\s+(\S+)\s+\w+\s+(\d+)` never match → "WSL not installed".

Fix: in `electron/main/commands.cjs`, for any command starting with `wsl ` (not `wsl bash -lc`), spawn with `WSL_UTF8=1` in the env (supported in WSL ≥ 0.64), and as a belt-and-suspenders strip null bytes in the renderer parser. Add a tiny helper in `prereqs.ts → checkWSL` that re-parses with both encodings.

### 4. "Auto-fix" buttons silently fail when sudo needs a password
`prereqScan.ts → installAptWithCapability` only succeeds when sudo is `root`/`passwordless`. For `needs-password` / `no-password-set` it returns an error string telling the user to run `sudo apt-get install …` in a terminal. This violates the "user never touches the terminal" requirement.

Fix: route through the existing `SudoPromptContext` (used during install). Lift the sudo dialog so it's available during the Prereqs step too. The auto-fix handler:
1. Probes sudo. If passwordless → run directly.
2. If `needs-password` → call `requestSudoPassword(reason)` which opens `SudoPasswordDialog`, then `sudoAPI.aptInstall(packages, password)`.
3. If `no-password-set` → open the same dialog in "set password" mode, then `sudoAPI.setUserPassword` then retry.
4. macOS → already supports native `osascript` GUI prompt via `promptForPasswordMac`; reuse it here.
5. Windows-host installs (winget/wsl --install) → already user-elevation via UAC; no change.

### 5. `wsl --install` auto-fix can't elevate from Electron
`installWSL()` calls `wsl --install` directly. From a non-elevated Electron renderer that fails with "Access denied".

Fix: on Windows, run via PowerShell `Start-Process -Verb RunAs` so Windows pops the standard UAC consent dialog. After it returns, set the `wsl2` row to `reboot_required` (already supported by `PrereqStatus`).

### 6. Ubuntu distro auto-install is marked "manual"
The contract sets `wsl-distro` to `fixable_manual` with a copy-able `wsl --install -d Ubuntu` command. We can auto-install it via the same elevated PowerShell path. Mark it `autoInstallId: "wsl-distro"` and add a handler in `installPrereqItem` that runs the elevated install + waits for the first boot prompt.

### 7. `checkHermesLauncherPath` only accepts hard-coded paths
After installation, post-install verification rejects launchers that aren't in `/.local/bin`, `/venv/bin`, or `/usr/local/bin`. The official installer in Hermes v0.13 may also drop the entrypoint into `~/.hermes/bin/hermes` (when uv-managed). Add this path to the allow-list so a successful install isn't reported as "unexpected launcher path".

### 8. Inline tweaks for clarity / robustness
- Drop the redundant **host** `curl` row when the platform is Windows (curl on the host is irrelevant; Hermes runs in WSL).
- Replace the `BASE` array's `windowsOnly` filtering shortcut (`splice` in `applyContract`) with a single filter pass so removed items never re-appear after a re-scan.
- Cache the contract result for the lifetime of the wizard step (skip second redundant evaluation when the user clicks "Rescan" within 2s — same idea as `probeCache`).

## Files to edit

```text
src/features/setup/installContract.ts        Reuse HERMES_PATH_EXPORT + runHermesShell;
                                              tolerant guest binary probe; cache result
src/features/setup/prereqScan.ts             Route auto-fix through SudoPromptContext;
                                              add wsl-distro auto-install; drop host curl
                                              row on Windows
src/features/setup/runAgentInstall.ts        Use new sudo flow (no duplicate dialog logic)
src/features/setup/components/PrereqsStep.tsx Replace inline install-one with hook that
                                              uses useSudoPrompt + toast on failure
src/lib/systemAPI/prereqs.ts                 checkWSL → utf-8 reparse, WSL_UTF8 env;
                                              installWSL → elevated PowerShell launcher;
                                              new installWSLDistro('Ubuntu')
src/lib/systemAPI/hermes/installProbe.ts     Allow ~/.hermes/bin/hermes path
src/features/setup/setupService.ts           Accept new launcher path in
                                              checkHermesLauncherPath
electron/main/commands.cjs                   Inject WSL_UTF8=1 for wsl.* commands;
                                              strip BOM/null bytes on stdout when
                                              command starts with "wsl "
src/contexts/SudoPromptContext.tsx           Expose during PrereqsStep (already wired
                                              for install; just ensure provider wraps
                                              the wizard route)
```

## What we are NOT changing

- The official `curl … | bash` installer remains the sole install path; we still pull from `NousResearch/hermes-agent/main`. The user explicitly asked for the latest from the official repo.
- The bundled Ubuntu/macOS/Windows bootstrap scripts in `scripts/bootstrap/` stay as the MDM/locked-down fallback documented in `docs/hermes-managed-bootstrap.md`.
- No backend / Lovable Cloud changes — this is a desktop Electron client.

## Verification

1. `vitest run src/features/setup` (contract + prereq scan tests; add 3 new cases: macOS Homebrew path, WSL UTF-16 status, sudo-needs-password auto-fix).
2. Manual: on each of macOS / Ubuntu / Windows+WSL, fresh-install a clean VM, open Ronbot:
   - Prereqs page shows no red rows when tools are present (no false negatives).
   - Each red row's "Auto-fix" button either resolves silently (passwordless), pops the in-app password dialog, or pops native UAC/polkit — never directs the user to a terminal.
   - Install proceeds end-to-end into `~/.hermes` and the connect step succeeds.
3. Confirm `hermes --version` reports the latest GitHub release after install.

