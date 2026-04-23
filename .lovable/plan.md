

# Zero-CLI browser setup on Mac, Windows, and Linux

The current `BrowserSetupDialog` shows shell snippets to copy. Replace every CLI step with an in-app Run button. Where elevation or a password is required, prompt inside the app and the app finishes the job.

## What changes for each backend

### Browserbase (paid, cloud) — already CLI-free
No change beyond UX polish. User pastes API key + Project ID, app saves to secrets, restarts agent. Done.

### Camofox (free, local) — fully automated
Drop the docker/git copy-paste blocks. Replace with a single **"Install & start Camofox"** button that the app drives end-to-end on all three OSes.

Strategy per platform (probed in this order, first available wins):

1. **Docker present** (any OS) → app runs `docker run -d --name ronbot-camofox -p 9377:9377 --restart unless-stopped ghcr.io/jo-inc/camofox-browser:latest` and polls `http://localhost:9377/health` until ready. Container is reused on subsequent launches.
2. **Docker missing**:
   - **macOS**: app runs `brew install --cask docker` if Homebrew is present (no sudo). If Homebrew is missing, app downloads the Docker Desktop `.dmg` to `~/Downloads`, opens it via `open`, and shows a one-screen wait state ("Drag Docker to Applications, then click Continue"). After user clicks Continue, the app launches Docker Desktop (`open -a Docker`), polls until the daemon is up, then runs the container. Homebrew install itself is *not* attempted (requires sudo + xcode-select); we provide a single "Install Homebrew" button that runs the official installer through the existing `SudoPasswordDialog` so the user just types their password once.
   - **Windows**: app runs `winget install --id Docker.DockerDesktop -e --accept-package-agreements --accept-source-agreements` (UAC consent prompt — no stored password). Then auto-starts Docker Desktop and waits for the daemon. Then runs the container.
   - **Linux**: app uses the existing `sudoAPI.aptInstall(['docker.io'], password)` via `SudoPasswordDialog` to install Docker, runs `sudo systemctl enable --now docker` through the same channel, then `sudo usermod -aG docker $USER` so future runs need no sudo. Then runs the container.

All output streams live into the dialog via `runCommandStream` (same pattern as the Hermes installer) so the user sees progress, not a frozen spinner. The persistent-sessions toggle keeps writing `browser.camofox.managed_persistence` via the existing `setBrowserCamofoxPersistence`.

### Local Chrome (CDP) — fully automated
Drop the `CopyBlock` with the launch command and the `hermes` / `/browser connect` block. Replace with **"Launch Chrome & connect"**:

1. App detects Chrome's executable per OS (`/Applications/Google Chrome.app/...`, `C:\Program Files\Google\Chrome\Application\chrome.exe` + `Program Files (x86)` fallback, `which google-chrome|chromium|chrome`). If none found, app installs Chrome:
   - **macOS**: `brew install --cask google-chrome` if brew present; otherwise download the official `.dmg` to `~/Downloads` and open it (same one-screen wait as Camofox/Docker).
   - **Windows**: `winget install --id Google.Chrome -e --accept-package-agreements --accept-source-agreements` (UAC).
   - **Linux**: `sudoAPI.aptInstall` via `SudoPasswordDialog` after fetching the `.deb` from `https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb` (or `dnf` on Fedora).
2. App spawns Chrome with `--remote-debugging-port=9222 --user-data-dir=$HOME/.ronbot-chrome` via `runCommandStream` (background, not awaited).
3. App polls `http://127.0.0.1:9222/json/version` until ready.
4. App writes `browser.cdp_url: "http://127.0.0.1:9222"` to `~/.hermes/config.yaml` via a new `hermesAPI.setBrowserCdpUrl(url)` (same surgical-block pattern as `setBrowserCamofoxPersistence`) so Hermes auto-connects on next start — no `/browser connect` typed anywhere.
5. App marks `capabilityPolicy.webBrowser = "allow"` and re-probes.

A small **"Stop Chrome"** button appears once running, which kills the spawned process.

### Browser Use / Firecrawl
Already key-only. No change beyond the new UX wrapper.

## Plumbing to add

### `src/lib/systemAPI/hermes.ts`
- `setBrowserCdpUrl(url: string | null)` — surgical update of a `browser.cdp_url` line, same managed-block pattern.

### `src/lib/systemAPI/browserSetup.ts` (new)
Pure orchestration, no UI:
- `detectDocker()` → `{ installed, running }`
- `installDocker(onOutput, sudoPassword?)` — per-OS; returns a `CommandResult`-shaped value.
- `startDockerDaemon(onOutput)` — `open -a Docker` / `Start-Service docker` / `systemctl start docker` and poll.
- `runCamofoxContainer(onOutput)` + `pollCamofox(timeoutMs)` → boolean.
- `detectChrome()` → absolute path or null.
- `installChrome(onOutput, sudoPassword?)` — per-OS.
- `launchChromeWithCdp(chromePath, port, dataDir)` — uses `runCommandStream` so it survives until the user clicks Stop.
- `pollCdp(port, timeoutMs)` → boolean.
- `stopLaunchedChrome()` — kills the stream id we stored.

All Linux apt/dpkg paths route through `sudoAPI` + the existing `SudoPasswordDialog` so the user is prompted **inside the app**, never in a terminal.

### `src/components/skills/BrowserSetupDialog.tsx`
- Delete `CopyBlock`, the `camofoxDockerSnippet`/`camofoxGitSnippet` UI, and the entire Local Chrome two-step copy UI.
- Add a streaming log panel (`<pre>` with auto-scroll, capped at ~200 lines) used by the Camofox and Local Chrome flows.
- Camofox panel: status row (`Docker: …`, `Container: …`, `Health: …`) + **Install & start Camofox** / **Restart container** / **Stop container** buttons.
- Local Chrome panel: status row (`Chrome: …`, `CDP: …`) + **Launch Chrome & connect** / **Stop Chrome** buttons.
- On every "needs sudo" return, dispatch the existing `requestSudoPassword` flow (lift the helper out of `InstallContext` into a small standalone hook `useSudoPrompt` so the browser dialog can reuse it without going through Install state) — when `pkexec`/passwordless is available we skip the dialog entirely, matching today's behavior.

### `src/lib/browserBackends.ts`
- Drop `camofoxDockerSnippet`, `camofoxGitSnippet`, `localChromeLaunchCommand` exports (no longer rendered).
- `localChrome.surface` becomes `'local'` (no longer `'manual'`) and `manualOnly` flag removed — it's now fully automated.

### `src/contexts/InstallContext.tsx`
- Extract the `requestSudoPassword` + `<SudoPasswordDialog>` wiring into a generic `SudoPromptProvider` mounted in `AppLayout`, exposing `useSudoPrompt()`. `InstallContext` consumes the same hook so install behavior is unchanged.

## Cross-platform guarantees

| Step | macOS | Windows | Linux |
|---|---|---|---|
| Install Docker | `brew install --cask docker` or guided `.dmg` open | `winget` (UAC) | `sudoAPI.aptInstall` via in-app dialog |
| Start Docker daemon | `open -a Docker` + poll | auto-start service + poll | `sudo systemctl start docker` via dialog |
| Run Camofox container | `docker run …` (no sudo after group add) | `docker run …` | `docker run …` |
| Install Chrome | `brew --cask` or guided `.dmg` | `winget` (UAC) | `apt`/`dnf` via dialog |
| Launch Chrome w/ CDP | spawn via Electron | spawn via Electron | spawn via Electron |
| Connect Hermes | `setBrowserCdpUrl` writes config | same | same |

Any sudo password is collected through the existing `SudoPasswordDialog` and consumed by `sudoAPI` — nothing is ever stored, nothing is ever typed in a terminal.

## Files

**New**
- `src/lib/systemAPI/browserSetup.ts` — orchestration helpers above.
- `src/contexts/SudoPromptContext.tsx` — extracted from `InstallContext`; exposes `useSudoPrompt()`.

**Edited**
- `src/lib/systemAPI/hermes.ts` — `setBrowserCdpUrl`.
- `src/lib/systemAPI/index.ts` — export new orchestration + `setBrowserCdpUrl`.
- `src/lib/browserBackends.ts` — drop CLI snippets, retype `localChrome` as automated.
- `src/components/skills/BrowserSetupDialog.tsx` — replace copy-blocks with action buttons + streaming log panels.
- `src/contexts/InstallContext.tsx` — consume new sudo-prompt hook.
- `src/components/layout/AppLayout.tsx` — mount `SudoPromptProvider`.

**Untouched**
- Browserbase/Browser Use/Firecrawl save paths, license-unlock flow, capability probe, Skills page entry, sidebar/toast notices.

## Outcome

Every browser backend that involves *any* setup is now click-to-finish on macOS, Windows, and Linux. The user never opens a terminal. When elevation is required, it's collected via the same in-app password dialog already used for ffmpeg/python-venv installs, and the app drives the install to completion.

