import { describe, expect, it } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WHATSAPP_ADAPTER_PATCH_PY,
  parseUnauthorizedWhatsAppSenders,
} from './hermes';
import { isValidWhatsAppAllowEntry } from '@/lib/channels';

const hasPython3 = (() => {
  try {
    execSync('python3 --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('WHATSAPP_ADAPTER_PATCH_PY', () => {
  it.skipIf(!hasPython3)('compiles cleanly under Python 3', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ronbot-wa-patch-'));
    const py = join(dir, 'patcher.py');
    writeFileSync(py, WHATSAPP_ADAPTER_PATCH_PY, 'utf8');
    const r = spawnSync(
      'python3',
      ['-c', `import sys; src=open(sys.argv[1]).read(); compile(src, sys.argv[1], 'exec')`, py],
      { encoding: 'utf8' },
    );
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
  });

  it.skipIf(!hasPython3)('rewrites a fixture adapter so the bridge launches via _ronbot_node_bin()', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ronbot-wa-fixture-'));
    const py = join(dir, 'patcher.py');
    writeFileSync(py, WHATSAPP_ADAPTER_PATCH_PY, 'utf8');

    const adapter = join(dir, 'whatsapp.py');
    writeFileSync(
      adapter,
      [
        '"""Hermes WhatsApp adapter (fixture)."""',
        'import subprocess',
        '',
        'def preflight():',
        '    return subprocess.run(["node", "--version"], capture_output=True)',
        '',
        'def launch(bridge_path):',
        '    return subprocess.Popen(["node", bridge_path, "--mode=self-chat"])',
        '',
      ].join('\n'),
      'utf8',
    );

    const r = spawnSync('python3', [py, adapter], { encoding: 'utf8' });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);

    const out = readFileSync(adapter, 'utf8');
    expect(out).toContain('RONBOT_NODE_BIN_PATCH_V5');
    expect(out).toContain('def _ronbot_node_bin():');
    // Both literal "node" launch sites must be rewritten.
    expect(out).toContain('subprocess.run([_ronbot_node_bin(), "--version"');
    expect(out).toContain('subprocess.Popen([_ronbot_node_bin(), bridge_path');
    // No bare ["node", ...] launch literals must remain.
    expect(out).not.toMatch(/\[\s*"node"\s*,/);
  });

  it.skipIf(!hasPython3)('is idempotent — running twice does not duplicate the helper', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ronbot-wa-idem-'));
    const py = join(dir, 'patcher.py');
    writeFileSync(py, WHATSAPP_ADAPTER_PATCH_PY, 'utf8');
    const adapter = join(dir, 'whatsapp.py');
    writeFileSync(
      adapter,
      'import subprocess\nsubprocess.run(["node", "--version"])\n',
      'utf8',
    );
    spawnSync('python3', [py, adapter], { encoding: 'utf8' });
    spawnSync('python3', [py, adapter], { encoding: 'utf8' });
    const out = readFileSync(adapter, 'utf8');
    const helperOccurrences = (out.match(/def _ronbot_node_bin\(\):/g) || []).length;
    expect(helperOccurrences).toBe(1);
  });
});

describe('isValidWhatsAppAllowEntry', () => {
  it('accepts E.164 digit strings (no +)', () => {
    expect(isValidWhatsAppAllowEntry('15551234567')).toBe(true);
    expect(isValidWhatsAppAllowEntry('447700900123')).toBe(true);
  });

  it('accepts WhatsApp @lid JIDs', () => {
    expect(isValidWhatsAppAllowEntry('112966246649933@lid')).toBe(true);
  });

  it('accepts WhatsApp @s.whatsapp.net JIDs', () => {
    expect(isValidWhatsAppAllowEntry('15551234567@s.whatsapp.net')).toBe(true);
  });

  it('rejects empty, +-prefixed, alpha, or malformed entries', () => {
    expect(isValidWhatsAppAllowEntry('')).toBe(false);
    expect(isValidWhatsAppAllowEntry('+15551234567')).toBe(false);
    expect(isValidWhatsAppAllowEntry('foo@bar')).toBe(false);
    expect(isValidWhatsAppAllowEntry('abc@lid')).toBe(false);
    expect(isValidWhatsAppAllowEntry('15551234567@whatsapp.net')).toBe(false);
  });
});

describe('parseUnauthorizedWhatsAppSenders', () => {
  it('extracts unique JIDs from gateway log text', () => {
    const log = [
      '2026-04-30 04:11:00 WARN gateway.run: Unauthorized user: 112966246649933@lid',
      '2026-04-30 04:11:05 INFO gateway.run: heartbeat',
      '2026-04-30 04:11:10 WARN gateway.run: Unauthorized user: 112966246649933@lid',
      '2026-04-30 04:11:20 WARN gateway.run: Unauthorized user: 15551234567',
      '2026-04-30 04:11:25 WARN gateway.run: Unauthorized user: 447700900123@s.whatsapp.net',
    ].join('\n');
    const ids = parseUnauthorizedWhatsAppSenders(log);
    expect(ids).toEqual([
      '112966246649933@lid',
      '15551234567',
      '447700900123@s.whatsapp.net',
    ]);
  });

  it('returns [] for empty input', () => {
    expect(parseUnauthorizedWhatsAppSenders('')).toEqual([]);
  });
});
