import { describe, expect, it } from "vitest";
import { parseCronListOutput, parseProfileListOutput, parseInsightsOutput } from "./cliParsers";

describe("cliParsers", () => {
  it("parseCronListOutput handles empty message", () => {
    expect(parseCronListOutput("no scheduled jobs")).toEqual([]);
  });

  it("parseProfileListOutput strips ANSI and reads active", () => {
    const text = "Name\n*default\nother";
    const rows = parseProfileListOutput(text);
    expect(rows.some((r) => r.name === "default" && r.active)).toBe(true);
  });

  it("parseInsightsOutput extracts numbers", () => {
    const out = parseInsightsOutput("Sessions: 3\nMessages: 10\nTokens in: 1,000\n");
    expect(out.sessionsLast7d).toBe(3);
    expect(out.messagesLast7d).toBe(10);
    expect(out.tokensIn).toBe(1000);
  });
});
