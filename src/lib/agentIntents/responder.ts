/**
 * Build the chat turn that delivers an `IntentResponse` back to the agent.
 *
 * The response travels as a fenced JSON block embedded in a regular user
 * turn. The agent's prompt template tells it to look for these and consume
 * them as the answer to the matching `id`.
 *
 * Shape of a response turn:
 *
 *     ```ronbot-intent-response
 *     { "id": "intent_abc", "ok": true, "values": { "SLACK_BOT_TOKEN": "xoxb-…" } }
 *     ```
 *
 * The renderer also gets a short `summary` it can show in the chat where
 * the user message would normally go, so secrets never appear inline.
 */

import type { IntentResponse, AgentIntent } from './protocol';

/** Wire-format string + a UI-friendly summary for the chat bubble. */
export interface FormattedIntentResponse {
  /** Full prompt text to send via `ChatContext.sendMessage`. */
  prompt: string;
  /** Short, redacted line shown in the user bubble (no secrets). */
  summary: string;
}

const isSecretField = (key: string): boolean =>
  /token|secret|key|password|api/i.test(key);

/**
 * Produce a redacted summary for display. Replaces every value whose key
 * looks secret-ish with `••••`. Non-secret values are shown verbatim.
 */
const redactSummary = (intent: AgentIntent | undefined, values?: Record<string, string>): string => {
  if (!values || Object.keys(values).length === 0) return '';
  return Object.entries(values)
    .map(([k, v]) => {
      const fieldSecret =
        intent && intent.type === 'credential_request'
          ? intent.fields.find((f) => f.key === k)?.secret
          : undefined;
      const masked = fieldSecret ?? isSecretField(k);
      return `${k}=${masked ? '••••' : v}`;
    })
    .join(', ');
};

/** Format an `IntentResponse` into the prompt the user-turn will carry. */
export const formatIntentResponse = (
  response: IntentResponse,
  intent?: AgentIntent,
): FormattedIntentResponse => {
  const json = JSON.stringify(response, null, 2);
  const prompt = ['```ronbot-intent-response', json, '```'].join('\n');

  let summary: string;
  if (!response.ok) {
    summary = response.reason ? `Cancelled (${response.reason})` : 'Cancelled';
  } else if (response.path) {
    summary = `Selected: ${response.path}`;
  } else if (response.values) {
    const redacted = redactSummary(intent, response.values);
    summary = redacted ? `Sent: ${redacted}` : 'Submitted';
  } else {
    summary = 'Confirmed';
  }
  if (intent?.title) summary = `[${intent.title}] ${summary}`;
  return { prompt, summary };
};
