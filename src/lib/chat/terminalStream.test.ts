import { describe, expect, it } from "vitest";
import {
  TERMINAL_STREAM_MAX,
  appendTerminalChunk,
  filterTerminalChunk,
  finalizeTerminalTranscript,
} from "./terminalStream";

describe("filterTerminalChunk", () => {
  it("strips ANSI and hermes-diag lines", () => {
    const raw = "\x1b[32mok\x1b[0m\n[hermes-diag] secret detail\nvisible";
    expect(filterTerminalChunk(raw)).toBe("ok\nvisible");
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
  it("removes trailing session footer block", () => {
    const src = [
      "Here is the answer.",
      "",
      "Resume this session with:",
      "  hermes --resume abc123",
      "Session id: abc123",
      "Duration: 12s",
      "Tokens: 100",
      "Cost: $0.01",
    ].join("\n");
    expect(finalizeTerminalTranscript(src)).toBe("Here is the answer.");
  });

  it("keeps tool traces and permission prompt text", () => {
    const src = "Choice [o/s/a/D]: allow?\nTool: shell.run\nDone.";
    expect(finalizeTerminalTranscript(src)).toBe(src);
  });
});
