import { describe, expect, it } from "vitest";
import { extractDelegationGoal } from "./streamGoals";

describe("extractDelegationGoal", () => {
  it("pulls goal from JSON-like task field", () => {
    const buf = 'tool call delegate_task {"task": "Summarize the Q2 roadmap"}';
    expect(extractDelegationGoal(buf)).toContain("Summarize the Q2 roadmap");
  });

  it("returns placeholder when nothing matches", () => {
    expect(extractDelegationGoal("hello world")).toBe("(no goal captured)");
  });

  it("rejects bare tool-name captures", () => {
    expect(extractDelegationGoal('delegate_task │')).toBe("(no goal captured)");
  });
});
