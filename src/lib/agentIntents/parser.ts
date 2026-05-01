/**
 * Parse `ronbot-intent` fenced JSON blocks out of streamed assistant text.
 *
 * The agent emits intents inline with normal markdown:
 *
 *     Setting up Slack now…
 *
 *     ```ronbot-intent
 *     { "id": "intent_abc", "type": "credential_request", … }
 *     ```
 *
 *     I'll wait for the tokens.
 *
 * The chat renderer needs two things: (a) the visible message text with
 * those blocks stripped, and (b) the parsed `AgentIntent[]` to render as
 * inline cards. This module does both.
 *
 * Streaming behavior: tokens arrive in arbitrary chunks, so a fence may be
 * split across two chunks. Use the stateful `IntentStreamParser` for
 * incremental parsing during a turn; use `splitIntentsFromText` for one-shot
 * parsing of a fully-buffered string (history rehydration, tests).
 */

import { validateIntent, type AgentIntent } from './protocol';

const FENCE_OPEN = /```ronbot-intent\s*\n/;
const FENCE_CLOSE = /\n```/;

/** Result of parsing a complete string for intents. */
export interface SplitResult {
  /** Cleaned text with all `ronbot-intent` fences removed. */
  text: string;
  /** All intents successfully parsed (in order). */
  intents: AgentIntent[];
  /**
   * Errors encountered for blocks that looked like intents but failed
   * validation. Surfaced for diagnostics; the renderer can log these.
   */
  errors: { raw: string; message: string }[];
}

/**
 * One-shot parse of a fully-buffered string. Strips every
 * ` ```ronbot-intent ` block and returns the cleaned text + parsed intents.
 * Unclosed fences are left in place (treated as plain text).
 */
export const splitIntentsFromText = (input: string): SplitResult => {
  const intents: AgentIntent[] = [];
  const errors: { raw: string; message: string }[] = [];
  let out = '';
  let cursor = 0;

  while (cursor < input.length) {
    const tail = input.slice(cursor);
    const open = tail.match(FENCE_OPEN);
    if (!open || open.index === undefined) {
      out += tail;
      break;
    }
    // Pre-fence text goes straight through.
    out += tail.slice(0, open.index);

    const afterOpen = open.index + open[0].length;
    const remainder = tail.slice(afterOpen);
    const close = remainder.match(FENCE_CLOSE);
    if (!close || close.index === undefined) {
      // Unclosed fence — keep as plain text and stop.
      out += tail.slice(open.index);
      break;
    }

    const json = remainder.slice(0, close.index);
    try {
      const parsed = validateIntent(JSON.parse(json));
      intents.push(parsed);
    } catch (e) {
      errors.push({ raw: json, message: e instanceof Error ? e.message : String(e) });
      // Drop malformed blocks from the visible text — they'd just confuse
      // the user. Diagnostics are surfaced via `errors`.
    }

    cursor += afterOpen + close.index + close[0].length;
  }

  return { text: out, intents, errors };
};

/**
 * Stateful parser for incremental streaming. Feed each chunk via `push()`;
 * each call returns the new visible text to append to the message + any
 * intents that just completed in this chunk. Partial fences are buffered
 * internally until the closing ` ``` ` arrives.
 */
export class IntentStreamParser {
  private buf = '';

  /** All errors accumulated so far across the stream. */
  readonly errors: { raw: string; message: string }[] = [];

  /**
   * Append a new streamed chunk and emit (visible-text-delta, completed-intents).
   * Visible text is everything safe to render right now: pre-fence content
   * plus a trailing partial block only when no intent fence is open.
   */
  push(chunk: string): { textDelta: string; intents: AgentIntent[] } {
    this.buf += chunk;
    const intents: AgentIntent[] = [];
    let textDelta = '';

    while (true) {
      const open = this.buf.match(FENCE_OPEN);
      if (!open || open.index === undefined) {
        // No (further) fence in buffer — flush all but a small tail that
        // could still be the start of a fence on the next chunk.
        const safe = Math.max(0, this.buf.length - 20); // ~length of '```ronbot-intent\n'
        textDelta += this.buf.slice(0, safe);
        this.buf = this.buf.slice(safe);
        break;
      }

      // Emit pre-fence content immediately.
      textDelta += this.buf.slice(0, open.index);
      const afterOpen = open.index + open[0].length;
      const close = this.buf.slice(afterOpen).match(FENCE_CLOSE);
      if (!close || close.index === undefined) {
        // Fence is open but not yet closed — wait for more chunks. Drop
        // everything we've already emitted and keep the open fence in buf.
        this.buf = this.buf.slice(open.index);
        break;
      }

      const json = this.buf.slice(afterOpen, afterOpen + close.index);
      try {
        intents.push(validateIntent(JSON.parse(json)));
      } catch (e) {
        this.errors.push({ raw: json, message: e instanceof Error ? e.message : String(e) });
      }

      // Skip past the whole block and continue scanning.
      this.buf = this.buf.slice(afterOpen + close.index + close[0].length);
    }

    return { textDelta, intents };
  }

  /** Flush any remaining buffered text at end-of-stream. */
  end(): { textDelta: string } {
    const out = this.buf;
    this.buf = '';
    return { textDelta: out };
  }
}
