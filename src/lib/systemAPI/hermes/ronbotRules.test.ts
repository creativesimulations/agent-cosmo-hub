import { describe, expect, it } from "vitest";
import { AGENT_INTENT_TYPES } from "@/lib/agentIntents/protocol";
import { APP_ROUTES } from "@/lib/appRoutes";
import {
  RONBOT_APP_GUIDE,
  RONBOT_ELECTRON_APP_GUIDE,
  RONBOT_APP_GUIDE_VERSION,
  RONBOT_ELECTRON_APP_GUIDE_VERSION,
  RONBOT_RULES_BLOCK,
} from "./ronbotRules";

describe("RONBOT_APP_GUIDE vs protocol", () => {
  it("documents UI protocol without steering Hermes behavior", () => {
    expect(RONBOT_RULES_BLOCK).toMatch(/ronbot-intent/i);
    expect(RONBOT_RULES_BLOCK).not.toMatch(/clarify/i);
    expect(RONBOT_RULES_BLOCK).not.toMatch(/MUST NOT|never tell|run setup commands yourself/i);
    expect(RONBOT_APP_GUIDE).not.toMatch(/Avoid the blocking\s+`clarify`/i);
    expect(RONBOT_APP_GUIDE).toMatch(/Hermes chooses/i);
  });

  it("documents every intent type with a dedicated heading", () => {
    for (const t of AGENT_INTENT_TYPES) {
      expect(RONBOT_APP_GUIDE).toContain(`### ${t} —`);
    }
  });

  it("includes rendering table and response cheat-sheet", () => {
    expect(RONBOT_APP_GUIDE).toContain("## What Ronbot renders");
    expect(RONBOT_APP_GUIDE).toContain("## Response cheat-sheet");
    expect(RONBOT_APP_GUIDE).toMatch(/progress.*new assistant message/i);
  });

  it("uses current version header", () => {
    expect(RONBOT_APP_GUIDE.startsWith(RONBOT_APP_GUIDE_VERSION)).toBe(true);
  });
});

describe("RONBOT_ELECTRON_APP_GUIDE", () => {
  it("documents every primary app route", () => {
    for (const route of APP_ROUTES) {
      const hash = route === "/" ? "#/" : `#${route}`;
      expect(RONBOT_ELECTRON_APP_GUIDE).toContain(hash);
    }
  });

  it("documents legacy keys redirect and diagnostics support bundle", () => {
    expect(RONBOT_ELECTRON_APP_GUIDE).toMatch(/#\/keys.*#\/secrets|keys.*redirect/i);
    expect(RONBOT_ELECTRON_APP_GUIDE).toMatch(/support bundle/i);
    expect(RONBOT_ELECTRON_APP_GUIDE).toContain("#/diagnostics");
  });

  it("mentions Hermes CLI injection and ignore-rules", () => {
    expect(RONBOT_ELECTRON_APP_GUIDE).toMatch(/ignore-rules|--ignore-rules/i);
  });

  it("uses current version header", () => {
    expect(RONBOT_ELECTRON_APP_GUIDE.startsWith(RONBOT_ELECTRON_APP_GUIDE_VERSION)).toBe(true);
  });
});
