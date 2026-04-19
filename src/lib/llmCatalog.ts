/**
 * Catalog of LLM providers and **agentic** models that work with the agent.
 *
 * IMPORTANT: We deliberately exclude non-agentic models (e.g. Nous Hermes 3/4
 * llama variants) because they lack tool-calling capabilities and break the
 * agent's workflows. Only models with reliable tool-use should be listed here.
 */

export interface LLMProvider {
  id: string;
  label: string;
  envVar: string;
  prefix: string;
  hint: string;
  defaultModel: string;
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
    hint: "200+ agentic models via a single API. Get a key at openrouter.ai",
    defaultModel: "openrouter/anthropic/claude-3.5-sonnet",
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
];

/**
 * Agentic-only model lists per provider. Do NOT add Hermes 3/4 llama models —
 * they are not agentic and the CLI itself warns against using them.
 */
export const MODEL_OPTIONS: Record<string, LLMModel[]> = {
  openrouter: [
    { id: "openrouter/anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet (recommended)" },
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
};

export const findProviderForModel = (model: string | null | undefined): LLMProvider | null => {
  if (!model) return null;
  const id = model.split("/")[0];
  return LLM_PROVIDERS.find((p) => p.id === id) ?? null;
};
