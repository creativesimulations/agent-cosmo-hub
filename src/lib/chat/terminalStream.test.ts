import { describe, expect, it } from "vitest";
import {
  TERMINAL_STREAM_MAX,
  appendTerminalChunk,
  filterTerminalChunk,
  finalizeTerminalTranscript,
} from "./terminalStream";

describe("filterTerminalChunk", () => {
  it("strips ANSI, hermes-diag, and Hermes chrome lines", () => {
    const raw = [
      "\x1b[32mQuery: hi\x1b[0m",
      "Initializing agent...",
      "↻ Resumed session abc (1 user message)",
      "────────────────",
      "╭─ ⚕ Hermes ───╮",
      "[hermes-diag] secret detail",
      "Hello from the model",
    ].join("\n");
    expect(filterTerminalChunk(raw)).toBe("Hello from the model");
  });
});

describe("appendTerminalChunk", () => {
  it("accumulates chunks", () => {
    let acc = "";
    acc = appendTerminalChunk(acc, "line1\n");
    acc = appendTerminalChunk(acc, "line2");
    expect(acc).toBe("line1\nline2");
  });

  it("caps buffer size", () => {
    const big = "x".repeat(TERMINAL_STREAM_MAX + 1000);
    const acc = appendTerminalChunk("", big);
    expect(acc.length).toBe(TERMINAL_STREAM_MAX);
    expect(acc).toBe(big.slice(-TERMINAL_STREAM_MAX));
  });
});

describe("finalizeTerminalTranscript", () => {
  it("removes leading and trailing Hermes chrome", () => {
    const src = [
      "Query: how's it going?",
      "Initializing agent...",
      "↻ Resumed session abc",
      "────────────────",
      "Here is the answer.",
      "╰──────────────────╯",
      "",
      "Resume this session with:",
      "  hermes --resume abc123",
      "Session:        abc123",
    ].join("\n");
    expect(finalizeTerminalTranscript(src)).toBe("Here is the answer.");
  });

  it("keeps tool traces and permission prompt text", () => {
    const src = "Choice [o/s/a/D]: allow?\nTool: shell.run\nDone.";
    expect(finalizeTerminalTranscript(src)).toBe(src);
  });
});
