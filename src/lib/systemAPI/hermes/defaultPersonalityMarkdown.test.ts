import { describe, expect, it } from "vitest";
import { buildDefaultSoulMarkdown, parseAgentDisplayNameFromSoul } from "./defaultPersonalityMarkdown";

describe("buildDefaultSoulMarkdown", () => {
  it("embeds display name for parseAgentDisplayNameFromSoul", () => {
    const s = buildDefaultSoulMarkdown("Alex");
    expect(s).toContain("**Alex**, the user's personal AI agent");
    expect(parseAgentDisplayNameFromSoul(s)).toBe("Alex");
  });

  it("strips markdown-breaking characters from the name", () => {
    const s = buildDefaultSoulMarkdown('x*y#z`');
    expect(parseAgentDisplayNameFromSoul(s)).toBe("xyz");
  });
});

describe("parseAgentDisplayNameFromSoul", () => {
  it("reads legacy single-line H1 persona", () => {
    const c = `# Terry\n\nShort legacy soul.`;
    expect(parseAgentDisplayNameFromSoul(c)).toBe("Terry");
  });

  it("returns null for SOUL principles title without template", () => {
    const c = "# SOUL - Global Operating Principles\n\n## Identity\nAnonymous.";
    expect(parseAgentDisplayNameFromSoul(c)).toBeNull();
  });
});
