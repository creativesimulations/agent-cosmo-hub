import { describe, expect, it } from "vitest";
import { hashText, personaSignaturesMatch } from "./personaSignature";
import type { ChatPersonaSignature } from "./types";

const signature = (overrides?: Partial<ChatPersonaSignature>): ChatPersonaSignature => ({
  agentName: "Ron",
  capturedAt: new Date("2026-06-03T00:00:00.000Z"),
  files: [
    { path: ".hermes/SOUL.md", exists: true, hash: "soul" },
    { path: ".hermes/PERSONALITY.md", exists: true, hash: "personality" },
  ],
  ...overrides,
});

describe("persona signatures", () => {
  it("hashes text stably", () => {
    expect(hashText("same")).toBe(hashText("same"));
    expect(hashText("same")).not.toBe(hashText("different"));
  });

  it("treats missing signatures as compatible", () => {
    expect(personaSignaturesMatch(undefined, signature())).toBe(true);
    expect(personaSignaturesMatch(signature(), undefined)).toBe(true);
  });

  it("matches unchanged agent name and file hashes", () => {
    expect(personaSignaturesMatch(signature(), signature())).toBe(true);
  });

  it("detects changed agent name or file hash", () => {
    expect(personaSignaturesMatch(signature(), signature({ agentName: "Rin" }))).toBe(false);
    expect(personaSignaturesMatch(
      signature(),
      signature({ files: [{ path: ".hermes/SOUL.md", exists: true, hash: "changed" }] }),
    )).toBe(false);
  });
});
