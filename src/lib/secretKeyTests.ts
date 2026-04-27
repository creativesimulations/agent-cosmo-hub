export interface SecretKeyTestResult {
  ok: boolean;
  message: string;
}

const withTimeout = async (input: RequestInfo | URL, init: RequestInit, timeoutMs = 12000) => {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    window.clearTimeout(timer);
  }
};

const fmtErr = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const supportsLiveKeyTest = (envVar: string): boolean =>
  [
    "OPENROUTER_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "TAVILY_API_KEY",
  ].includes(envVar);

export const testKeyNow = async (envVar: string, key: string): Promise<SecretKeyTestResult> => {
  const token = key.trim();
  if (!token) return { ok: false, message: "Paste a key first, then test it." };
  try {
    if (envVar === "OPENROUTER_API_KEY") {
      const r = await withTimeout("https://openrouter.ai/api/v1/models", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      return r.ok
        ? { ok: true, message: "OpenRouter key is valid." }
        : { ok: false, message: `OpenRouter rejected this key (HTTP ${r.status}).` };
    }
    if (envVar === "OPENAI_API_KEY") {
      const r = await withTimeout("https://api.openai.com/v1/models", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      return r.ok
        ? { ok: true, message: "OpenAI key is valid." }
        : { ok: false, message: `OpenAI rejected this key (HTTP ${r.status}).` };
    }
    if (envVar === "ANTHROPIC_API_KEY") {
      const r = await withTimeout("https://api.anthropic.com/v1/models", {
        method: "GET",
        headers: { "x-api-key": token, "anthropic-version": "2023-06-01" },
      });
      return r.ok
        ? { ok: true, message: "Anthropic key is valid." }
        : { ok: false, message: `Anthropic rejected this key (HTTP ${r.status}).` };
    }
    if (envVar === "GOOGLE_API_KEY" || envVar === "GEMINI_API_KEY") {
      const r = await withTimeout(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(token)}`, {
        method: "GET",
      });
      return r.ok
        ? { ok: true, message: "Google Gemini key is valid." }
        : { ok: false, message: `Google rejected this key (HTTP ${r.status}).` };
    }
    if (envVar === "TAVILY_API_KEY") {
      const r = await withTimeout("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: token, query: "hello", max_results: 1 }),
      });
      return r.ok
        ? { ok: true, message: "Tavily key is valid." }
        : { ok: false, message: `Tavily rejected this key (HTTP ${r.status}).` };
    }
    return { ok: false, message: "This key type does not support live testing yet." };
  } catch (e) {
    return { ok: false, message: `Could not complete test: ${fmtErr(e)}` };
  }
};

