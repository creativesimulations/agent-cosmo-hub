## Comprehensive refactor: organize, clean up, kill dead code

A staged refactor with measurable goals. Each stage stands on its own and is independently reviewable so we don't trade one mess for another. No feature changes — only structure, naming, and deletions.

### Why now

Three pain points dominate the codebase:

1. **`src/lib/systemAPI/hermes.ts` is 6,082 lines** containing ~70 methods across many unrelated concerns (install, env, config, gateway, WhatsApp adapter patching, skills, scheduled jobs, browser probing, etc.).
2. **~1,800 lines of confirmed dead WhatsApp/gateway code** in that same file — verified by `rg`: zero callers outside `hermes.ts` itself for `runWhatsAppPairing`, `repairWhatsAppGatewayRuntime`, `patchGatewayServicePathForWhatsApp`, `ensureWhatsAppBridgeDeps`, `auditWhatsAppBridgeRuntime`, `classifyWhatsAppBridgeFailure`, plus ~20 more. The agent owns these flows over the intent protocol now.
3. **Page components mixing UI, business logic, and IPC** (`Index.tsx` 1,025 lines, `Diagnostics.tsx` 1,042, `BrowserSetupDialog.tsx` 1,151, `SettingsPage.tsx` 911). Effects, derived state, and command pipelines are inlined alongside JSX.

### Stage 1 — Delete dead WhatsApp/gateway code (biggest win)

Target: `src/lib/systemAPI/hermes.ts` lines ~2000-4080 plus their helper types/parsers around lines 31-510.

Methods to remove (verified zero external callers):

```
getWhatsAppGatewayHealth        getWhatsAppBridgeStatus
readWhatsAppBridgeLogTail       findUnauthorizedWhatsAppSenders
ensureWhatsAppRuntimeSecrets    terminateConflictingGatewayProcess
testChannel                     checkNpmForMessaging
ensureHermesNodeRuntime         checkWhatsAppPairingPrereqs
ensureWhatsAppBridgeDeps        checkChannelSetupTools
isWhatsAppPaired                getWhatsAppSessionFileCount
clearWhatsAppSession            removeChannelEnvKeys
resetWhatsAppChannel            terminateWhatsAppPairingProcesses
ensureWhatsAppManagedNode       patchGatewayServicePathForWhatsApp
patchHermesWhatsAppAdapterForNode
getWhatsAppRuntimeDiagnostic    auditWhatsAppBridgeRuntime
classifyWhatsAppBridgeFailure   rotateWhatsAppBridgeLogs
verifyGatewayUsesManagedNode    repairWhatsAppGatewayRuntime
runWhatsAppPairing
```

Plus the dead supporting types: `WhatsAppFatalReason`, `WhatsAppGatewaySignalReport`, `SlackGatewayConflictInfo`, `GatewayStartupRecoverySignals`, and the parsers `parseSlackGatewayConflict` / `parseGatewayStartupRecoverySignals` / fatal-WA snippet extractor.

After this, also drop `startGateway` / `stopGateway` / `refreshGatewayInstall` if no internal caller survives. Expected reduction: **~1,800-2,000 lines from hermes.ts**.

Verification: `rg "WhatsApp|Gateway"` should drop to a handful of comments + the channel-setup UI cards.

### Stage 2 — Split `hermes.ts` into focused modules

Move the remaining ~4,000 lines into a folder `src/lib/systemAPI/hermes/` with one file per domain:

```
hermes/
  index.ts            — assembles & exports `hermesAPI`
  install.ts          — install / installFromLocalFolder / installViaPip / uninstall / update
  env.ts              — readEnvFile / setEnvVar / removeEnvVar / materializeEnv
  config.ts           — readConfig / writeConfig / setModel / writeInitialConfig / repairConfig / configCheck
  doctor.ts           — doctor / analyzeDoctorIssues / bootstrapStartupHealth / runStartupAutoFix / status
  agent.ts            — start / chat / chatPing / setAgentName / getAgentName / restartAgent / isConfigured
  skills.ts           — listSkills / getSkillsConfig / setSkillEnabled / installSkillFromPath / installSkillFromGit / installToolFromPath / revealSkillsFolder / reloadToolsets
  browser.ts          — getBrowserDiagnostics / setBrowserCamofoxPersistence / setBrowserCdpUrl / probeBrowserNavigate / runBrowserSelfTest
  subagents.ts        — listSubAgents
  scheduling.ts       — listScheduledJobs / deleteScheduledJob
  introspection.ts    — listMCPServers / listProfiles / listPlugins / discoverCapabilities / getInsights / getBusyInputMode / setBusyInputMode / launchHermesDashboard
  permissions.ts      — syncPermissions / readPermissionsBlock / enableFileLogging
  ronbotRules.ts      — writeRonbotAgentRules / writeRonbotAppGuide (+ the embedded markdown content)
  shared.ts           — runHermesShell / runHermesCli / encodeScript / path helpers / shared constants
```

Each file exports a small typed object; `hermes/index.ts` spreads them into `hermesAPI`. The public `systemAPI` import path stays unchanged so no consumer needs editing.

### Stage 3 — Trim `electron/main.cjs` and align with the API split

`electron/main.cjs` (928 lines) registers ~40 IPC handlers in one file. Split into `electron/ipc/{platform,fs,hermes,sudo,window}.cjs` and have `main.cjs` import + register them. Drop any IPC handlers that exclusively serviced the deleted WhatsApp methods. Keep `preload.cjs` API surface intact.

### Stage 4 — Page-level cleanup

For each oversized page, extract logic into hooks and presentational subcomponents. No new features; same JSX, smaller files.

- **`pages/Index.tsx` (1,025 lines)** — installer wizard. Extract `useInstallSteps`, `useLaunchHealth`, and step subcomponents into `components/install/steps/`.
- **`pages/Diagnostics.tsx` (1,042)** — pull each section card into `components/diagnostics/*Card.tsx`; move command runners into `hooks/useDoctorReport.ts`.
- **`pages/SettingsPage.tsx` (911)** — group settings into `components/settings/sections/{General,Agent,Sound,Privacy,Advanced}.tsx`.
- **`pages/AgentChat.tsx` (588)** — split into `<ChatHeader>`, `<ChatTranscript>`, `<ChatComposer>`; keep ChatContext as the source of truth.
- **`components/skills/BrowserSetupDialog.tsx` (1,151)** — split per backend (Camofox / CDP / Self-test) into sibling components.

### Stage 5 — Context + lib hygiene

- **`contexts/ChatContext.tsx` (920)** — extract `useChatPersistence` (localStorage + disk mirror), `useChatWorker` (queue/worker/stop), and `useSubAgentTracker` (delegate-task regex). The provider becomes a thin shell.
- **`contexts/InstallContext.tsx` (603)** and **`CapabilitiesContext.tsx` (430)** — same treatment, lift effects into hooks.
- **`lib/capabilities.ts` (395)** vs `lib/capabilities/` folder — consolidate; keep the folder, delete the loose file once duplicates are merged.
- **`lib/agentIntents/`** — already well-split, no action.

### Stage 6 — Remove orphan files & tighten exports

Files with **zero importers** (verified): `components/dashboard/AgentPowerCard.tsx`, `components/channels/UpgradeCard.tsx`. Delete.

Sweep with `ts-prune` (one-time install dev) to surface other unreferenced exports; remove only the obvious ones, leave a TODO list for ambiguous cases.

### Stage 7 — Lint & convention pass

- Add an `eslint-plugin-unused-imports` rule and run `--fix` once.
- Standardize file naming: pages = `PascalCase.tsx`, hooks = `useCamelCase.ts`, libs = `camelCase.ts`. Most already comply; rename the few stragglers.
- Replace remaining `any` casts with typed interfaces where trivial.
- Ensure every component file exports exactly one default + named types.

### Out of scope (for this refactor)

- No design system changes, no behavior changes, no new dependencies beyond `ts-prune` and `eslint-plugin-unused-imports` (dev-only).
- Tests beyond keeping `vitest run` green after each stage.
- Renaming public IPC channels in `preload.cjs` (would touch the Electron main process contract).

### Sequencing & checkpoints

Each stage is a separate PR-sized change. Suggested order: 1 → 2 → 6 → 4 → 5 → 3 → 7. After each stage:

- `bun run build` clean
- Vitest green
- App launches, agent connects, chat sends a message, sub-agent panel populates, channels page opens.

### Estimated impact

- `hermes.ts`: 6,082 → ~3,200 lines, then split across 13 files of ≤400 lines each.
- Top 5 pages: each under 400 lines.
- Two orphan components deleted.
- One source-of-truth per concern; no more spaghetti where install logic and gateway patching live in the same file.