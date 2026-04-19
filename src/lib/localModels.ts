/**
 * Detect locally-running LLM runtimes (Ollama, LM Studio, llama.cpp server,
 * vLLM, etc.) by probing their default OpenAI-compatible endpoints and
 * return the *actual* models the user has installed/loaded.
 *
 * Runs in the renderer — uses plain `fetch` against localhost. Each probe is
 * wrapped in a short timeout so a missing runtime never blocks the UI.
 */

import type { LLMModel } from "./llmCatalog";

export interface LocalRuntime {
  /** Provider id used as a model prefix (e.g. "ollama" → ollama/llama3.1:8b). */
  id: string;
  label: string;
  /** Where we found it (host:port). */
  endpoint: string;
  /** Actual installed models, ready to drop into MODEL_OPTIONS. */
  models: LLMModel[];
}

const TIMEOUT_MS = 1500;

const fetchWithTimeout = async (url: string, init?: RequestInit) => {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
};

/**
 * Models with these suffixes are NOT actually local — Ollama proxies them
 * to the provider's cloud endpoint and they require an API key. Hide them
 * from the "local runtimes" list so users don't pick them by mistake.
 *
 *   minimax-m2.5:cloud      → MiniMax hosted
 *   gpt-oss:cloud           → OpenAI-style routed
 *   anything ending :cloud  → cloud-routed
 */
const isCloudRoutedModelName = (name: string): boolean => {
  const lower = name.toLowerCase();
  return /:cloud(\b|$)/.test(lower) || /:hosted(\b|$)/.test(lower) || /:remote(\b|$)/.test(lower);
};

/** Ollama exposes GET /api/tags → { models: [{ name, ... }] } */
const probeOllama = async (host: string): Promise<LocalRuntime | null> => {
  try {
    const res = await fetchWithTimeout(`${host}/api/tags`);
    if (!res.ok) return null;
    const data = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
    const names = (data.models ?? [])
      .map((m) => m.name || m.model)
      .filter((n): n is string => typeof n === "string" && n.length > 0)
      .filter((n) => !isCloudRoutedModelName(n));
    if (names.length === 0) {
      // Server is up but no models pulled — still report so user sees the hint.
      return { id: "ollama", label: "Ollama (local)", endpoint: host, models: [] };
    }
    return {
      id: "ollama",
      label: "Ollama (local)",
      endpoint: host,
      models: names.map((n) => ({ id: `ollama/${n}`, label: n })),
    };
  } catch {
    return null;
  }
};

/** LM Studio / llama.cpp / vLLM all expose OpenAI-compatible GET /v1/models. */
const probeOpenAICompat = async (
  id: string,
  label: string,
  host: string,
): Promise<LocalRuntime | null> => {
  try {
    const res = await fetchWithTimeout(`${host}/v1/models`);
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    const ids = (data.data ?? [])
      .map((m) => m.id)
      .filter((i): i is string => typeof i === "string" && i.length > 0);
    if (ids.length === 0) {
      return { id, label, endpoint: host, models: [] };
    }
    return {
      id,
      label,
      endpoint: host,
      models: ids.map((i) => ({ id: `${id}/${i}`, label: i })),
    };
  } catch {
    return null;
  }
};

/**
 * Probe all known local runtimes in parallel. Returns only the ones that
 * responded successfully.
 */
export const detectLocalRuntimes = async (): Promise<LocalRuntime[]> => {
  const probes = await Promise.all([
    probeOllama("http://localhost:11434"),
    probeOpenAICompat("lmstudio", "LM Studio (local)", "http://localhost:1234"),
    probeOpenAICompat("llamacpp", "llama.cpp (local)", "http://localhost:8080"),
    probeOpenAICompat("vllm", "vLLM (local)", "http://localhost:8000"),
  ]);
  return probes.filter((r): r is LocalRuntime => r !== null);
};

/** Built-in (hosted) provider ids — anything not in here is treated as local. */
export const HOSTED_PROVIDER_IDS = new Set([
  "openrouter",
  "openai",
  "anthropic",
  "google",
  "deepseek",
]);
