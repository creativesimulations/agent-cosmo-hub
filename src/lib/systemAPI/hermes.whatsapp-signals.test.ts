import { describe, expect, it } from "vitest";
import { analyzeWhatsAppGatewaySignals } from "./hermes";

describe("analyzeWhatsAppGatewaySignals", () => {
  it("keeps Slack warning informational when WhatsApp is healthy", () => {
    const report = analyzeWhatsAppGatewaySignals(`
WARNING gateway.channel_directory: failed to list Slack channels: missing_scope
INFO gateway.run: WhatsApp connected and ready
`);
    expect(report.fatalWhatsappReason).toBeUndefined();
    expect(report.nonWhatsappWarnings.some((line) => line.toLowerCase().includes("slack"))).toBe(true);
  });

  it("keeps email auth warning informational", () => {
    const report = analyzeWhatsAppGatewaySignals(`
ERROR gateway.platforms.email: [Email] IMAP connection failed: AUTHENTICATIONFAILED
INFO gateway.run: WhatsApp connected and ready
`);
    expect(report.fatalWhatsappReason).toBeUndefined();
    expect(report.nonWhatsappWarnings.some((line) => line.toLowerCase().includes("email"))).toBe(true);
  });

  it("flags missing WhatsApp adapter as fatal", () => {
    const report = analyzeWhatsAppGatewaySignals(`
WARNING gateway.run: No adapter available for whatsapp
`);
    expect(report.fatalWhatsappReason).toBe("adapter-missing");
  });

  it("flags bridge runtime missing Node/configuration as fatal", () => {
    const report = analyzeWhatsAppGatewaySignals(`
WARNING gateway.run: WhatsApp: Node.js not installed or bridge not configured
`);
    expect(report.fatalWhatsappReason).toBe("bridge-not-configured");
  });

  it("does not mark generic gateway startup errors as WhatsApp-fatal", () => {
    const report = analyzeWhatsAppGatewaySignals(`
ERROR hermes gateway start failed: service unavailable
`);
    expect(report.fatalWhatsappReason).toBeUndefined();
    expect(report.nonWhatsappWarnings.length).toBe(0);
  });
});
