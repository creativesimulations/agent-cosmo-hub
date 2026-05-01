import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  discoverCapabilities,
  invalidateDiscoveryCache,
  filterByKind,
  groupByCategory,
} from "./discovery";

vi.mock("@/lib/systemAPI", () => {
  const state = {
    hermesResult: { ok: false } as { ok: boolean; raw?: Record<string, unknown>; error?: string },
    skills: [] as Array<{ name: string; category?: string; requiredSecrets?: string[]; description?: string }>,
  };
  return {
    systemAPI: {
      discoverCapabilities: vi.fn(async () => state.hermesResult),
      listSkills: vi.fn(async () => ({ success: true, skills: state.skills })),
    },
    __setMockState: (next: Partial<typeof state>) => Object.assign(state, next),
  };
});

// Pull the mock helper out of the mocked module.
import * as systemAPIMock from "@/lib/systemAPI";
const setMockState = (systemAPIMock as unknown as { __setMockState: (next: unknown) => void }).__setMockState;

describe("capability discovery", () => {
  beforeEach(() => {
    invalidateDiscoveryCache();
    setMockState({ hermesResult: { ok: false }, skills: [] });
  });

  it("falls back to seed when Hermes CLI is unavailable", async () => {
    const r = await discoverCapabilities({ force: true });
    expect(r.fromHermes).toBe(false);
    expect(Object.keys(r.capabilities).length).toBeGreaterThan(5);
    expect(r.capabilities.telegram).toBeDefined();
    expect(r.capabilities.telegram.kind).toBe("channel");
    expect(r.capabilities.telegram.source).toBe("seed");
  });

  it("merges Hermes-provided channels over the seed", async () => {
    setMockState({
      hermesResult: {
        ok: true,
        raw: {
          channels: [
            { id: "telegram", name: "Telegram", description: "Live from Hermes", requiredEnv: ["TELEGRAM_BOT_TOKEN"] },
            { id: "viber", name: "Viber", description: "Hot new channel", requiredEnv: ["VIBER_TOKEN"] },
          ],
        },
      },
    });
    const r = await discoverCapabilities({ force: true });
    expect(r.fromHermes).toBe(true);
    expect(r.capabilities.telegram.oneLiner).toBe("Live from Hermes");
    expect(r.capabilities.telegram.source).toBe("hermes");
    // Brand new channel from Hermes auto-appears.
    expect(r.capabilities.viber).toBeDefined();
    expect(r.capabilities.viber.kind).toBe("channel");
    expect(r.capabilities.viber.requiredSecrets).toContain("VIBER_TOKEN");
  });

  it("ingests installed skills as capabilities", async () => {
    setMockState({
      skills: [{ name: "youtube_transcripts", description: "Pull transcripts" }],
    });
    const r = await discoverCapabilities({ force: true });
    const skill = r.capabilities["skill:youtube_transcripts"];
    expect(skill).toBeDefined();
    expect(skill.kind).toBe("skill");
    expect(skill.icon).toBe("Youtube");
  });

  it("filterByKind narrows the registry", async () => {
    const r = await discoverCapabilities({ force: true });
    const channels = filterByKind(r.capabilities, ["channel"]);
    expect(channels.every((c) => c.kind === "channel")).toBe(true);
    expect(channels.length).toBeGreaterThan(3);
  });

  it("groupByCategory orders communication first", async () => {
    const r = await discoverCapabilities({ force: true });
    const groups = groupByCategory(Object.values(r.capabilities));
    expect(groups[0]?.category).toBe("communication");
  });
});
