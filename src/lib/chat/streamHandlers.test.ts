import { describe, expect, it, vi } from "vitest";
import { ChatStreamTurnState, CHAT_ACTIVITY_PATTERNS } from "./streamHandlers";

describe("ChatStreamTurnState", () => {
  it("counts shell activity and records capability use", () => {
    const recordUse = vi.fn();
    const setLive = vi.fn();
    const s = new ChatStreamTurnState();
    s.handleChunk({ type: "stdout", data: "invoking run_shell for setup\n" }, { recordUse, setLiveSubAgentCount: setLive });
    expect(s.activityThisTurn.shell).toBeGreaterThan(0);
    expect(recordUse).toHaveBeenCalledWith("shell");
    expect(s.usedCapsThisTurn.has("shell")).toBe(true);
  });

  it("increments approvalPromptSeen on permission-style lines", () => {
    const s = new ChatStreamTurnState();
    s.handleChunk(
      { type: "stderr", data: "Permission required for shell\n" },
      { recordUse: vi.fn(), setLiveSubAgentCount: vi.fn() },
    );
    expect(s.approvalPromptSeen).toBeGreaterThan(0);
  });
});

describe("CHAT_ACTIVITY_PATTERNS", () => {
  it("matches web_fetch as internet", () => {
    expect("calling web_fetch".match(CHAT_ACTIVITY_PATTERNS.internet)).toBeTruthy();
  });
});
