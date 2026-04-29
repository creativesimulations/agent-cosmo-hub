const KEY_VALUE_PATTERNS: RegExp[] = [
  /\b(api[_-]?key|token|secret|password|passwd|authorization|auth)\b\s*[:=]\s*(['"]?)[^\s'";]+(['"]?)/gi,
  /\b(OPENAI|OPENROUTER|ANTHROPIC|GOOGLE|GEMINI|GROQ|MISTRAL|DEEPSEEK|NOUS|COHERE|PERPLEXITY|HUGGINGFACE|REPLICATE|EXA|FIRECRAWL|ELEVENLABS|BROWSERBASE|TELEGRAM|DISCORD|SLACK|WHATSAPP)_[A-Z0-9_]*\s*=\s*(['"]?)[^\s'";]+(['"]?)/gi,
];

const BEARER_PATTERN = /\b(Bearer)\s+[A-Za-z0-9._\-+/=]+/gi;
const URL_CREDENTIAL_PATTERN = /(https?:\/\/[^/\s:@]+:)([^@\s/]+)(@)/gi;

const maskValue = (value: string): string => {
  if (!value) return value;
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
};

export const redactLogText = (input: string): string => {
  if (!input) return "";
  let out = input;

  for (const pattern of KEY_VALUE_PATTERNS) {
    out = out.replace(pattern, (full, key, q1, q2) => {
      const valueMatch = full.match(/[:=]\s*(['"]?)([^\s'";]+)\1/);
      const raw = valueMatch?.[2] ?? "";
      const masked = maskValue(raw);
      return `${String(key)}=${q1 || ""}${masked}${q2 || ""}`;
    });
  }

  out = out.replace(BEARER_PATTERN, (_m, prefix) => `${prefix} ****`);
  out = out.replace(URL_CREDENTIAL_PATTERN, (_m, p1, p2, p3) => `${p1}${maskValue(p2)}${p3}`);
  return out;
};

