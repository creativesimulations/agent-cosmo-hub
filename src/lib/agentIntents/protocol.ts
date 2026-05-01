/**
 * Agent → App intent protocol.
 *
 * The Hermes agent emits a fenced JSON block in its streamed reply when it
 * needs the renderer to do something the chat alone can't (collect a
 * password, render a QR, ask yes/no, open a folder picker, etc.):
 *
 *     ```ronbot-intent
 *     { "id": "intent_abc", "type": "credential_request", ... }
 *     ```
 *
 * The renderer parses these blocks out of the stream, replaces them with an
 * inline UI card, and posts the user's reply back to the agent on the next
 * turn as a matching `ronbot-intent-response` block.
 *
 * This file is the single source of truth for the wire format. Everything
 * else (parser, responder, renderer cards, agent prompt templates) reads
 * its types and validators from here.
 */

/** Common envelope every intent shares. */
export interface IntentBase {
  /** Stable id chosen by the agent — used to correlate the response. */
  id: string;
  /** Discriminator. */
  type: AgentIntent['type'];
  /** Short, human-readable header rendered above the card. */
  title: string;
  /** Optional 1–3 sentence body explaining what's being asked. */
  description?: string;
  /** Optional URL the renderer offers as an "Open in browser" button. */
  openUrl?: string;
  /** Optional TTL in seconds — after this, the card grays out. */
  expiresInSec?: number;
}

/** A single field inside a `credential_request`. */
export interface IntentField {
  /** UPPER_SNAKE_CASE env-var name; also the key in the response. */
  key: string;
  /** Human label shown in the form. */
  label: string;
  /** Sub-label / placeholder hint. */
  hint?: string;
  /** Render as masked password (true) or plain text (false, default). */
  secret?: boolean;
  /** Optional regex (string form) the renderer enforces before submit. */
  validate?: string;
  /** Optional default / preselected value. */
  defaultValue?: string;
  /** True when the field is optional. Defaults to required. */
  optional?: boolean;
}

/** Ask the user to paste/enter one or more secrets or text values. */
export interface CredentialRequestIntent extends IntentBase {
  type: 'credential_request';
  fields: IntentField[];
  /**
   * If true, the renderer also writes the values into ~/.hermes/.env via
   * `materializeEnv()` after storing them in the secrets keychain. Defaults
   * to true — the agent can disable for non-Hermes secrets (e.g. an OAuth
   * token only used by an app-side feature).
   */
  materialize?: boolean;
}

/** Yes/no confirmation. */
export interface ConfirmIntent extends IntentBase {
  type: 'confirm';
  /** Button text for the affirmative action. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Button text for the negative action. Defaults to "Cancel". */
  cancelLabel?: string;
  /** When true, render the confirm button as destructive (red). */
  destructive?: boolean;
}

/** Pick one option from a list. */
export interface ChoiceIntent extends IntentBase {
  type: 'choice';
  options: { value: string; label: string; description?: string }[];
  /** Pre-selected value. */
  defaultValue?: string;
}

/** Show a QR code (PNG data URL or base64) for the user to scan. */
export interface QRDisplayIntent extends IntentBase {
  type: 'qr_display';
  /** Either a full `data:image/png;base64,…` URL or the raw base64. */
  qr: string;
  /** Optional pairing code text to display alongside the QR. */
  pairingCode?: string;
  /** Button label after the user has scanned. Defaults to "I scanned it". */
  doneLabel?: string;
}

/** Open a URL externally and wait for the user to confirm completion. */
export interface OAuthOpenIntent extends IntentBase {
  type: 'oauth_open';
  url: string;
  /** Button label that opens the URL. Defaults to "Open in browser". */
  openLabel?: string;
  /** Button label after the user is back. Defaults to "I'm back". */
  doneLabel?: string;
}

/** Pick a file or folder from the local filesystem. */
export interface FilePickIntent extends IntentBase {
  type: 'file_pick';
  /** Whether to pick a folder (default) or a single file. */
  pickKind?: 'folder' | 'file';
}

/** Long-running progress heartbeat. No user input required. */
export interface ProgressIntent extends IntentBase {
  type: 'progress';
  /** 0–100, or omitted for indeterminate. */
  percent?: number;
  /** Optional sub-status line under the title. */
  status?: string;
}

/** Agent signals that a multi-step setup completed. */
export interface DoneIntent extends IntentBase {
  type: 'done';
  /** Optional capability id the app should refresh status for. */
  capabilityId?: string;
  /** Optional success message replacing the default "Done" copy. */
  message?: string;
}

/**
 * Pairing-code approval. Used by Hermes channels that surface a one-time
 * code the user must read off another device (Matrix, iMessage/BlueBubbles,
 * Signal device link, etc.) and confirm. The agent renders the code and
 * waits for the user to approve or reject — no QR scanning, no clipboard.
 */
export interface PairingApproveIntent extends IntentBase {
  type: 'pairing_approve';
  /** The pairing code to display prominently (e.g. "AB12-CD34"). */
  pairingCode: string;
  /** Optional channel/platform name shown in the header (e.g. "Matrix"). */
  platform?: string;
  /** Optional short instructions ("Enter this code on your phone…"). */
  instructions?: string;
  /** Button text for the approve action. Defaults to "Approve". */
  approveLabel?: string;
  /** Button text for the reject action. Defaults to "Reject". */
  rejectLabel?: string;
}

export type AgentIntent =
  | CredentialRequestIntent
  | ConfirmIntent
  | ChoiceIntent
  | QRDisplayIntent
  | OAuthOpenIntent
  | FilePickIntent
  | ProgressIntent
  | DoneIntent
  | PairingApproveIntent;

/** Reply the renderer posts back as a `ronbot-intent-response` block. */
export interface IntentResponse {
  id: string;
  /** True if the user submitted; false if they cancelled / it expired. */
  ok: boolean;
  /** Per-field values for `credential_request` and `choice` intents. */
  values?: Record<string, string>;
  /** Selected path for `file_pick`. */
  path?: string;
  /** Optional reason when `ok` is false (e.g. "cancelled", "expired"). */
  reason?: string;
}

/* ─────────────────────────────  Validators  ───────────────────────────── */

/** Cheap structural check — keeps us free of runtime deps like zod. */
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/**
 * Validate a parsed JSON object claims to be an AgentIntent and return it
 * narrowed; throw with a useful message if it's malformed. Designed so the
 * parser can call this defensively on every block without the renderer
 * having to think about partial/garbage payloads.
 */
export const validateIntent = (raw: unknown): AgentIntent => {
  if (!isObj(raw)) throw new Error('intent: not an object');
  if (!isStr(raw.id)) throw new Error('intent: missing id');
  if (!isStr(raw.type)) throw new Error('intent: missing type');
  if (!isStr(raw.title)) throw new Error('intent: missing title');

  switch (raw.type) {
    case 'credential_request': {
      const fields = raw.fields;
      if (!Array.isArray(fields) || fields.length === 0) {
        throw new Error('credential_request: fields[] required');
      }
      for (const f of fields) {
        if (!isObj(f) || !isStr(f.key) || !isStr(f.label)) {
          throw new Error('credential_request: each field needs key+label');
        }
      }
      return raw as unknown as CredentialRequestIntent;
    }
    case 'confirm':
      return raw as unknown as ConfirmIntent;
    case 'choice': {
      const opts = raw.options;
      if (!Array.isArray(opts) || opts.length === 0) {
        throw new Error('choice: options[] required');
      }
      for (const o of opts) {
        if (!isObj(o) || !isStr(o.value) || !isStr(o.label)) {
          throw new Error('choice: each option needs value+label');
        }
      }
      return raw as unknown as ChoiceIntent;
    }
    case 'qr_display':
      if (!isStr(raw.qr)) throw new Error('qr_display: qr required');
      return raw as unknown as QRDisplayIntent;
    case 'oauth_open':
      if (!isStr(raw.url)) throw new Error('oauth_open: url required');
      return raw as unknown as OAuthOpenIntent;
    case 'file_pick':
      return raw as unknown as FilePickIntent;
    case 'progress':
      return raw as unknown as ProgressIntent;
    case 'done':
      return raw as unknown as DoneIntent;
    case 'pairing_approve':
      if (!isStr(raw.pairingCode)) throw new Error('pairing_approve: pairingCode required');
      return raw as unknown as PairingApproveIntent;
    default:
      throw new Error(`intent: unknown type "${String(raw.type)}"`);
  }
};

/**
 * Validate a single submitted value against a field's `validate` regex.
 * Used by `CredentialRequestCard` before enabling the Submit button.
 * Returns null when valid, or a human error message.
 */
export const validateFieldValue = (
  field: IntentField,
  value: string,
): string | null => {
  const v = (value || '').trim();
  if (!v) return field.optional ? null : `${field.label} is required`;
  if (field.validate) {
    try {
      const re = new RegExp(field.validate);
      if (!re.test(v)) return `${field.label} doesn't match the expected format`;
    } catch {
      // Bad regex from the agent — don't block the user on our error.
      return null;
    }
  }
  return null;
};
