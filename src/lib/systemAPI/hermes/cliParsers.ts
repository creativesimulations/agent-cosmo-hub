/** ANSI SGR stripper for CLI tables (avoids no-control-regex in source literals). */
const ANSI_SGR = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, "g");

function stripAnsi(text: string): string {
  return text.replace(ANSI_SGR, "");
}

/** `hermes cron list` parser. Tolerates header rows, ANSI, and reordered cols. */
export const parseCronListOutput = (
  text: string,
): Array<{
  id: string;
  description: string;
  schedule?: string;
  nextRun?: string;
  recurring?: boolean;
  enabled?: boolean;
}> => {
  const out: Array<{
    id: string;
    description: string;
    schedule?: string;
    nextRun?: string;
    recurring?: boolean;
    enabled?: boolean;
  }> = [];
  const lines = text.split("\n").map((l) => stripAnsi(l));
  let headerCols: string[] | null = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (/^\s*(no\s+(scheduled\s+)?(cron\s+)?jobs|nothing scheduled)/i.test(line)) {
      return [];
    }
    if (!headerCols && /\bid\b/i.test(line) && /\bschedule\b/i.test(line)) {
      headerCols = line.trim().split(/\s{2,}/).map((c) => c.toLowerCase());
      continue;
    }
    if (/^[-=─]{3,}/.test(line.trim())) continue;
    const parts = line.trim().split(/\s{2,}/);
    if (parts.length < 2) continue;
    let id = parts[0];
    let schedule: string | undefined;
    let nextRun: string | undefined;
    let description = "";
    if (headerCols && parts.length >= headerCols.length) {
      const map: Record<string, string> = {};
      headerCols.forEach((col, i) => {
        map[col] = parts[i] ?? "";
      });
      id = map["id"] || id;
      schedule = map["schedule"] || map["cron"] || undefined;
      nextRun = map["next run"] || map["next"] || map["next_run"] || undefined;
      description =
        map["prompt"] ||
        map["task"] ||
        map["description"] ||
        map["name"] ||
        parts[parts.length - 1];
    } else {
      schedule = parts[1];
      nextRun = parts.length >= 4 ? parts[2] : undefined;
      description = parts.slice(parts.length >= 4 ? 3 : 2).join(" ");
    }
    if (!id || /^id$/i.test(id)) continue;
    const recurring =
      !!schedule && /[\s*/]/.test(schedule) && !/^\d{4}-\d{2}-\d{2}/.test(schedule);
    out.push({
      id,
      description: (description || "(no description)").trim(),
      schedule: schedule?.trim(),
      nextRun: nextRun?.trim(),
      recurring,
    });
  }
  return out;
};

/** `hermes profile list` parser. Active profile usually marked with `*`. */
export const parseProfileListOutput = (
  text: string,
): Array<{ name: string; active?: boolean }> => {
  const out: Array<{ name: string; active?: boolean }> = [];
  const seen = new Set<string>();
  for (const raw of text.split("\n")) {
    const line = stripAnsi(raw).trim();
    if (!line) continue;
    if (/^(profiles?|name|---|===)/i.test(line)) continue;
    const m = line.match(/^(\*?)\s*([A-Za-z0-9_.-]+)\b/);
    if (!m) continue;
    const name = m[2];
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, active: !!m[1] || /\(active\)/i.test(line) });
  }
  return out;
};

/** `hermes plugins list` parser. */
export const parsePluginsListOutput = (
  text: string,
): Array<{ name: string; enabled?: boolean; description?: string }> => {
  const out: Array<{ name: string; enabled?: boolean; description?: string }> = [];
  for (const raw of text.split("\n")) {
    const line = stripAnsi(raw).trim();
    if (!line) continue;
    if (/^(plugins?|name|---|===)/i.test(line)) continue;
    if (/^no\s+plugins/i.test(line)) return [];
    const parts = line.split(/\s{2,}/);
    const name = parts[0]?.replace(/^[*•]\s*/, "");
    if (!name || !/^[A-Za-z0-9_.@/-]+$/.test(name)) continue;
    const rest = parts.slice(1).join(" ");
    let enabled: boolean | undefined;
    if (/\b(enabled|on)\b/i.test(rest)) enabled = true;
    else if (/\b(disabled|off)\b/i.test(rest)) enabled = false;
    out.push({ name, enabled, description: rest || undefined });
  }
  return out;
};

/** `hermes insights` text-output parser. Matches "Tokens in: 12,345" style. */
export const parseInsightsOutput = (
  text: string,
): {
  sessionsLast7d?: number;
  messagesLast7d?: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
} => {
  const stripped = stripAnsi(text);
  const num = (re: RegExp): number | undefined => {
    const m = stripped.match(re);
    if (!m) return undefined;
    const v = parseFloat(m[1].replace(/[, ]/g, ""));
    return Number.isFinite(v) ? v : undefined;
  };
  return {
    sessionsLast7d: num(/sessions[^\d-]*([\d,]+)/i),
    messagesLast7d: num(/messages[^\d-]*([\d,]+)/i),
    tokensIn: num(/(?:tokens?\s*(?:in|input)|input\s*tokens?)[^\d-]*([\d,]+)/i),
    tokensOut: num(/(?:tokens?\s*(?:out|output)|output\s*tokens?)[^\d-]*([\d,]+)/i),
    costUsd: num(/(?:cost|total\s*cost|spend)[^\d-]*\$?\s*([\d,.]+)/i),
  };
};
