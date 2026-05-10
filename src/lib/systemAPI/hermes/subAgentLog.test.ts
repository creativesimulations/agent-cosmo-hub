import { describe, expect, it } from 'vitest';
import { parseSubAgentLog } from './subAgentLog';

describe('parseSubAgentLog', () => {
  it('tracks active, complete, and failed entries', () => {
    const lines = [
      '2026-05-08 10:00:00 delegate_task goal="create report"',
      '2026-05-08 10:00:01 subagent.start goal="create report"',
      '2026-05-08 10:00:05 subagent.progress tool=read_file',
      '2026-05-08 10:00:10 subagent.complete summary="done"',
      '2026-05-08 10:01:00 subagent.start goal="cleanup"',
      '2026-05-08 10:01:10 subagent.failed reason="permission denied"',
    ];
    const now = Date.parse('2026-05-08T10:01:20Z');
    const out = parseSubAgentLog(lines, now);

    expect(out.recent.length).toBe(1);
    expect(out.recent[0].goal).toContain('create report');
    expect(out.failed.length).toBe(1);
    expect(out.failed[0].reason).toContain('permission denied');
    expect(out.active.length).toBe(0);
  });

  it('drops stale pending work', () => {
    const lines = [
      '2026-05-08 08:00:00 subagent.start goal="old task"',
    ];
    const now = Date.parse('2026-05-08T10:30:00Z');
    const out = parseSubAgentLog(lines, now);
    expect(out.active.length).toBe(0);
  });
});
