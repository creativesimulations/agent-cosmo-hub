import { describe, expect, it } from "vitest";
import { AGENT_INTENT_TYPES } from "@/lib/agentIntents/protocol";
import { RONBOT_APP_GUIDE } from "./ronbotRules";

describe("RONBOT_APP_GUIDE vs protocol", () => {
  it("documents every intent type with a dedicated heading", () => {
    for (const t of AGENT_INTENT_TYPES) {
      expect(RONBOT_APP_GUIDE).toContain(`### ${t} —`);
    }
  });

  it("mentions Hermes CLI injection and ignore-rules for alignment", () => {
    expect(RONBOT_APP_GUIDE).toMatch(/ignore-rules|--ignore-rules/i);
    expect(RONBOT_APP_GUIDE).toMatch(/hermes capabilities|listSkills/i);
  });
});
