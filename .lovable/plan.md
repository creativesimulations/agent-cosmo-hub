

## Cross-platform audit & fixes for macOS and Linux

The app already works on Windows. This plan walks through the install flow + every tab and fixes the spots where macOS or Linux behavior is wrong, missing, or never tested.

### Problems found

**1. Install / Prerequisites flow**
- `installPython` on Linux uses `sudo apt-get install -y` directly, but the Electron `exec` call has no TTY so the password prompt hangs forever. Same for `installPip`, `installCurl`, `installGit` on Linux. On macOS, `brew` may not be installed at all and we fail with a cryptic error.
- `installFfmpeg` on native Linux assumes passwordless sudo; if the user has a password it just exits with a manual-fix message instead of using the existing `SudoPasswordDialog` (which already handles macOS via `osascript`).
- `installPython` on macOS uses `brew install python@3.11` even when the system Python (3.11+) shipped with macOS is fine — needlessly forces Homebrew.
- `checkPip` auto-runs `pip install --upgrade pip` against the **system** Python on macOS/Linux, which on modern macOS (PEP 668) and Debian/Ubuntu fails with "externally-managed environment" and shows a scary error. Should be a no-op when system pip is "good enough".
- `checkPythonVenv` and `checkFfmpeg` use `bash -lc "..."` with double quotes that break under zsh on macOS when the inner command has embedded quotes. Need to base64-encode the inner script (same trick used elsewhere) so it's shell-agnostic.

**2. Sudo dialog**
- The dialog opens for every platform but the "no password set" / `chpasswd` flow only makes sense on fresh WSL — on macOS and real Linux a user always has a password, so that branch should be hidden.
- Linux/native-bash users never see a GUI prompt, only the in-app Input. Add a fallback to `pkexec` (GNOME/KDE GUI prompt) when available so it feels native.
- `promptForPasswordMac` exists but is **never wired** into `InstallContext` — the renderer always shows `SudoPasswordDialog` instead of letting macOS use osascript. Wire it in: on macOS, call `promptForPasswordMac` first and only fall back to the in-app dialog if the user dismisses or osascript is missing.

**3. Backups tab**
- `wrapBash` uses single quotes on non-Windows: `bash -lc '<decode>'`. On macOS the default shell is zsh; spawn uses `shell: true` which on macOS invokes `/bin/sh` (POSIX) — single-quoted base64 is fine, but if the user has a custom `SHELL` env var pointing at fish/csh, this breaks. Force `/bin/bash` explicitly via the spawn option `shell: '/bin/bash'` on macOS/Linux, or pass the command without `shell: true` and exec bash directly.
- Backup directory uses `~/.ronbot-backups`. On macOS the conventional location is `~/Library/Application Support/Ronbot/backups`; on Linux XDG says `~/.local/share/Ronbot/backups`. We'll keep `~/.ronbot-backups` as the default (works everywhere, easy to find) but show the actual path clearly in the UI.

**4. Reveal in folder**
- Already uses Electron `shell.openPath` / `showItemInFolder` — works on all three. ✅

**5. Tray + lifecycle**
- macOS: `mainWindow.on('close')` always hides + creates tray when `runInBackground` is true. Standard Mac apps use the **dock** for this, not a menu-bar tray. Better: on macOS, hide the window (Dock keeps the app alive) and only create a tray icon if the user explicitly enabled "Show menu bar icon". Add a separate setting for that.
- Linux without a system tray (some Wayland compositors / GNOME without extensions) silently fails — the close-to-tray hides the only window with no way to bring it back. Detect tray failure and fall back to keeping the window visible with a toast.
- `app.dock.hide()` is never called when running purely in background on macOS — should hide the dock icon when the user wants a true background mode.

**6. Secrets storage**
- `keytar` requires `libsecret-1-dev` on Linux. If it fails to load, we fall back to `safeStorage` (works on Linux via gnome-keyring, but on a headless Linux box `safeStorage.isEncryptionAvailable()` returns false and we silently fall to plaintext — without telling the user). Surface this in the Secrets header so the user knows their keys aren't encrypted.
- On macOS the keychain prompt may appear on first write asking the user to allow access — already handled by macOS itself, but we should not retry rapidly (currently the materialize flow can call `getPassword` 20+ times in a row triggering 20 prompts). Cache decrypted values for the duration of the materialize call.

**7. Disk-space check**
- `wmic` is removed in Windows 11 24H2 — already a known issue but Mac/Linux paths are fine via `df -kP`. ✅

**8. Terminal tab**
- Built-in `cd` on Windows uses Windows path separators, but the spawn uses bash-style `~`. On macOS/Linux it works; on Windows fine too. ✅
- The shell command runs through `coreAPI.runCommand` which uses `shell: true`. On macOS that picks `/bin/sh`; commands like `source` or arrays won't work. Default the Terminal to spawn `bash -lc "<cmd>"` on macOS/Linux (and `wsl bash -lc` on Windows) for consistency.

**9. PrerequisiteCheck tab**
- The "WSL2" row shows on macOS/Linux as "Not required" with green check — confusing. Hide the row entirely on non-Windows (filter by `windowsOnly` flag, which already exists but isn't applied).
- "Operating System" row shows as `Linux (x64)` from `/etc/os-release`'s PRETTY_NAME — fine. On macOS shows version like "14.5". Add the codename ("Sonoma", "Sequoia") for a friendlier label.

**10. Update Manager tab**
- Calls `hermes update` which runs `git pull` + `pip install`. On macOS without Homebrew git, shows a confusing error. Detect and show a helpful "Install Xcode Command Line Tools" message.

**11. Channels (gateways)**
- Telegram/Discord gateways spawn `hermes` subprocesses. On macOS, the spawned process inherits the GUI app's environment which doesn't include user shell PATH — so `hermes` from `~/.local/bin/hermes` may not be found. Fix: always invoke via `bash -lc "hermes ..."` on macOS so the login shell PATH is loaded.

### Files to change

- `src/lib/systemAPI/prereqs.ts` — fix Linux installs to use the sudo dialog (don't shell out to `sudo apt-get` directly); skip pip auto-upgrade when system pip is externally-managed; base64-encode inner scripts; add brew detection on macOS.
- `src/lib/systemAPI/sudo.ts` — add `pkexec` fallback for Linux GUI prompt; expose unified `requestSudo(reason)` that picks the best UI per platform.
- `src/contexts/InstallContext.tsx` — call `promptForPasswordMac` on macOS before opening `SudoPasswordDialog`.
- `src/components/install/SudoPasswordDialog.tsx` — hide the "no password set" branch on macOS/Linux (WSL-only).
- `src/pages/PrerequisiteCheck.tsx` — filter `windowsOnly` rows on non-Windows; add macOS codename.
- `src/lib/systemAPI/hermes.ts` — wrap all `hermes` CLI invocations on macOS in a login-shell so PATH includes `~/.local/bin`; same for gateway start.
- `electron/main.cjs` — force `shell: '/bin/bash'` on darwin/linux for `exec`/`spawn`; detect tray creation failure on Linux and surface to renderer; add `app.dock.hide()` toggle for true macOS background mode; warn if `safeStorage.isEncryptionAvailable()` is false on Linux.
- `src/pages/BackupRestore.tsx` — pass `shell: '/bin/bash'` so user's exotic shell doesn't break the script.
- `src/pages/TerminalPage.tsx` — invoke commands through `bash -lc` on macOS/Linux for consistent built-ins.
- `src/pages/Secrets.tsx` — show backend label + insecure-fallback warning per-platform.

### Out of scope
- Code-signing/notarization for macOS (requires Apple Developer cert).
- Auto-installing Homebrew on macOS (huge scope; we just detect it and show a one-line install command).
- Linux distro packages (.deb/.rpm) — keep `.tar.gz` distribution.

