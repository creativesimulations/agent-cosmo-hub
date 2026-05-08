## Refactor: remove unused code

A targeted cleanup pass focused on code paths the app no longer reaches. No behavior change for any feature the user uses today — only deletions of dead code and de-duplication of the chat route.

### 1. Drop the duplicate `/chat` route

Home (`/`) already embeds `<AgentChat />` plus the right info panel. The standalone `/chat` route renders the same `AgentChat` without the panel, so it's a worse duplicate left over from when "Chat" was its own tab.

- `src/App.tsx`: remove `import AgentChat` and the `<Route path="/chat" …>` line.
- Replace every `navigate("/chat")` with `navigate("/")` in:
  - `src/pages/Skills.tsx`
  - `src/pages/Scheduled.tsx` (two call sites)
  - `src/pages/Insights.tsx`
  - `src/pages/Channels.tsx`
  - `src/pages/Index.tsx`
  - `src/pages/NotFound.tsx` (`to="/chat"` → `to="/"`)
- Update the `onChatPageRef` / unread-clear logic in `src/contexts/ChatContext.tsx` to compare against `"/"` instead of `"/chat"` (chat is the home view now).

### 2. Delete `setupGoogleWorkspace`

It's already off the `systemAPI` surface (commented out in `index.ts`) but the implementation still lives in `src/lib/systemAPI/hermes.ts` (lines ~5173-5230). Remove the method and the stale `// setupGoogleWorkspace removed` comment in `index.ts`. Agent owns this flow now.

### 3. Remove the post-Phase-5 WhatsApp/gateway dead code

The `index.ts` block-comment explicitly flags this as dead and slated for removal. Now that no UI path consumes these signals, delete:

- Types: `WhatsAppFatalReason`, `WhatsAppGatewaySignalReport`, `SlackGatewayConflictInfo`, `GatewayStartupRecoverySignals` and their `export`s.
- Parsers: `parseSlackGatewayConflict`, `parseGatewayStartupRecoverySignals`, the WhatsApp fatal-signal extractor, and the `fatalWhatsappReason / fatalWhatsappSnippet / bridgeHealthJson` fields produced by the gateway-startup helper.
- The internal `if (signal.fatalWhatsappReason === …)` branches in the gateway recovery routine, plus the auxiliary `refreshGatewayInstall` / `startGateway` / `stopGateway` cascade if no caller remains after the trim.
- Re-verify with `rg` after each batch — keep anything still referenced by `bootstrapStartupHealth` or the doctor flow.

### 4. Drop unused `systemAPI` exports

After §3, prune from `src/lib/systemAPI/index.ts`:

- `installHermesViaPip` — never called from anywhere.
- `refreshGatewayInstall`, `startGateway`, `stopGateway`, `removeEnvVar` — only used inside `hermes.ts` itself; keep the methods on the internal `hermesAPI` object (since they call `this.…`) but stop re-exporting them through `systemAPI`.

Leave `fileExists/readFile/writeFile/mkdir/writeStreamStdin/quitApp` etc. alone — they are used by other surfaces.

### 5. Verification

- App boots, Home (`/`) still renders chat + right panel.
- "Open chat" buttons on Skills/Scheduled/Insights/Channels/Index/NotFound land on `/`.
- TypeScript build passes (no dangling imports of removed types).
- `rg "setupGoogleWorkspace|fatalWhatsappReason|WhatsAppGatewaySignalReport|/chat"` returns no hits in `src/`.
- Manual smoke: agent connect → `~/.hermes/AGENTS.md` and `~/.ronbot/APP_GUIDE.md` still written; sub-agent panel still active-only.

### Files touched

- `src/App.tsx`
- `src/pages/{Skills,Scheduled,Insights,Channels,Index,NotFound}.tsx`
- `src/contexts/ChatContext.tsx`
- `src/lib/systemAPI/index.ts`
- `src/lib/systemAPI/hermes.ts`

### Out of scope

- Renaming/restructuring of `hermes.ts` (the file is 6k lines but a real split is a separate refactor).
- UI component pruning — none of the tabs/cards being kept are unused.
- Tests beyond updating any that reference the removed exports/types.