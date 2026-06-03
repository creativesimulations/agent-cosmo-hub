import { describe, expect, it } from "vitest";
import { mergeHermesMarkers } from "./mergeHermesMarkers";

describe("mergeHermesMarkers", () => {
  it("deduplicates QR payloads", () => {
    const qr = { kind: "qr" as const, payload: "abc", display: "terminal" as const };
    const merged = mergeHermesMarkers([qr], [qr]);
    expect(merged).toHaveLength(1);
  });
});
