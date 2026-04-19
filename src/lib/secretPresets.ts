/**
 * Curated catalog of well-known secrets. Each preset gives us:
 *   - a stable canonical env-var name (what downstream code/agents look for)
 *   - a value prefix (used to auto-detect the service from a pasted value)
 *   - a friendly label, hint, and where-to-find URL
 *
 * Adding a new service here makes it appear in the Secrets combobox AND
 * enables paste-detection. Keep it short — anything not listed is still
 * fully supported via the free-form fallback.
 */
export interface SecretPreset {
  /** Canonical UPPER_SNAKE_CASE env var name. */
  envVar: string;
  /** Display name (service / what it's for). */
  label: string;
  /** One-liner shown in the picker. */
  hint: string;
  /** Value-prefix used for paste auto-detection. Empty = no detection. */
  prefix: string;
  /** Where to obtain a key (shown as a link). */
  docsUrl?: string;
  /** Loose category to group entries in the picker. */
  category: 'LLM provider' | 'Local runtime' | 'Messaging' | 'Search & web' | 'Voice & media' | 'Other';
}

export const SECRET_PRESETS: SecretPreset[] = [
  // ─── LLM providers ────────────────────────────────────────────────────
  { envVar: 'OPENROUTER_API_KEY', label: 'OpenRouter',     hint: '200+ models behind one key. Required for openrouter/* models.', prefix: 'sk-or-',  docsUrl: 'https://openrouter.ai/keys',                  category: 'LLM provider' },
  { envVar: 'OPENAI_API_KEY',     label: 'OpenAI',         hint: 'GPT-4o, GPT-5, o-series.',                                     prefix: 'sk-',     docsUrl: 'https://platform.openai.com/api-keys',        category: 'LLM provider' },
  { envVar: 'ANTHROPIC_API_KEY',  label: 'Anthropic',      hint: 'Claude Sonnet, Opus, Haiku.',                                  prefix: 'sk-ant-', docsUrl: 'https://console.anthropic.com/settings/keys', category: 'LLM provider' },
  { envVar: 'GEMINI_API_KEY',     label: 'Google Gemini',  hint: 'Gemini 1.5 / 2.0 family.',                                     prefix: 'AIza',    docsUrl: 'https://aistudio.google.com/apikey',          category: 'LLM provider' },
  { envVar: 'DEEPSEEK_API_KEY',   label: 'DeepSeek',       hint: 'DeepSeek V3 and R1.',                                          prefix: 'sk-',     docsUrl: 'https://platform.deepseek.com/api_keys',      category: 'LLM provider' },
  { envVar: 'GROQ_API_KEY',       label: 'Groq',           hint: 'Ultra-fast Llama / Mixtral inference.',                        prefix: 'gsk_',    docsUrl: 'https://console.groq.com/keys',               category: 'LLM provider' },
  { envVar: 'MISTRAL_API_KEY',    label: 'Mistral',        hint: 'Mistral Large, Codestral.',                                    prefix: '',        docsUrl: 'https://console.mistral.ai/api-keys/',        category: 'LLM provider' },

  // ─── Search & web tools ───────────────────────────────────────────────
  { envVar: 'EXA_API_KEY',        label: 'Exa Search',     hint: 'Neural web search for agents.',                                prefix: '',        docsUrl: 'https://dashboard.exa.ai/api-keys',           category: 'Search & web' },
  { envVar: 'FIRECRAWL_API_KEY',  label: 'Firecrawl',      hint: 'Convert web pages to LLM-ready data.',                         prefix: 'fc-',     docsUrl: 'https://www.firecrawl.dev/app/api-keys',      category: 'Search & web' },
  { envVar: 'BROWSERBASE_API_KEY',label: 'Browserbase',    hint: 'Cloud browsers for agentic workflows.',                        prefix: 'bb_',     docsUrl: 'https://www.browserbase.com/dashboard',       category: 'Search & web' },

  // ─── Voice & media ────────────────────────────────────────────────────
  { envVar: 'ELEVENLABS_API_KEY', label: 'ElevenLabs',     hint: 'Text-to-speech.',                                              prefix: '',        docsUrl: 'https://elevenlabs.io/app/settings/api-keys', category: 'Voice & media' },

  // ─── Messaging / bots ─────────────────────────────────────────────────
  { envVar: 'TELEGRAM_BOT_TOKEN', label: 'Telegram Bot',   hint: 'Token from @BotFather.',                                       prefix: '',        docsUrl: 'https://core.telegram.org/bots#how-do-i-create-a-bot', category: 'Messaging' },
  { envVar: 'DISCORD_BOT_TOKEN',  label: 'Discord Bot',    hint: 'Token from the Developer Portal.',                             prefix: '',        docsUrl: 'https://discord.com/developers/applications', category: 'Messaging' },
  { envVar: 'SLACK_BOT_TOKEN',    label: 'Slack Bot',      hint: 'xoxb-… token from a Slack app.',                               prefix: 'xoxb-',   docsUrl: 'https://api.slack.com/apps',                  category: 'Messaging' },
];

/** Map env var → preset, for quick lookup when rendering existing secrets. */
const PRESET_BY_ENV: Map<string, SecretPreset> = new Map(
  SECRET_PRESETS.map((p) => [p.envVar, p]),
);

export const findPresetByEnvVar = (envVar: string): SecretPreset | null =>
  PRESET_BY_ENV.get(envVar.toUpperCase()) ?? null;

/** Detect a preset from a pasted value (most-specific prefix wins). */
export const detectPresetFromValue = (value: string): SecretPreset | null => {
  const v = value.trim();
  if (!v) return null;
  // Sort by descending prefix length so `sk-ant-` wins over `sk-`.
  const candidates = SECRET_PRESETS
    .filter((p) => p.prefix && v.startsWith(p.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  return candidates[0] ?? null;
};

// Valid POSIX env var name: starts with letter/underscore, then letters/digits/underscores.
const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

/** Returns true if `name` is a syntactically valid env var (post-normalize). */
export const isValidEnvVarName = (name: string): boolean => ENV_NAME_RE.test(name);

/**
 * Coerce arbitrary user input into a valid env var name:
 *   - uppercase
 *   - replace hyphens, spaces, dots with underscores
 *   - strip anything else
 *   - prepend `_` if the result starts with a digit
 * This is what fixed the `OPENROUTER-API-KEY` regression — bash treats
 * hyphens as command separators and tries to execute the whole line.
 */
export const normalizeEnvVarName = (raw: string): string => {
  let n = raw.toUpperCase().replace(/[\s\-.]+/g, '_').replace(/[^A-Z0-9_]/g, '');
  if (/^[0-9]/.test(n)) n = `_${n}`;
  return n;
};
