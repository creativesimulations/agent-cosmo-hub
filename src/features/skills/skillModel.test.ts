import { describe, expect, it } from "vitest";
import { skillSetupPrompt, skillStatus } from "./skillModel";
import { skillToCapabilityId } from "@/lib/capabilities";

describe("skillModel", () => {
  it("skillSetupPrompt uses recipe hints without page-specific strings", () => {
    const gw = skillSetupPrompt({
      name: "google-workspace",
      category: "productivity",
      source: "bundled",
      requiredSecrets: ["GOOGLE_CLIENT_ID"],
    });
    expect(gw).toContain("google-workspace");
    expect(gw).toContain("GOOGLE_CLIENT_ID");
    expect(gw).not.toContain("Gmail, Calendar, Drive, Docs, Sheets");

    const generic = skillSetupPrompt({
      name: "my-custom-skill",
      category: "other",
      source: "user",
    });
    expect(generic).toContain("my-custom-skill");
    expect(generic).toContain("set up");
    expect(generic).not.toContain("hermes auth");
  });

  it("skillStatus reports disabled, needs setup, and ready", () => {
    const skill = {
      name: "test-skill",
      category: "other",
      source: "user" as const,
      requiredSecrets: ["API_KEY"],
    };
    expect(skillStatus(skill, new Set(["test-skill"]), new Set()).tone).toBe("disabled");
    expect(skillStatus(skill, new Set(), new Set()).tone).toBe("needs");
    expect(skillStatus(skill, new Set(), new Set(["API_KEY"])).tone).toBe("ready");
  });
});

describe("skillToCapabilityId", () => {
  it("maps google-workspace to stable builtin id", () => {
    expect(skillToCapabilityId("google-workspace")).toBe("google-workspace");
    expect(skillToCapabilityId("google_workspace")).toBe("google-workspace");
  });
});
