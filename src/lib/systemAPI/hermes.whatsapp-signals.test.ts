import { describe, expect, it } from "vitest";
import { analyzeWhatsAppGatewaySignals, parseGatewayStartupRecoverySignals, parseSlackGatewayConflict } from "./hermes";

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

describe("parseSlackGatewayConflict", () => {
  it("extracts Slack conflict PID from gateway output", () => {
    const parsed = parseSlackGatewayConflict(`
ERROR gateway.platforms.base: [Slack] Slack app token already in use (PID 405234). Stop the other gateway first.
ERROR gateway.run: Gateway hit a non-retryable startup conflict: slack: Slack app token already in use (PID 405234).
`);
    expect(parsed.hasConflict).toBe(true);
    expect(parsed.pid).toBe(405234);
  });

  it("returns no conflict for unrelated warnings", () => {
    const parsed = parseSlackGatewayConflict(`
WARNING gateway.channel_directory: failed to list Slack channels: missing_scope
ERROR gateway.platforms.email: IMAP connection failed
`);
    expect(parsed.hasConflict).toBe(false);
    expect(parsed.pid).toBeUndefined();
  });
});

describe("parseGatewayStartupRecoverySignals", () => {
  it("detects dual Slack lock + WhatsApp runtime missing signals", () => {
    const parsed = parseGatewayStartupRecoverySignals(`
WARNING gateway.run: WhatsApp: Node.js not installed or bridge not configured
WARNING gateway.run: No adapter available for whatsapp
ERROR gateway.platforms.base: [Slack] Slack app token already in use (PID 405234). Stop the other gateway first.
`);
    expect(parsed.slackConflict.hasConflict).toBe(true);
    expect(parsed.slackConflict.pid).toBe(405234);
    expect(parsed.whatsappRuntimeMissing).toBe(true);
  });

  it("returns false when no startup recovery signature is present", () => {
    const parsed = parseGatewayStartupRecoverySignals(`
INFO gateway.run: startup ok
WARNING gateway.channel_directory: failed to list Slack channels
`);
    expect(parsed.slackConflict.hasConflict).toBe(false);
    expect(parsed.whatsappRuntimeMissing).toBe(false);
  });
});
