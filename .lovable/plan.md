## Plan — WhatsApp finalize: real fix for "bridge not configured"

### What the user is seeing

After successfully scanning the QR code, the finalize step fails with:

> WhatsApp bridge runtime is not configured on this machine. WARNING gateway.run: WhatsApp: Node.js not installed or bridge not configured

…followed by a wall of unrelated Slack/email/IMAP warnings, even though the user only wanted to set up WhatsApp.

### Why the previous Node v20 fix wasn't enough

The Node v20 runtime fix is correct but **incomplete**. After reading the code, three real gaps remain:

1. **Bridge `node_modules` are never installed during finalize.** The finalize path calls `ensureWhatsAppManagedNode()` (installs Node v20 + shims + service patch), but it never calls `ensureWhatsAppBridgeDeps()`, which is the function that runs `npm install` inside `~/.hermes/hermes-agent/scripts/whatsapp-bridge`. The Hermes Python adapter emits the exact warning above when either `node` is missing **or** when the bridge folder lacks `node_modules/@whiskeysockets/baileys`. So even after we successfully install Node v20, the adapter keeps reporting "bridge not configured".

2. **Auto-repair only triggers on the Node-version crash, not on `bridge-not-configured`.** In `ChannelWizard.tsx` line 1062, the one-shot auto-repair on first finalize failure runs **only** when the classifier returns `kind === "node-version"`. The user's failure is `kind === "bridge-not-configured"`, so the repair retry path is skipped entirely and the wizard surfaces the error immediately.

3. **The repair routine itself doesn't install the deps either.** `repairWhatsAppGatewayRuntime()` does Node runtime + shims + service patch + restart, but skips the `npm install` step. So even the manual "Repair runtime + restart" button can't fix this class of failure.

A secondary UX issue: when the wizard fails, it shows the Slack `missing_scope`, IMAP `AUTHENTICATIONFAILED`, and channel-directory errors in the same error block. They're labelled "informational", but it still looks like the WhatsApp wizard is failing because of Slack/email — which is wrong and confusing.

### Fix

**1. `src/lib/systemAPI/hermes.ts` — make repair self-contained**

In `repairWhatsAppGatewayRuntime()`, add a new step between "shim" and "rotate logs":

```text
2.5  Ensure WhatsApp bridge dependencies (npm install in scripts/whatsapp-bridge)
     Calls ensureWhatsAppBridgeDeps() with the same onOutput so progress streams
     into the wizard. If this fails, the whole repair fails with a clear message.
```

This guarantees that any time we run the repair, both halves of the runtime (Node v20 + Baileys) are present.

**2. `src/lib/systemAPI/hermes.ts` — strengthen `ensureWhatsAppManagedNode`**

After the shim/service/adapter patch succeeds, also invoke `ensureWhatsAppBridgeDeps` (best-effort, not gating). Idempotent — if `node_modules/@whiskeysockets/baileys` already exists, `ensureWhatsAppBridgeDeps` returns immediately. This means the finalize path's existing `ensureWhatsAppManagedNode` call (line 596 of `ChannelWizard.tsx`) automatically picks up missing deps without changing the wizard contract.

**3. `src/components/channels/ChannelWizard.tsx` — broaden auto-repair trigger**

Change the auto-repair condition at line 1062 from:

```text
if (failure.kind === "node-version" || diag?.bridgeLogShowsNode18)
```

to also include `bridge-not-configured` and `adapter-missing`:

```text
const repairableKinds = new Set(["node-version", "bridge-not-configured", "adapter-missing"]);
if (repairableKinds.has(failure.kind) || diag?.bridgeLogShowsNode18) { ...repair + retry... }
```

The toast/status text gets a small switch so the message matches the failure kind ("Installing WhatsApp bridge dependencies…" for `bridge-not-configured`).

**4. `ChannelWizard.tsx` — stop showing unrelated platform warnings during finalize**

The user is right that finalize must judge **only** WhatsApp. Two changes:

- In `restartWhatsAppGatewayWithNewSession`, drop the `nonWhatsappBlock` from the error string entirely. The classifier already separates `fatalWhatsappReason` from `nonWhatsappWarnings`; we only need the WhatsApp half to decide success/failure, so we should only display the WhatsApp half.
- Move any non-WhatsApp warnings into a collapsible "Other gateway logs (not related to WhatsApp)" disclosure under the error card, off by default. This keeps them available for support without making them look like the cause of the failure.

**5. `ChannelWizard.tsx` — re-classify after repair**

After the auto-repair retry, if the second attempt still fails, re-run `classifyWhatsAppBridgeFailure()` so the error message reflects the **post-repair** state, not the original symptom. Currently the post-repair error reuses the first classification, which can mislead.

### Acceptance criteria

- A clean machine where `~/.hermes/hermes-agent/scripts/whatsapp-bridge/node_modules` is missing can complete the WhatsApp wizard end-to-end without any manual `npm install`.
- A machine on system Node 18 still gets fixed automatically (existing Node v20 path is preserved).
- The finalize error card never includes Slack, email, or IMAP messages in the primary error text. They are only reachable via an explicit "Show other gateway logs" disclosure.
- The "Repair runtime + restart" button in the wizard fixes the bridge-not-configured case in one click.

### Files touched

- `src/lib/systemAPI/hermes.ts` — `repairWhatsAppGatewayRuntime`, `ensureWhatsAppManagedNode`
- `src/components/channels/ChannelWizard.tsx` — auto-repair trigger, error rendering, post-repair re-classification

### Out of scope (intentionally)

- Slack `missing_scope` for `users.conversations` — that's a separate Slack channel issue and the user explicitly said WhatsApp finalize must not depend on it. We will surface it on the Slack card instead, in a follow-up.
- Email IMAP auth failure — same reasoning; belongs to the Email channel card.
