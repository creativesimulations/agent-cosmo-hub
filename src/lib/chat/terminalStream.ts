import { isBannerLine, stripAnsi } from "@/lib/systemAPI/hermes/chatOutput";

/** Max accumulated transcript per turn (chars). */
export const TERMINAL_STREAM_MAX = 64 * 1024;

/** Hermes chrome lines; blank lines are kept so paragraph breaks survive streaming. */
export function isTranscriptNoiseLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return isBannerLine(line);
}

/** Hermes session footer lines stripped at end-of-turn (also covered by isBannerLine). */
const SESSION_FOOTER_LINE =
  /^(?:Resume this session(?:\s+with)?|hermes\s+--resume\b|Session(?:\s+id)?:|Duration:|Messages:|Tokens?:|Cost:)/i;

/** Remove Ronbot-injected diagnostic lines from a stream chunk. */
export function filterTerminalChunk(chunk: string): string {
  const noAnsi = stripAnsi(chunk);
  if (!noAnsi) return "";
  return noAnsi
    .split(/\r?\n/)
    .filter((line) => !isTranscriptNoiseLine(line))
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

function trimLeadingBannerLines(lines: string[]): string[] {
  let start = 0;
  while (start < lines.length && isBannerLine(lines[start])) start += 1;
  return lines.slice(start);
}

function trimTrailingBannerLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0) {
    const t = lines[end - 1];
    if (!isBannerLine(t) && !SESSION_FOOTER_LINE.test(t.trim())) break;
    end -= 1;
  }
  return lines.slice(0, end);
}

/** End-of-turn trim: drop Hermes chrome before the reply and session footer after. */
export function finalizeTerminalTranscript(acc: string): string {
  const trimmed = trimTrailingBannerLines(trimLeadingBannerLines(acc.split(/\r?\n/)));
  return trimmed.join("\n").trimEnd();
}
