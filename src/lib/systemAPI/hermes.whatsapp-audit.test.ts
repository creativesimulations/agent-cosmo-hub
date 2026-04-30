import { describe, expect, it } from 'vitest';
import { parseWhatsAppBridgeAudit, parseSlackGatewayConflict, parseGatewayStartupRecoverySignals } from './hermes';

describe('parseWhatsAppBridgeAudit', () => {
  it('captures HOME, BRIDGE_DIR, and groups passes vs failures', () => {
    const raw = [
      'AUDIT_BEGIN',
      'HOME=/home/kadosh',
      'BRIDGE_DIR=/home/kadosh/.hermes/hermes-agent/scripts/whatsapp-bridge',
      'PASS:hermes-home-resolved',
      'PASS:hermes-cli',
      'PASS:bridge-folder',
      'PASS:bridge-script',
      'PASS:bridge-package-json',
      'PASS:managed-node-runtime',
      'PASS:managed-npm',
      'PASS:managed-node-version',
      'PASS:shim-node',
      'FAIL:bridge-deps:Partial WhatsApp bridge install — missing: ~/.hermes/hermes-agent/scripts/whatsapp-bridge/node_modules/@whiskeysockets/baileys/package.json. Ronbot will reinstall automatically during setup.',
      'FAIL:bridge-deps-loadable:Managed Node cannot load @whiskeysockets/baileys from /home/kadosh/.hermes/hermes-agent/scripts/whatsapp-bridge — Cannot find package \'@whiskeysockets/baileys\'',
      'PASS:env-whatsapp-enabled',
      'PASS:env-allowed-users',
      'FAIL:session-creds:WhatsApp session not paired yet — scan the QR code first',
      'AUDIT_END',
    ].join('\n');

    const report = parseWhatsAppBridgeAudit(raw);

    expect(report.home).toBe('/home/kadosh');
    expect(report.bridgeDir).toBe('/home/kadosh/.hermes/hermes-agent/scripts/whatsapp-bridge');
    expect(report.passedChecks).toContain('hermes-home-resolved');
    expect(report.passedChecks).toContain('shim-node');
    expect(report.passedChecks).toContain('env-whatsapp-enabled');

    const failIds = report.failedChecks.map((f) => f.id);
    expect(failIds).toEqual(['bridge-deps', 'bridge-deps-loadable', 'session-creds']);
    expect(report.failedChecks[0].detail).toContain('Partial WhatsApp bridge install');
    expect(report.failedChecks[1].detail.toLowerCase()).toContain('cannot load');
  });

  it('returns empty arrays when audit produced no output', () => {
    const report = parseWhatsAppBridgeAudit('');
    expect(report.home).toBeUndefined();
    expect(report.bridgeDir).toBeUndefined();
    expect(report.passedChecks).toEqual([]);
    expect(report.failedChecks).toEqual([]);
  });

  it('treats session-creds as a non-blocking informational failure', () => {
    const raw = [
      'HOME=/home/u',
      'PASS:bridge-folder',
      'FAIL:session-creds:WhatsApp session not paired yet',
    ].join('\n');
    const report = parseWhatsAppBridgeAudit(raw);
    const blocking = report.failedChecks.filter((f) => f.id !== 'session-creds');
    expect(blocking).toEqual([]);
  });
});

describe('parseSlackGatewayConflict', () => {
  it('extracts the conflicting Slack PID', () => {
    const raw = [
      '[Slack] Slack app token already in use (PID 82973). Stop the other gateway first.',
      'WARNING gateway.run: ✗ slack failed to connect',
    ].join('\n');
    const conflict = parseSlackGatewayConflict(raw);
    expect(conflict.hasConflict).toBe(true);
    expect(conflict.pid).toBe(82973);
  });

  it('returns hasConflict=false when no conflict is present', () => {
    const conflict = parseSlackGatewayConflict('Gateway started cleanly\nWhatsApp adapter ready');
    expect(conflict.hasConflict).toBe(false);
    expect(conflict.pid).toBeUndefined();
  });
});

describe('parseGatewayStartupRecoverySignals', () => {
  it('flags both Slack conflict and missing WhatsApp runtime', () => {
    const raw = [
      'WARNING gateway.run: WhatsApp: Node.js not installed or bridge not configured',
      'ERROR gateway.platforms.base: [Slack] Slack app token already in use (PID 12345). Stop the other gateway first.',
      'WARNING gateway.run: No adapter available for whatsapp',
    ].join('\n');
    const signals = parseGatewayStartupRecoverySignals(raw);
    expect(signals.slackConflict.hasConflict).toBe(true);
    expect(signals.slackConflict.pid).toBe(12345);
    expect(signals.whatsappRuntimeMissing).toBe(true);
    expect(signals.whatsappRuntimeSnippet).toContain('Node.js not installed');
  });
});
