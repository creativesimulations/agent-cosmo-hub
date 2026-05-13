/**
 * Parse streamed Hermes output for delegation / sub-agent goal text.
 * Used by live sub-agent tracking in ChatContext.
 */
export function extractDelegationGoal(buf: string): string {
  const patterns: RegExp[] = [
    /["']?(?:task|goal|prompt|instruction|description|objective)["']?\s*[:=]\s*["']([^"']{3,400})["']/i,
    /delegate_task\s*\(\s*["']([^"']{3,400})["']/i,
    /delegate_task[\s\S]{0,600}?["']?(?:task|goal|prompt|instruction|description)["']?\s*[:=]\s*["']([^"']{3,400})["']/i,
    /spawn(?:ed|ing)?\s+(?:a\s+)?(?:sub[-_ ]?agent|child\s+agent|worker)\s*(?:to|:)\s*([^\n"']{6,300})/i,
    /delegat(?:ing|ion)\s*[-:]\s*([^\n"']{6,300})/i,
    /(?:task|goal|prompt)\s*[:=]\s*([^,\n}]{6,300})/i,
  ];
  const REJECT =
    /^(delegate_task|sub[-_ ]?agent(?:\.start)?|spawn|task|goal|prompt)\b[\s│|│┃┆┊╎╏┝┥┯┷┿┃─━│┃┄┅┈┉]*$/i;
  for (const re of patterns) {
    const m = buf.match(re);
    if (m) {
      const cleaned = m[1]
        .trim()
        .replace(/[",}\s│|┃┄┅┆┇┈┉┊┋╎╏─━]+$/u, "")
        .replace(/^[\s│|┃─━]+/u, "")
        .trim();
      if (cleaned.length >= 6 && !REJECT.test(cleaned)) return cleaned;
    }
  }
  return "(no goal captured)";
}

const quoted = (key: string) =>
  new RegExp(`["']?${key}["']?\\s*[:=]\\s*["']([^"']{1,200})["']`, "i");

/**
 * Best-effort parse of optional delegate_task / sub-agent fields from the
 * trailing stream buffer (Hermes may emit JSON-ish argument blocks).
 */
export function extractDelegateMetadata(buf: string): {
  displayName?: string;
  model?: string;
} {
  const slice = buf.slice(-6000);
  const out: { displayName?: string; model?: string } = {};
  const nameKeys = ["display_name", "displayName", "agent_name", "name", "title", "label"];
  for (const k of nameKeys) {
    const m = slice.match(quoted(k));
    if (m?.[1]) {
      const v = m[1].trim();
      if (v.length >= 2 && v.length <= 120) {
        out.displayName = v;
        break;
      }
    }
  }
  const modelM = slice.match(quoted("model")) || slice.match(/\bmodel\s*[:=]\s*([a-z0-9][a-z0-9._\-:/]{1,80})/i);
  if (modelM?.[1]) {
    const v = modelM[1].trim();
    if (v.length >= 2 && v.length <= 120) out.model = v;
  }
  return out;
}
