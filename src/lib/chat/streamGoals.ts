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
