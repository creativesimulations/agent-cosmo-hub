// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { describe, it, expect } from 'vitest';
import {
  buildSupportBundle,
  formatCommandEntry,
  formatCommandFailures,
} from './diagnosticsExport';
import type { DiagEntry } from './diagnostics';

const failEntry: DiagEntry = {
  id: '1',
  timestamp: 1_700_000_000_000,
  label: 'test',
  command: 'hermes doctor',
  phase: 'exec',
  status: 'error',
  exitCode: 1,
  success: false,
  stdout: '',
  stderr: 'something broke',
  durationMs: 100,
};

describe('formatCommandEntry', () => {
  it('includes stderr for failures', () => {
    const text = formatCommandEntry(failEntry);
    expect(text).toContain('something broke');
    expect(text).toContain('hermes doctor');
  });
});

describe('formatCommandFailures', () => {
  it('filters to unsuccessful entries only', () => {
    const ok: DiagEntry = { ...failEntry, id: '2', success: true, stderr: '' };
    const text = formatCommandFailures([ok, failEntry]);
    expect(text).toContain('something broke');
    expect(text.split('hermes doctor').length).toBe(2);
  });
});

describe('buildSupportBundle', () => {
  it('includes all sections', () => {
    const bundle = buildSupportBundle({
      healthLines: ['connected=true'],
      commandFailures: [failEntry],
      agentActivity: [],
      hermesLogTail: 'log line',
    });
    expect(bundle).toContain('=== Ronbot Diagnostics ===');
    expect(bundle).toContain('=== Health ===');
    expect(bundle).toContain('connected=true');
    expect(bundle).toContain('=== Recent command failures ===');
    expect(bundle).toContain('something broke');
    expect(bundle).toContain('=== Hermes agent.log');
    expect(bundle).toContain('log line');
  });
});
