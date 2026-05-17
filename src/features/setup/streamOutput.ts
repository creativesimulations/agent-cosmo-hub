// Hermes v0.13.0 sync — May 2026 (Ronbot)
import type { StreamEvent } from "./types";

/** Accumulates streamed stdout/stderr into complete lines. */
export function createStreamLineParser(onLines: (lines: string[]) => void) {
  let buffered = "";

  const parse = (event: StreamEvent) => {
    if ((event.type !== "stdout" && event.type !== "stderr") || !event.data) return;
    buffered += event.data.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const parts = buffered.split("\n");
    buffered = parts.pop() ?? "";
    const lines = parts.map((l) => l.trimEnd()).filter(Boolean);
    if (lines.length > 0) onLines(lines);
  };

  const flush = () => {
    const tail = buffered.trim();
    buffered = "";
    if (tail) onLines([tail]);
  };

  return { parse, flush };
}
