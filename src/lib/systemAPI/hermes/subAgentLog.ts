type Pending = { id: string; goal: string; startedAt: number; lastActivity?: number; lastEvent?: string };
type Done = { id: string; goal: string; startedAt: number; completedAt: number; summary?: string };
type Failed = { id: string; goal: string; startedAt: number; failedAt: number; reason?: string };

type ParsedSubAgentLog = {
  active: Array<{ id: string; goal: string; startedAt: string; lastActivity?: string; lastEvent?: string }>;
  recent: Array<{ id: string; goal: string; startedAt: string; completedAt: string; durationMs: number; summary?: string }>;
  failed: Array<{ id: string; goal: string; startedAt: string; failedAt: string; reason?: string }>;
};

const tsRe = /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})(?:[,.](\d{1,3}))?/;

const parseTs = (line: string): number | null => {
  const m = line.match(tsRe);
  if (!m) return null;
  const ms = m[2] ? parseInt(m[2].padEnd(3, '0'), 10) : 0;
  const t = Date.parse(m[1].replace(' ', 'T'));
  return Number.isNaN(t) ? null : t + ms;
};

const goalFromLine = (line: string): string | null => {
  const patterns = [
    /goal\s*[:=]\s*"([^"]{1,400})"/,
    /goal\s*[:=]\s*'([^']{1,400})'/,
    /"task"\s*:\s*"([^"]{1,400})"/,
    /preview\s*=\s*"([^"]{1,400})"/,
    /task\s*[:=]\s*"([^"]{1,400})"/,
    /spawned\s+(?:sub[-_ ]?agent|child\s+agent)\s+(?:for\s+)?["']?([^"'\n]{4,200})/i,
  ];
  for (const re of patterns) {
    const m = line.match(re);
    if (m) return m[1];
  }
  return null;
};

const isDelegate = (l: string) => /\bdelegate_task\b|\bdelegate\(.*task/i.test(l);
const isStart = (l: string) =>
  /\bsub[-_]?agent\.start\b/i.test(l) ||
  /\bworker\.start\b/i.test(l) ||
  /\bchild[-_ ]?agent\b.*\b(started|spawn(ed)?|launch(ed)?)\b/i.test(l) ||
  /\bspawn(ed)?\s+(sub[-_ ]?agent|child\s+agent|worker)\b/i.test(l) ||
  /\b(task|delegation)\b.*\bstarted\b/i.test(l);
const isComplete = (l: string) =>
  /\bsub[-_]?agent\.complete\b/i.test(l) ||
  /\bworker\.complete\b/i.test(l) ||
  /\bchild[-_ ]?agent\b.*\b(complete|finish(ed)?|done)\b/i.test(l) ||
  /\b(task|delegation)\b.*\bcompleted\b/i.test(l);
const isFailed = (l: string) =>
  /\bsub[-_]?agent\.(failed|error|denied)\b/i.test(l) ||
  /\bworker\.failed\b/i.test(l) ||
  /\b(task|delegation)\b.*\b(failed|denied|errored)\b/i.test(l) ||
  /\bchild[-_ ]?agent\b.*\b(failed|denied|crashed)\b/i.test(l);
const isHeartbeat = (l: string) =>
  /\bsub[-_]?agent\.(thinking|tool|progress)\b/i.test(l) ||
  /\bworker\.(thinking|tool|progress)\b/i.test(l);

const reasonFromLine = (line: string): string | undefined => {
  const m =
    line.match(/(?:reason|error|denied)\s*[:=]\s*"([^"]{1,300})"/i) ||
    line.match(/(?:reason|error|denied)\s*[:=]\s*'([^']{1,300})'/i) ||
    line.match(/permission denied[:\s]*([^\n]{1,200})/i);
  return m ? m[1] : undefined;
};

export const parseSubAgentLog = (lines: string[], now = Date.now()): ParsedSubAgentLog => {
  const pending: Pending[] = [];
  const completed: Done[] = [];
  const failed: Failed[] = [];
  let lastDelegateGoal: string | null = null;

  for (const line of lines) {
    if (!line) continue;
    const ts = parseTs(line);

    if (isDelegate(line)) {
      const g = goalFromLine(line);
      if (g) lastDelegateGoal = g;
    }

    if (isStart(line) && ts !== null) {
      const goal = goalFromLine(line) || lastDelegateGoal || '(no goal recorded)';
      const id = `${ts}-${goal.slice(0, 40)}`;
      pending.push({ id, goal, startedAt: ts, lastActivity: ts, lastEvent: 'started' });
      lastDelegateGoal = null;
      continue;
    }

    if (isComplete(line) && ts !== null && pending.length > 0) {
      const open = pending.shift()!;
      const summary = goalFromLine(line) || undefined;
      completed.push({
        id: open.id,
        goal: open.goal,
        startedAt: open.startedAt,
        completedAt: ts,
        summary,
      });
      continue;
    }

    if (isFailed(line) && ts !== null) {
      const reason = reasonFromLine(line);
      const open = pending.shift();
      if (open) {
        failed.push({
          id: open.id,
          goal: open.goal,
          startedAt: open.startedAt,
          failedAt: ts,
          reason,
        });
      } else {
        const goal = goalFromLine(line) || lastDelegateGoal || '(no goal recorded)';
        failed.push({
          id: `${ts}-fail-${goal.slice(0, 40)}`,
          goal,
          startedAt: ts,
          failedAt: ts,
          reason,
        });
        lastDelegateGoal = null;
      }
      continue;
    }

    if (isHeartbeat(line) && ts !== null && pending.length > 0) {
      const last = pending[pending.length - 1];
      last.lastActivity = ts;
      if (/thinking/i.test(line)) last.lastEvent = 'thinking';
      else if (/tool/i.test(line)) last.lastEvent = 'using a tool';
      else last.lastEvent = 'working';
    }
  }

  const STALE_AFTER_MS = 60 * 60 * 1000;
  const stillActive = pending.filter(
    (p) => now - (p.lastActivity ?? p.startedAt) < STALE_AFTER_MS,
  );
  const toIso = (t: number) => new Date(t).toISOString();

  return {
    active: stillActive.map((p) => ({
      id: p.id,
      goal: p.goal,
      startedAt: toIso(p.startedAt),
      lastActivity: p.lastActivity ? toIso(p.lastActivity) : undefined,
      lastEvent: p.lastEvent,
    })),
    recent: completed
      .sort((a, b) => b.completedAt - a.completedAt)
      .slice(0, 25)
      .map((c) => ({
        id: c.id,
        goal: c.goal,
        startedAt: toIso(c.startedAt),
        completedAt: toIso(c.completedAt),
        durationMs: c.completedAt - c.startedAt,
        summary: c.summary,
      })),
    failed: failed
      .sort((a, b) => b.failedAt - a.failedAt)
      .slice(0, 25)
      .map((f) => ({
        id: f.id,
        goal: f.goal,
        startedAt: toIso(f.startedAt),
        failedAt: toIso(f.failedAt),
        reason: f.reason,
      })),
  };
};
