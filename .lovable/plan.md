

# Fix browser skill detection + add real CDP probe + auto-suggest web-search backend

## Problems

1. **False "no browser skill installed".** Hermes' `browser` tool is a built-in shipped via the `hermes-cli` toolset (which our config.yaml already loads). It lives inside the Python package's `hermes_cli/tools/`, not in `~/.hermes/skills/` or `site-packages/hermes_agent/skills/` — so our `listSkills()` filesystem walk never sees it. The Browser Setup wizard then aborts even though `hermes doctor` clearly reports `✓ browser`.

2. **Deep web content blocked.** CDP/Camofox gives the agent a real Chromium to drive, but `web_search` / `web_extract` use HTTP-fetch backends (Tavily / Exa / Firecrawl). With none configured, the agent degrades to plain HTTP, which gets JS-blocked or returns 403s. The doctor already flags this as `⚠ web (missing EXA_API_KEY, PARALLEL_API_KEY, TAVILY_API_KEY, FIRECRAWL_API_KEY)`.

3. **No end-to-end browser probe.** Today we only check `/json/version` on CDP. That confirms Chrome is listening, not that the agent can navigate. Failures only surface mid-chat.

## Fix

### 1. `src/components/skills/BrowserSetupDialog.tsx` — replace skill walk with toolset check

Rewrite `ensureBrowserSkillEnabled()`:

- **Source of truth = `hermes doctor` output**, not `~/.hermes/skills/`. The doctor already prints `✓ browser` when the tool is loaded.
- New flow:
  1. Read `config.yaml` and confirm the managed `toolsets:` block contains `hermes-cli` (we write this on every backend save). If missing, write it now.
  2. Check `getSkillsConfig().disabled` — only block if the user has *explicitly* disabled `browser` / `web_browser` in their skills config. In that case, re-enable it.
  3. Otherwise treat the browser tool as present (it's bundled with `hermes-cli`).
- Keep the user-skill auto-enable path as a fallback for installs that *do* ship `browser` as a skill folder, but never use it as the gate.

Also rename the toast to `"Browser tool enabled"` instead of the misleading "no browser skill".

### 2. `src/lib/systemAPI/hermes.ts` — add `probeBrowserNavigate()`

A real CDP round-trip the wizard runs after wiring `cdp_url`:

```text
1. GET <cdp>/json/new?about:blank   → opens a tab, returns its webSocketDebuggerUrl
2. WS Page.navigate { url: "https://example.com" }
3. WS Page.getResourceTree → assert frame.url contains "example.com"
4. WS Target.closeTarget
```

If steps 1-4 succeed → "✓ Real browser navigation works." If the WS handshake fails or `Page.navigate` errors → return the error verbatim. This proves the agent will actually be able to drive the browser, not just connect to the port.

### 3. `BrowserSetupDialog.tsx` — surface "web search backend" CTA

After a successful CDP/Camofox setup, render a one-line panel:

> "Browser is ready. To let Ron *find* pages (not just open known URLs), add a search backend."
> [Add Tavily key (free tier)] [Add Exa key] [Skip — basic HTTP only]

Tavily has the most generous free tier and a paste-the-key UX, so it's the default suggestion. Saving the key writes `TAVILY_API_KEY` via the existing `secretsStore.set()` pipeline.

### 4. `src/lib/systemAPI/hermes.ts` — `runBrowserSelfTest()` exposed via `systemAPI`

Single entry point Diagnostics & install flow can both call:

```text
{
  cdpReachable,        // existing
  cdpVersion,
  navigateOk,          // NEW — real Page.navigate succeeded
  navigateError,
  webSearchBackend,    // "tavily" | "exa" | "firecrawl" | null
  hermesCliToolsetLoaded,
  doctorReportsBrowser // grep `✓ browser` in cached `hermes doctor` output
}
```

Diagnostics page gains a "Run browser self-test" button that runs this and prints the JSON.

### 5. `src/contexts/InstallContext.tsx` — auto-run self-test after install

After `chatPing` passes, also call `runBrowserSelfTest()` and report:
- `✓ Browser tool registered (hermes-cli loaded)`
- `⚠ No CDP backend configured — set up Camofox or local Chrome later if Ron needs deep web access`
- (when CDP is set later) `✓ Real browser navigation works`

This makes the issue impossible to miss on first run without forcing the user through browser setup during install.

## Files edited

- `src/components/skills/BrowserSetupDialog.tsx` — replace skill walk with toolset check; add post-config web-search CTA; remove false-positive abort
- `src/lib/systemAPI/hermes.ts` — add `probeBrowserNavigate()` (raw CDP WebSocket), `runBrowserSelfTest()` aggregator
- `src/lib/systemAPI/index.ts` — export `runBrowserSelfTest`
- `src/pages/Diagnostics.tsx` — add "Run browser self-test" panel
- `src/contexts/InstallContext.tsx` — append browser self-test to post-install verification

## Outcome

- Camofox/CDP setup completes successfully in one click — no more bogus "no browser skill" abort, because we trust the `hermes-cli` toolset (which we already write).
- After CDP wiring, the wizard runs a real `Page.navigate` round-trip and prints pass/fail, so users know immediately whether Ron can drive the browser.
- Users get a clear, optional one-click path to add a web-search backend (Tavily) so Ron can *find* pages, not just open them — fixing the "deep content blocked" symptom.
- Every fresh install runs the same self-test, so configuration drift surfaces in Diagnostics instead of mid-chat.

