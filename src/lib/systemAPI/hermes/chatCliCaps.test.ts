import { describe, expect, it } from "vitest";
import { parseHermesChatHelp } from "./chatCliCaps";

describe("parseHermesChatHelp", () => {
  it("detects --no-color when present", () => {
    expect(parseHermesChatHelp("  --no-color     Strip ANSI colors").supportsNoColor).toBe(true);
  });

  it("defaults no-color false when absent", () => {
    expect(parseHermesChatHelp("-q, --query").supportsNoColor).toBe(false);
  });
});
