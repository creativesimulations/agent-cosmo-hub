import { stripAnsi } from "@/lib/systemAPI/hermes/chatOutput";

/** Max accumulated transcript per turn (chars). */
export const TERMINAL_STREAM_MAX = 64 * 1024;

const HERMES_DIAG_LINE = /^\[hermes-diag\]/;

const SESSION_FOOTER_LINE =
  /^(?:Resume this session(?:\s+with)?|hermes\s+--resume\b|Session id:|Duration:|Messages:|Tokens?:|Cost:)/i;

/** Remove Ronbot-injected diagnostic lines from a stream chunk. */
export function filterTerminalChunk(chunk: string): string {
  const noAnsi = stripAnsi(chunk);
  if (!noAnsi) return "";
  return noAnsi
    .split(/\r?\n/)
    .filter((line) => !HERMES_DIAG_LINE.test(line.trim()))
    .join("\n");
}

/** Append stdout/stderr chunk to the live transcript buffer. */
export function appendTerminalChunk(acc: string, chunk: string): string {
  const piece = filterTerminalChunk(chunk);
  if (!piece) return acc;
  const next = acc + piece;
  if (next.length <= TERMINAL_STREAM_MAX) return next;
  return next.slice(-TERMINAL_STREAM_MAX);
}

/** End-of-turn trim: drop trailing Hermes session footer only. */
export function finalizeTerminalTranscript(acc: string): string {
  const lines = acc.split(/\r?\n/);
  let end = lines.length;
  while (end > 0) {
    const t = lines[end - 1].trim();
    if (!t) {
      end -= 1;
      continue;
    }
    if (SESSION_FOOTER_LINE.test(t)) {
      end -= 1;
      continue;
    }
    break;
  }
  return lines.slice(0, end).join("\n").trimEnd();
}
