# Ronbot Control Panel — Cursor handoff

> **Read this before touching any code.** It explains the architecture
> patterns that hold the app together. Breaking any of them produces
> bugs that look unrelated to your change.

---

## 1. What this app is

Electron desktop installer + control panel for the **Hermes agent**
(NousResearch). It walks a non-technical user from "nothing installed"
to "agent running with channels, skills, and a browser backend wired
up", then becomes the day-to-day control surface for that agent.

The codebase is white-label-ready. It currently ships under the
"Ronbot" brand (default agent name: "Ron"), but the upstream Hermes
name is now allowed to appear in the UI.

---

## 2. Tech stack

| Layer | Choice |
| --- | --- |
| Build | Vite 5, `base: "./"` (mandatory for Electron) |
| UI | React 18 + TypeScript 5 |
| Styling | Tailwind 3 + shadcn/ui + custom glass utilities |
| Animation | framer-motion |
| Routing | `HashRouter` (file:// compatible) |
| State | React contexts only — no Redux/Zustand/Jotai |
| Desktop | Electron 41, packaged with `@electron/packager` |
| Pkg manager | `bun` (lockfile `bun.lockb`) |
| Tests | vitest + @testing-library/react |

---

## 3. Repo map

```text
electron/
  main.cjs              ← all IPC handlers, tray, single-instance lock,
                          secrets backend (keytar/safeStorage/plaintext),
                          stream lifecycle, sudo helper
  preload.cjs           ← contextBridge surface exposed as window.electronAPI

src/
  App.tsx               ← provider tree + HashRouter routes
  main.tsx              ← React entry
  index.css             ← design tokens (HSL CSS vars), glass utilities
  contexts/
    SettingsContext.tsx
    PermissionsContext.tsx
    AgentConnectionContext.tsx
    CapabilitiesContext.tsx     ← permission/capability source of truth
    InstallContext.tsx          ← installer state machine
    ChatContext.tsx             ← chat sessions, sub-agent extraction
    SudoPromptContext.tsx       ← in-app sudo password collection
  lib/
    systemAPI/
      index.ts          ← single export surface
      types.ts          ← window.electronAPI typings + isElectron()
      core.ts           ← platform info, fs, runCommand, streams
      sudo.ts           ← in-app sudo password caching
      secretsStore.ts   ← keytar/safeStorage wrapper, env materialization
      prereqs.ts        ← Python/git/curl/ffmpeg/etc. detect+install
      hermes.ts         ← Hermes lifecycle: install, doctor, chat,
                          config edits, skills, browser self-test
      browserSetup.ts   ← Camofox/Chrome/Docker detection + install
    capabilities.ts     ← capability registry
    permissions.ts      ← permission decision plumbing
    secretPresets.ts    ← curated list of well-known API keys
    channels.ts         ← messaging channel definitions
    licenses.ts         ← upgrade/license key validation
  pages/                ← one file per top-level route
  components/
    layout/             ← AppLayout, AppSidebar, NavLink
    install/            ← preflight, sudo dialog, status pill
    permissions/        ← capability/permission dialogs + panel
    skills/             ← skill install + browser setup wizards
    channels/           ← channel cards + setup wizard
    chat/               ← capability chips, fix bubbles
    secrets/            ← SecretForm with preset auto-detection
    ui/                 ← shadcn primitives + GlassCard, StatusBadge
```

---

## 4. Critical patterns Cursor MUST preserve

### 4.1 OS access — IPC only
All filesystem, child-process, and OS calls happen in
`electron/main.cjs` and are exposed through `electron/preload.cjs` as
`window.electronAPI`. The renderer wraps that bridge in
`src/lib/systemAPI/`.

**Never** import `child_process`, `fs`, `path`, or `os` in renderer
code. If you need a new OS capability:

1. Add an `ipcMain.handle('foo', ...)` handler in `main.cjs`.
2. Expose it on `electronAPI` in `preload.cjs`.
3. Add the type to `Window['electronAPI']` in `src/lib/systemAPI/types.ts`.
4. Wrap it in the appropriate `*API` object in `src/lib/systemAPI/`.
5. Re-export from `src/lib/systemAPI/index.ts`.

### 4.2 Secrets — keytar only
Use `secretsStore.set(key, value)` /
`secretsStore.get(key)` (`src/lib/systemAPI/secretsStore.ts`). Backend
falls back: `keytar` → Electron `safeStorage` → plaintext file with
0600 perms.

**Never** write secrets directly to `~/.hermes/.env` from the UI. We
materialize the env file on demand via
`secretsStore.materializeEnv()` right before launching Hermes.

### 4.3 Streaming commands — always unsubscribe
```ts
const unsubscribe = window.electronAPI.onCommandOutput(({ streamId, type, data }) => {
  if (streamId !== id) return;
  // ...
});
const { id, promise } = window.electronAPI.runCommandStream(cmd);
try {
  await promise;
} finally {
  unsubscribe();
}
```
Failing to unsubscribe leaks listeners across page navigations and
causes phantom log lines from previous runs.

### 4.4 Managed YAML — markers + repair
`~/.hermes/config.yaml` belongs to the user. We only own clearly
delimited blocks. Pattern (see `hermes.ts` → `writeBrowserBlock`,
`writeHermesPermissions`):

```yaml
# RONBOT_BROWSER_BEGIN
browser:
  cdp_url: http://127.0.0.1:9222
# RONBOT_BROWSER_END
```

Always run the repair routine after writing — it heals YAML lists
broken by hand-editing.

### 4.5 Capabilities — context, not inline
`CapabilitiesContext` is the single source of truth for what the
agent is allowed to do. Components read decisions from the context;
they never compute "is web browsing allowed" themselves.

---

## 5. Build & package

```bash
bun install
bun run dev                # Vite dev server + Electron in watch mode
bun run pack:mac           # @electron/packager → release/MacOS-arm64/
bun run pack:win           # → release/Windows-x64/
bun run pack:linux         # → release/Linux-x64/
```

`vite.config.ts` requires `base: "./"`. `package.json` requires
`"main": "electron/main.cjs"`.

---

## 6. Cursor onboarding prompts (copy-paste)

### 6.1 Add a new page
> Add a new page at `src/pages/<Name>.tsx`. Wire it into `App.tsx`
> inside the `<AppLayout>` route group. Add a `NavLink` entry to
> `src/components/layout/AppSidebar.tsx`. Use `GlassCard` for the
> outer container. Read state from existing contexts — do not add
> a new context unless multiple pages need it.

### 6.2 Add a new IPC handler
> Add `ipcMain.handle('<verb-noun>', async (_e, ...args) => { ... })`
> to `electron/main.cjs`. Expose it on `electronAPI` in
> `electron/preload.cjs`. Add the type to `Window['electronAPI']`
> in `src/lib/systemAPI/types.ts`. Wrap it in the appropriate `*API`
> object and re-export from `src/lib/systemAPI/index.ts`. Never call
> `child_process` from the renderer.

### 6.3 Add a new managed YAML block
> Edit `src/lib/systemAPI/hermes.ts`. Add a `writeXxxBlock(value)`
> function that uses `BEGIN`/`END` marker comments unique to your
> block. Read the file, replace anything between the markers (or
> append if missing), write back. Run the existing repair routine
> after. Never serialize the entire YAML — preserve user edits
> outside your block.

### 6.4 Wire a new secret preset
> Add a new entry to `SECRET_PRESETS` in `src/lib/secretPresets.ts`
> with `envVar`, `label`, `hint`, optional `prefix` for paste
> auto-detection, `docsUrl`, and `category`. Do not change the
> `SecretForm` component — it picks up new presets automatically.

### 6.5 Add a new browser backend
> Add detection + install + start helpers to
> `src/lib/systemAPI/browserSetup.ts` (mirror `setupAndStartCamofox`).
> Add a tile to `BrowserSetupDialog.tsx`. After successful start,
> probe a real CDP/HTTP round-trip — never trust just the port being
> open. On success, write the connection URL via the appropriate
> `set*Url` helper in `hermes.ts` and run the browser self-test.

---

## 7. Things Cursor must NOT do

- **No Anthropic Claude SDK in the agent backend.** Hermes is
  provider-agnostic. Anthropic is one of many model providers
  configured through `secretsStore` + `setModel()`.
- **No Supabase / Lovable Cloud.** This is a pure local desktop app.
  All state lives on the user's filesystem.
- **No `BrowserRouter`.** Electron loads via `file://`, which breaks
  absolute paths. `HashRouter` only.
- **No inline color styles.** All theming via tokens in `index.css`
  and Tailwind semantic classes.
- **No `electron-builder`.** Use `@electron/packager` only — builder's
  7zip dependency fails in CI.
- **No removing the `dedupe` array** in `vite.config.ts` — React +
  React Query break with multiple copies.

---

## 8. Known live issues / recent fixes

Don't reintroduce these:

- **Browser skill false negative.** Hermes' `browser` tool ships
  inside the `hermes-cli` toolset, not as a `~/.hermes/skills/`
  folder. We trust the `hermes-cli` toolset entry, not the skill
  directory walk. See `BrowserSetupDialog.tsx` and `runBrowserSelfTest`.
- **Session-not-found mid-chat.** When Hermes evicts a session, we
  auto-retry by starting a fresh session and replaying the last
  user message. See `ChatContext.tsx`.
- **Sub-agent goal extraction garbage.** ASCII tool headers contain
  box-drawing chars and tool names like `delegate_task`. We strip
  them with a `REJECT` regex + char class. See `ChatContext.tsx`.
- **Skills badge inflation.** The badge counts only core web
  capabilities that are explicitly enabled or recently used — not
  every optional integration. See `CapabilitiesContext.tsx`.
- **Camofox detected as not running.** Open `BrowserSetupDialog`
  polls `/health` immediately so the install button hides if Camofox
  is already up.
