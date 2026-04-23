

# Make capability blockers impossible to miss + fix the silent web-access failure

## Two real problems to solve

**1. The user got NO notice** even though the agent failed.
Today, when `detectToolUnavailable(reply)` finds a hit, we only attach a `<CapabilityFixBubble>` *inside the assistant message*. If the user has scrolled, isn't on the chat tab, or the bubble looks like more chat text, it's invisible. There is no toast, no modal, no badge, no sound.

**2. The "permission error" isn't actually a permission error.**
Config shows `internet: allow`. Ronbot didn't block anything. The LLM said *"permission error in this environment"* on its own — most likely because **no browser/fetch skill is actually installed**, so the model has no tool to call and rationalises the failure as a permission issue. We have to stop trusting the agent's self-diagnosis and run our own check.

## Fix plan

### A. Loud, unmissable notice when a capability fails or needs a decision

Anywhere a `toolUnavailable` is detected OR a proactive tool-call is gated:

1. **Toast** (sonner) — top-right, persistent until clicked: *"The agent tried to use Web browsing and was blocked. Click to fix."* Click → opens the new dialog.
2. **Modal dialog** — same 4-button layout as `ApprovalDialog` but capability-aware. Title: *"Web browsing isn't ready"*. Body: the existing `CapabilityFixBubble` checklist (permission / policy / key / skill / extras). Actions: **Always allow / Allow this session / Always deny / Dismiss**, plus inline *"Add key", "Install skill", "Open Permissions"* buttons.
3. **Sidebar badge** — small red dot on the Skills nav item until the user opens it. Number = count of capabilities currently in a "needs setup" state.
4. **Optional desktop notification** if `runInBackground` is on (reuse `notify.ts`).
5. **Existing inline bubble stays** as the in-chat record, but is no longer the only signal.

### B. Real readiness check, not the agent's word

Add `src/lib/capabilityProbe.ts` that runs whenever:
- a chat fails with `toolUnavailable`, OR
- the user opens Skills/Settings, OR
- after install/skill changes.

For each web-related capability it checks:
- Internet permission in current `~/.hermes/config.yaml` (read via `hermesAPI.readConfig`).
- Whether any `candidateSkills` are present in `listSkills()` AND not in the disabled list.
- Whether any `candidateSecrets` exist in the secrets store.
- For `webBrowser`: whether the `hermes-agent[web]` extras Python package is importable (best-effort `python -c "import playwright"` shell check; cached for 60s).

It returns a typed `CapabilityProbeResult` with a precise reason: `noSkill | noKey | noExtras | permissionDenied | ready`.

### C. Use the probe to override the agent's self-diagnosis

In `ChatContext` after a reply:
- Run `detectToolUnavailable` as today.
- If it matches `webBrowser`/`webSearch`/etc., immediately run `capabilityProbe(id)`.
- The probe's reason replaces the agent's vague "permission error" wording in the bubble/dialog: *"Ron has no browser skill installed. Install `browser_use` or add a Firecrawl key."*
- If the probe says `ready`, we still surface the failure but label it *"Agent reported a block but Ron's setup looks fine — try rephrasing or check the agent log."* with a one-click *Open log* button. No more silent dead end.

### D. Proactive gating gets the same treatment

`detectToolCalls` (already wired in `ChatContext`) on `policy === "ask"` currently only records — we'll switch it to actually call the **modal** before the next chunk renders, so the user is asked *before* the agent claims failure. Same modal as B.

### E. First-run web-access nudge

After install completes, if no web skill / web key is present, show a one-time banner on the Chat page: *"Ron can't browse the web yet — set it up in Skills."* Single click → Skills with the Web Browsing row scrolled into view and highlighted.

## Files

**New**
- `src/lib/capabilityProbe.ts` — real readiness probe (reads config, skills, secrets, extras).
- `src/components/permissions/CapabilityApprovalDialog.tsx` — capability-aware approval modal (reuses Dialog + 4 buttons + checklist body).
- `src/components/chat/CapabilityNotice.tsx` — toast + sidebar-badge driver, mounted once in `AppLayout`.

**Edited**
- `src/contexts/ChatContext.tsx` — invoke probe after `detectToolUnavailable`; trigger toast + modal; switch proactive `detectToolCalls` to await the modal on `ask`.
- `src/contexts/CapabilitiesContext.tsx` — expose `openApprovalModal(capId, context)`; expose `pendingDecisionsCount` for the sidebar badge.
- `src/components/chat/CapabilityFixBubble.tsx` — accept a `probe` prop and render the precise reason instead of generic checks.
- `src/components/layout/AppSidebar.tsx` — red-dot badge on Skills nav.
- `src/components/layout/AppLayout.tsx` — mount `<CapabilityNotice />` and the global `<CapabilityApprovalDialog />`.
- `src/lib/toolUnavailable.ts` — keep, but its output is now a *hint* the probe verifies.
- `src/pages/AgentChat.tsx` — first-run web-access banner; deep-link target highlight.
- `src/pages/Skills.tsx` — accept `?focus=<capId>` to scroll/flash a row.

## Outcome

- The user can never again be left wondering why the agent failed: a toast + a modal + a sidebar dot all surface the issue.
- The fix message tells the truth (skill missing / key missing / extras missing), not the agent's hallucinated *"permission error"*.
- Decisions made from the modal are written straight into `capabilityPolicy`, just like the existing flow.
- All existing capability-merge-into-Skills work from the prior plan continues unchanged — this layers loud notices and accurate diagnostics on top.

