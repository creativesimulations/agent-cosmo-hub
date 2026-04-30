import { describe, expect, it } from 'vitest';
import { parseWhatsAppBridgeAudit } from './hermes';

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
      'FAIL:bridge-deps:Missing /home/kadosh/.hermes/hermes-agent/scripts/whatsapp-bridge/node_modules/@whiskeysockets/baileys — run npm install in the WhatsApp bridge folder',
      'FAIL:bridge-deps-loadable:Managed Node cannot require(\'@whiskeysockets/baileys\') from /home/kadosh/.hermes/hermes-agent/scripts/whatsapp-bridge — reinstall bridge dependencies',
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
    expect(report.failedChecks[0].detail).toContain('npm install');
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
