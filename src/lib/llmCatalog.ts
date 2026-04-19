/**
 * Catalog of LLM providers and **agentic** models that work with the agent.
 *
 * IMPORTANT: We deliberately exclude non-agentic models (e.g. Nous Hermes 3/4
 * llama variants) because they lack tool-calling capabilities and break the
 * agent's workflows. Only models with reliable tool-use should be listed here.
 *
 * The OpenRouter "auto" router (openrouter/auto) is set as the overall default —
 * it analyses each prompt and picks the best agentic model automatically.
 * See https://openrouter.ai/docs/guides/routing/routers/auto-router
 */

export interface LLMProvider {
  id: string;
  label: string;
  /** Env var holding the API key. Empty string for providers that need none (e.g. local). */
  envVar: string;
  prefix: string;
  hint: string;
  defaultModel: string;
  /** True for providers that don't need an API key (local runtimes). */
  local?: boolean;
  /** True when users typically need to type a custom model id (local runtimes, OpenRouter long tail). */
  allowCustomModel?: boolean;
}

export interface LLMModel {
  id: string;
  label: string;
}

export const LLM_PROVIDERS: LLMProvider[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    envVar: "OPENROUTER_API_KEY",
    prefix: "sk-or-",
    hint: "200+ agentic models via a single API. The Auto Router picks the best one for each prompt.",
    defaultModel: "openrouter/auto",
    allowCustomModel: true,
  },
  {
    id: "openai",
    label: "OpenAI",
    envVar: "OPENAI_API_KEY",
    prefix: "sk-",
    hint: "GPT-4o, GPT-5 and o-series. Get a key at platform.openai.com",
    defaultModel: "openai/gpt-4o",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    envVar: "ANTHROPIC_API_KEY",
    prefix: "sk-ant-",
    hint: "Claude Sonnet & Opus. Get a key at console.anthropic.com",
    defaultModel: "anthropic/claude-3.5-sonnet",
  },
  {
    id: "google",
    label: "Google Gemini",
    envVar: "GEMINI_API_KEY",
    prefix: "",
    hint: "Gemini 1.5/2.0 models. Get a key at aistudio.google.com",
    defaultModel: "google/gemini-1.5-pro",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    envVar: "DEEPSEEK_API_KEY",
    prefix: "",
    hint: "DeepSeek V3/R1 — strong agentic reasoning. Get a key at platform.deepseek.com",
    defaultModel: "deepseek/deepseek-chat",
  },
  // Local runtimes (Ollama, LM Studio, llama.cpp, vLLM, …) are NOT listed
  // here — they're detected at runtime by src/lib/localModels.ts and only
  // shown in the LLM tab when actually running on the user's machine.


/**
 * Agentic-only model lists per provider. Do NOT add Hermes 3/4 llama models —
 * they are not agentic and the CLI itself warns against using them.
 *
 * For local providers we only list a handful of well-known agentic-friendly
 * models — users are expected to type their own custom model id.
 */
export const MODEL_OPTIONS: Record<string, LLMModel[]> = {
  openrouter: [
    { id: "openrouter/auto", label: "Auto Router — pick the best model per prompt (recommended)" },
    { id: "openrouter/anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
    { id: "openrouter/anthropic/claude-3-opus", label: "Claude 3 Opus" },
    { id: "openrouter/openai/gpt-4o", label: "GPT-4o" },
    { id: "openrouter/openai/gpt-4o-mini", label: "GPT-4o Mini" },
    { id: "openrouter/google/gemini-1.5-pro", label: "Gemini 1.5 Pro" },
    { id: "openrouter/deepseek/deepseek-chat", label: "DeepSeek V3" },
  ],
  openai: [
    { id: "openai/gpt-4o", label: "GPT-4o (recommended)" },
    { id: "openai/gpt-4o-mini", label: "GPT-4o Mini" },
    { id: "openai/o1", label: "o1" },
    { id: "openai/o1-mini", label: "o1 Mini" },
  ],
  anthropic: [
    { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet (recommended)" },
    { id: "anthropic/claude-3-opus", label: "Claude 3 Opus" },
    { id: "anthropic/claude-3-haiku", label: "Claude 3 Haiku" },
  ],
  google: [
    { id: "google/gemini-1.5-pro", label: "Gemini 1.5 Pro (recommended)" },
    { id: "google/gemini-1.5-flash", label: "Gemini 1.5 Flash" },
    { id: "google/gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  ],
  deepseek: [
    { id: "deepseek/deepseek-chat", label: "DeepSeek V3 (recommended)" },
    { id: "deepseek/deepseek-reasoner", label: "DeepSeek R1" },
  ],
  ollama: [
    { id: "ollama/llama3.1:8b", label: "Llama 3.1 8B (recommended, agentic)" },
    { id: "ollama/llama3.1:70b", label: "Llama 3.1 70B" },
    { id: "ollama/qwen2.5:7b", label: "Qwen 2.5 7B" },
    { id: "ollama/qwen2.5:32b", label: "Qwen 2.5 32B" },
    { id: "ollama/mistral-nemo", label: "Mistral Nemo" },
  ],
  lmstudio: [
    { id: "lmstudio/llama-3.1-8b-instruct", label: "Llama 3.1 8B Instruct" },
    { id: "lmstudio/qwen2.5-7b-instruct", label: "Qwen 2.5 7B Instruct" },
    { id: "lmstudio/mistral-nemo-instruct", label: "Mistral Nemo Instruct" },
  ],
};

export const findProviderForModel = (model: string | null | undefined): LLMProvider | null => {
  if (!model) return null;
  const id = model.split("/")[0];
  return LLM_PROVIDERS.find((p) => p.id === id) ?? null;
};

/** The overall app-wide default model. */
export const DEFAULT_MODEL = "openrouter/auto";
