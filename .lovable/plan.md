Plan to fix the WhatsApp pairing stall at “repairing WhatsApp bridge dependencies (npm install)…”

1. Make bridge dependency repair resilient instead of silent
   - Update `ensureWhatsAppBridgeDeps` so dependency repair uses the managed npm binary explicitly.
   - Add npm flags that reduce known WSL/npm cache hangs and provide clearer progress/errors, e.g. timeout/fetch retry limits, cache verification, and a forced retry path if the first install stalls or fails.
   - Increase the install timeout to handle slow first-time installs, but avoid leaving the user with no feedback.

2. Add heartbeat/progress output while npm install is running
   - Wrap the npm install call so the UI receives periodic “still installing dependencies…” output even if npm itself is quiet.
   - Surface network/cache hints if no npm output arrives for a while, rather than appearing frozen.

3. Add automatic retry/cleanup for broken npm installs
   - If npm install fails or times out, remove only dependency artifacts (`node_modules`, npm cache verification/retry as appropriate), not WhatsApp pairing/session state.
   - Retry once with safer flags such as `--force`/cache bypass behavior, because npm-on-WSL hangs are a known issue in some npm versions.
   - Return a clear actionable error if both attempts fail.

4. Improve the wizard’s dependency phase UX
   - During `bridge-deps`, show a specific message that this step can take several minutes on first run and depends on internet access to npm registry.
   - Keep the existing Cancel button usable and make retry messaging clear: retry continues from cached progress instead of starting the whole setup over.
   - If dependency repair times out, do not suggest “Force fresh QR pairing” unless the stall happened after the QR/pairing phase; dependency install stalls are separate from stale WhatsApp sessions.

5. Validate all three desktop platforms in code paths
   - Ensure the updated command still runs correctly on Windows via WSL, macOS, and Linux by using the existing `runHermesShell` abstraction.
   - Confirm no Electron packaging changes are needed and no white-label restricted terms are introduced in the UI.
   - Run TypeScript/build checks after implementation.

Technical details
- Main files to edit: `src/lib/systemAPI/hermes.ts` and `src/components/channels/ChannelWizard.tsx`.
- The likely root cause is not WhatsApp session persistence anymore; it is the bridge dependency install stage either taking too long or npm hanging silently before QR generation starts.
- The fix keeps session clearing separate from dependency repair so resetting WhatsApp does not accidentally remove dependencies or hide npm/network failures.