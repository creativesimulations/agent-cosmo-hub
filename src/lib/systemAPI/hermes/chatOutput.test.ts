import { describe, expect, it } from 'vitest';
import {
  classifyChatError,
  extractSessionId,
  isBannerLine,
  isEchoLine,
  stripAnsi,
} from './chatOutput';

describe('chatOutput helpers', () => {
  it('strips ANSI escapes', () => {
    expect(stripAnsi('\u001b[31mhello\u001b[0m')).toBe('hello');
  });

  it('detects banner/noise lines', () => {
    expect(isBannerLine('Initializing agent...')).toBe(true);
    expect(isBannerLine('hermes --resume 2026_abc')).toBe(true);
    expect(isBannerLine('Actual assistant response line')).toBe(false);
  });

  it('detects prompt echo lines', () => {
    const prompt = 'Please summarize the latest logs and explain root cause';
    expect(isEchoLine('summarize the latest logs', prompt)).toBe(true);
    expect(isEchoLine('totally unrelated text', prompt)).toBe(false);
  });

  it('extracts session id from stdout', () => {
    const out = 'Resume this session with:\n  hermes --resume 20260420_064718_7199c1';
    expect(extractSessionId(out, undefined, false)).toBe('20260420_064718_7199c1');
    expect(extractSessionId('', 'old-id', true)).toBeNull();
    expect(extractSessionId('', 'old-id', false)).toBe('old-id');
  });

  it('classifies chat errors', () => {
    expect(classifyChatError('missing api key for provider')).toBe('missingKey');
    expect(classifyChatError('No inference provider configured')).toBe('noProvider');
    expect(classifyChatError('normal reply')).toBe('other');
  });
});
