import { describe, expect, it } from "vitest";
import { extractTerminalQrMarkers, publishHermesMarkers, stripHermesMarkers, subscribeHermesMarkers } from "./hermesMarkers";

describe("stripHermesMarkers", () => {
  it("strips SHOW_QR and collects payload", () => {
    const { text, markers } = stripHermesMarkers("Hello\n[SHOW_QR]https://example.com/x\nTail");
    expect(text).toContain("Hello");
    expect(text).toContain("Tail");
    expect(text).not.toContain("SHOW_QR");
    expect(markers).toEqual([{ kind: "qr", payload: "https://example.com/x", display: "payload" }]);
  });

  it("strips SHOW_QR with a terminal QR block", () => {
    const src = [
      "Scan this:",
      "[SHOW_QR]",
      "```text",
      "████  ██",
      "██  ████",
      "```",
      "Done",
    ].join("\n");
    const { text, markers } = stripHermesMarkers(src);
    expect(text).toContain("Scan this:");
    expect(text).toContain("Done");
    expect(text).not.toContain("SHOW_QR");
    expect(markers).toEqual([{ kind: "qr", payload: "████  ██\n██  ████", display: "terminal" }]);
  });

  it("does not turn a marker followed by prose into a fake QR", () => {
    const { text, markers } = stripHermesMarkers("[SHOW_QR]\ntext\nScan the QR above");
    expect(text).not.toContain("[SHOW_QR]");
    expect(text).toContain("text");
    expect(markers).toEqual([]);
  });

  it("strips REQUEST_PASSWORD with purpose", () => {
    const { markers } = stripHermesMarkers("x\n[REQUEST_PASSWORD] API token\ny");
    expect(markers).toEqual([{ kind: "password", purpose: "API token" }]);
  });

  it("strips REQUEST_CREDENTIALS with purpose", () => {
    const { markers } = stripHermesMarkers("x\n[REQUEST_CREDENTIALS] Slack token\ny");
    expect(markers).toEqual([{ kind: "password", purpose: "Slack token" }]);
  });

  it("strips UPDATE_DASHBOARD and sets dashboardRefresh", () => {
    const { text, dashboardRefresh } = stripHermesMarkers("Hi\n[UPDATE_DASHBOARD]\nBye");
    expect(text).not.toContain("UPDATE_DASHBOARD");
    expect(dashboardRefresh).toBe(true);
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

describe("extractTerminalQrMarkers", () => {
  it("extracts real terminal QR matrices from command output", () => {
    const line = "▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄";
    const output = [
      "📱 Scan this QR code with WhatsApp on your phone:",
      "",
      line,
      "████  ▄▄  ████  ▄▄  ████  ▄▄  ████  ▄▄",
      "▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
      "████  ▄▄  ████  ▄▄  ████  ▄▄  ████  ▄▄",
      "▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄",
      "████  ▄▄  ████  ▄▄  ████  ▄▄  ████  ▄▄",
      "▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
      "████  ▄▄  ████  ▄▄  ████  ▄▄  ████  ▄▄",
      "▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄",
      "waiting...",
    ].join("\\n");

    const markers = extractTerminalQrMarkers(output);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ kind: "qr", display: "terminal" });
    expect(markers[0].payload).toContain(line);
  });
});

describe("publishHermesMarkers", () => {
  it("notifies subscribers", () => {
    const seen: string[] = [];
    const unsub = subscribeHermesMarkers((m) => {
      for (const x of m) seen.push(x.kind);
    });
    publishHermesMarkers([{ kind: "qr", payload: "x", display: "payload" }]);
    unsub();
    expect(seen).toEqual(["qr"]);
  });
});
