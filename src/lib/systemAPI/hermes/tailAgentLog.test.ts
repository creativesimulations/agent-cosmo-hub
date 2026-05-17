// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./shell', () => ({
  runHermesShell: vi.fn(),
}));

import { runHermesShell } from './shell';
import { tailAgentLog } from './tailAgentLog';

describe('tailAgentLog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns loggingDisabled when exit code 3', async () => {
    vi.mocked(runHermesShell).mockResolvedValue({
      success: false,
      code: 3,
      stdout: '',
      stderr: '',
    });
    const r = await tailAgentLog({ lines: 100 });
    expect(r.loggingDisabled).toBe(true);
    expect(r.content).toBe('');
  });

  it('returns tail content on success', async () => {
    vi.mocked(runHermesShell).mockResolvedValue({
      success: true,
      code: 0,
      stdout: 'line one\nline two',
      stderr: '',
    });
    const r = await tailAgentLog();
    expect(r.success).toBe(true);
    expect(r.content).toBe('line one\nline two');
  });
});
