import { describe, expect, it } from "vitest";
import { APP_ROUTES } from "@/lib/appRoutes";
import {
  RONBOT_ELECTRON_APP_GUIDE,
  RONBOT_ELECTRON_APP_GUIDE_VERSION,
  RONBOT_MEMORY_UI_POINTER,
  RONBOT_RULES_BLOCK,
} from "./ronbotRules";

describe("RONBOT_RULES_BLOCK", () => {
  it("points to ELECTRON guide and markers only", () => {
    expect(RONBOT_RULES_BLOCK).toContain("ELECTRON_APP_GUIDE.md");
    expect(RONBOT_RULES_BLOCK).toMatch(/\[SHOW_QR\]/);
    expect(RONBOT_RULES_BLOCK).not.toMatch(/ronbot-intent/i);
    expect(RONBOT_RULES_BLOCK).not.toMatch(/~\/\.ronbot\/APP_GUIDE/i);
  });
});

describe("RONBOT_MEMORY_UI_POINTER", () => {
  it("references ELECTRON guide only", () => {
    expect(RONBOT_MEMORY_UI_POINTER).toContain("ELECTRON_APP_GUIDE.md");
    expect(RONBOT_MEMORY_UI_POINTER).not.toMatch(/~\/\.ronbot\/APP_GUIDE/i);
    expect(RONBOT_MEMORY_UI_POINTER).not.toMatch(/ronbot-intent/i);
  });
});

describe("RONBOT_ELECTRON_APP_GUIDE", () => {
  it("documents every primary app route", () => {
    for (const route of APP_ROUTES) {
      const hash = route === "/" ? "#/" : `#${route}`;
      expect(RONBOT_ELECTRON_APP_GUIDE).toContain(hash);
    }
  });

  it("documents stream markers and no JSON intents", () => {
    expect(RONBOT_ELECTRON_APP_GUIDE).toContain("[SHOW_QR]");
    expect(RONBOT_ELECTRON_APP_GUIDE).toContain("[REQUEST_CREDENTIALS]");
    expect(RONBOT_ELECTRON_APP_GUIDE).toContain("[SHOW_BRAID_GRAPH]");
    expect(RONBOT_ELECTRON_APP_GUIDE).toMatch(/No fenced JSON/i);
    expect(RONBOT_ELECTRON_APP_GUIDE).not.toMatch(/ronbot-intent/i);
    expect(RONBOT_ELECTRON_APP_GUIDE).not.toMatch(/~\/\.ronbot\/APP_GUIDE/i);
  });

  it("documents secrets route and support bundle", () => {
    expect(RONBOT_ELECTRON_APP_GUIDE).toMatch(/#\/secrets/i);
    expect(RONBOT_ELECTRON_APP_GUIDE).toMatch(/support bundle/i);
    expect(RONBOT_ELECTRON_APP_GUIDE).toContain("#/diagnostics");
  });

  it("uses current version header", () => {
    expect(RONBOT_ELECTRON_APP_GUIDE.startsWith(RONBOT_ELECTRON_APP_GUIDE_VERSION)).toBe(true);
  });
});
