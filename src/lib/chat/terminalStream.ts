import { isBannerLine, isEchoLine, stripAnsi } from "@/lib/systemAPI/hermes/chatOutput";

/** Max accumulated transcript per turn (chars). */
export const TERMINAL_STREAM_MAX = 64 * 1024;

/** Preserve the start of long replies when the buffer rolls over. */
const TRANSCRIPT_HEAD_KEEP = 16 * 1024;

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
  const head = next.slice(0, TRANSCRIPT_HEAD_KEEP);
  const tailBudget = TERMINAL_STREAM_MAX - TRANSCRIPT_HEAD_KEEP - 32;
  const tail = next.slice(-Math.max(0, tailBudget));
  return `${head}\n…[middle truncated]…\n${tail}`;
}

/** True when Hermes printed its usual pre-reply chrome (box, init, query echo). */
export function hasLeadingHermesChrome(lines: string[]): boolean {
  const head = lines.slice(0, 16);
  return head.some((line) => {
    const t = line.trim();
    if (!t) return false;
    if (/[│┃╭╮╰╯┌┐└┘─━═╔╗╚╝]/.test(t)) return true;
    if (/^query:\s/i.test(t)) return true;
    if (/^initializing agent/i.test(t)) return true;
    if (/^[↻⟳]?\s*resumed session/i.test(t)) return true;
    if (/^[▶►]?\s*starting (a )?new session/i.test(t)) return true;
    return false;
  });
}

function trimLeadingBannerLines(lines: string[]): string[] {
  if (!hasLeadingHermesChrome(lines)) return lines;
  let start = 0;
  while (start < lines.length && isBannerLine(lines[start])) start += 1;
  return lines.slice(start);
}

export function stripLeadingEchoLines(lines: string[], userPrompt?: string): string[] {
  if (!userPrompt?.trim()) return lines;
  const out = [...lines];
  while (out.length > 0 && isEchoLine(out[0], userPrompt)) out.shift();
  return out;
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
export function finalizeTerminalTranscript(acc: string, userPrompt?: string): string {
  let lines = stripLeadingEchoLines(acc.split(/\r?\n/), userPrompt);
  while (lines.length > 0 && !lines[0].trim()) lines = lines.slice(1);
  const trimmed = trimTrailingBannerLines(trimLeadingBannerLines(lines));
  return trimmed.join("\n").trimEnd();
}
