import { describe, expect, it } from "vitest";
import { publishHermesMarkers, stripHermesMarkers, subscribeHermesMarkers } from "./hermesMarkers";

describe("stripHermesMarkers", () => {
  it("strips SHOW_QR and collects payload", () => {
    const { text, markers } = stripHermesMarkers("Hello\n[SHOW_QR]https://example.com/x\nTail");
    expect(text).toContain("Hello");
    expect(text).toContain("Tail");
    expect(text).not.toContain("SHOW_QR");
    expect(markers).toEqual([{ kind: "qr", payload: "https://example.com/x" }]);
  });

  it("strips REQUEST_PASSWORD with purpose", () => {
    const { markers } = stripHermesMarkers("x\n[REQUEST_PASSWORD] API token\ny");
    expect(markers).toEqual([{ kind: "password", purpose: "API token" }]);
  });

  it("parses SHOW_BRAID_GRAPH with following mermaid fence", () => {
    const src = [
      "Intro",
      "[SHOW_BRAID_GRAPH]",
      "```mermaid",
      "flowchart LR",
      "  A --> B",
      "```",
      "Outro",
    ].join("\n");
    const { text, markers } = stripHermesMarkers(src);
    expect(markers[0]).toMatchObject({ kind: "braid" });
    expect((markers[0] as { kind: "braid"; mermaid?: string }).mermaid).toContain("flowchart LR");
    expect(text).toContain("Intro");
    expect(text).toContain("Outro");
    expect(text).not.toContain("SHOW_BRAID_GRAPH");
  });
});

describe("publishHermesMarkers", () => {
  it("notifies subscribers", () => {
    const seen: string[] = [];
    const unsub = subscribeHermesMarkers((m) => {
      for (const x of m) seen.push(x.kind);
    });
    publishHermesMarkers([{ kind: "qr", payload: "x" }]);
    unsub();
    expect(seen).toEqual(["qr"]);
  });
});
