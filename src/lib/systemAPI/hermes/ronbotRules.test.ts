import { describe, expect, it } from "vitest";
import { AGENT_INTENT_TYPES } from "@/lib/agentIntents/protocol";
import { APP_ROUTES } from "@/lib/appRoutes";
import {
  RONBOT_APP_GUIDE,
  RONBOT_ELECTRON_APP_GUIDE,
  RONBOT_APP_GUIDE_VERSION,
  RONBOT_ELECTRON_APP_GUIDE_VERSION,
} from "./ronbotRules";

describe("RONBOT_APP_GUIDE vs protocol", () => {
  it("documents every intent type with a dedicated heading", () => {
    for (const t of AGENT_INTENT_TYPES) {
      expect(RONBOT_APP_GUIDE).toContain(`### ${t} —`);
    }
  });

  it("includes intents-vs-markers table and response cheat-sheet", () => {
    expect(RONBOT_APP_GUIDE).toContain("## Intents vs stream markers");
    expect(RONBOT_APP_GUIDE).toContain("## Response cheat-sheet");
    expect(RONBOT_APP_GUIDE).toMatch(/progress.*new assistant messages/i);
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
