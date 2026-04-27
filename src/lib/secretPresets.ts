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
  // Canonical env-var names match the official Hermes docs:
  //   https://hermes-agent.nousresearch.com/docs/getting-started/quickstart/
  { envVar: 'NOUS_API_KEY',       label: 'Nous Portal',    hint: "First-party provider — Hermes' default.",                      prefix: '',        docsUrl: 'https://portal.nousresearch.com/',            category: 'LLM provider' },
  { envVar: 'OPENROUTER_API_KEY', label: 'OpenRouter',     hint: '200+ models behind one key. Required for openrouter/* models.', prefix: 'sk-or-',  docsUrl: 'https://openrouter.ai/keys',                  category: 'LLM provider' },
  { envVar: 'OPENAI_API_KEY',     label: 'OpenAI',         hint: 'GPT-4o, GPT-5, o-series.',                                     prefix: 'sk-',     docsUrl: 'https://platform.openai.com/api-keys',        category: 'LLM provider' },
  { envVar: 'ANTHROPIC_API_KEY',  label: 'Anthropic',      hint: 'Claude Sonnet, Opus, Haiku.',                                  prefix: 'sk-ant-', docsUrl: 'https://console.anthropic.com/settings/keys', category: 'LLM provider' },
  { envVar: 'GOOGLE_API_KEY',     label: 'Google Gemini',  hint: 'Gemini 1.5 / 2.0 family. (Canonical Hermes name.)',            prefix: 'AIza',    docsUrl: 'https://aistudio.google.com/apikey',          category: 'LLM provider' },
  { envVar: 'GEMINI_API_KEY',     label: 'Google Gemini (legacy alias)', hint: 'Auto-mirrored to GOOGLE_API_KEY for older builds.', prefix: 'AIza', docsUrl: 'https://aistudio.google.com/apikey',          category: 'LLM provider' },
  { envVar: 'DEEPSEEK_API_KEY',   label: 'DeepSeek',       hint: 'DeepSeek V3 and R1.',                                          prefix: 'sk-',     docsUrl: 'https://platform.deepseek.com/api_keys',      category: 'LLM provider' },
  { envVar: 'GROQ_API_KEY',       label: 'Groq',           hint: 'Ultra-fast Llama / Mixtral inference.',                        prefix: 'gsk_',    docsUrl: 'https://console.groq.com/keys',               category: 'LLM provider' },
  { envVar: 'MISTRAL_API_KEY',    label: 'Mistral',        hint: 'Mistral Large, Codestral.',                                    prefix: '',        docsUrl: 'https://console.mistral.ai/api-keys/',        category: 'LLM provider' },
  { envVar: 'HF_TOKEN',           label: 'Hugging Face',   hint: 'Hosted inference + private models. (Canonical Hermes name.)',  prefix: 'hf_',     docsUrl: 'https://huggingface.co/settings/tokens',      category: 'LLM provider' },
  { envVar: 'HUGGINGFACE_API_KEY',label: 'Hugging Face (legacy alias)', hint: 'Auto-mirrored to HF_TOKEN for older builds.',     prefix: 'hf_',     docsUrl: 'https://huggingface.co/settings/tokens',      category: 'LLM provider' },

  // ─── Provider overrides (self-hosted / proxied / custom endpoints) ────
  { envVar: 'HERMES_MODEL',         label: 'Hermes model override', hint: 'Overrides `model:` in config.yaml (e.g. openrouter/anthropic/claude-3.5-sonnet).', prefix: '', category: 'LLM provider' },
  { envVar: 'OPENAI_BASE_URL',      label: 'OpenAI base URL',      hint: 'Custom OpenAI-compatible endpoint (proxy / self-hosted).', prefix: 'http', category: 'LLM provider' },
  { envVar: 'ANTHROPIC_BASE_URL',   label: 'Anthropic base URL',   hint: 'Custom Anthropic-compatible endpoint.',                    prefix: 'http', category: 'LLM provider' },
  { envVar: 'OPENROUTER_BASE_URL',  label: 'OpenRouter base URL',  hint: 'Custom OpenRouter-compatible endpoint.',                   prefix: 'http', category: 'LLM provider' },

  // ─── Local LLM runtimes ───────────────────────────────────────────────
  { envVar: 'OLLAMA_HOST',         label: 'Ollama host',          hint: 'Default http://127.0.0.1:11434.',                          prefix: 'http', category: 'Local runtime' },
  { envVar: 'LMSTUDIO_BASE_URL',   label: 'LM Studio base URL',   hint: 'Default http://127.0.0.1:1234/v1.',                        prefix: 'http', category: 'Local runtime' },

  // ─── Search & web tools ───────────────────────────────────────────────
  { envVar: 'TAVILY_API_KEY',     label: 'Tavily Search (recommended)', hint: 'Easiest web_search/web_extract setup for most users.',      prefix: 'tvly-',   docsUrl: 'https://app.tavily.com/home',                 category: 'Search & web' },
  { envVar: 'PARALLEL_API_KEY',   label: 'Parallel Search',             hint: 'Alternative provider for Hermes web_search/web_extract.',   prefix: '',        docsUrl: 'https://parallel.ai/',                         category: 'Search & web' },
  { envVar: 'EXA_API_KEY',        label: 'Exa Search',     hint: 'Neural web search for agents.',                                prefix: '',        docsUrl: 'https://dashboard.exa.ai/api-keys',           category: 'Search & web' },
  { envVar: 'FIRECRAWL_API_KEY',  label: 'Firecrawl',      hint: 'Convert web pages to LLM-ready data.',                         prefix: 'fc-',     docsUrl: 'https://www.firecrawl.dev/app/api-keys',      category: 'Search & web' },
  { envVar: 'BROWSERBASE_API_KEY',label: 'Browserbase API key', hint: 'Cloud browsers for agentic workflows (paid upgrade).',    prefix: 'bb_',     docsUrl: 'https://www.browserbase.com/dashboard',       category: 'Search & web' },
  { envVar: 'BROWSERBASE_PROJECT_ID', label: 'Browserbase Project ID', hint: 'Project UUID from your Browserbase dashboard.',    prefix: '',        docsUrl: 'https://www.browserbase.com/dashboard',       category: 'Search & web' },
  { envVar: 'BROWSER_USE_API_KEY',label: 'Browser Use',    hint: 'Hosted agentic browser API.',                                  prefix: '',        docsUrl: 'https://browser-use.com',                     category: 'Search & web' },
  { envVar: 'CAMOFOX_URL',        label: 'Camofox URL',    hint: 'Local Camofox server, e.g. http://localhost:9377.',            prefix: 'http',    docsUrl: 'https://github.com/jo-inc/camofox-browser',   category: 'Search & web' },

  // ─── Voice & media ────────────────────────────────────────────────────
  { envVar: 'ELEVENLABS_API_KEY', label: 'ElevenLabs',     hint: 'Text-to-speech.',                                              prefix: '',        docsUrl: 'https://elevenlabs.io/app/settings/api-keys', category: 'Voice & media' },

  // ─── Messaging / bots ─────────────────────────────────────────────────
  // Names match the official Hermes messaging docs:
  //   https://hermes-agent.nousresearch.com/docs/user-guide/messaging/
  { envVar: 'TELEGRAM_BOT_TOKEN',     label: 'Telegram Bot',         hint: 'Token from @BotFather.',                                       prefix: '',        docsUrl: 'https://core.telegram.org/bots#how-do-i-create-a-bot', category: 'Messaging' },
  { envVar: 'TELEGRAM_ALLOWED_USERS', label: 'Telegram Allowed Users', hint: 'Comma-separated numeric Telegram user IDs.',                prefix: '',        docsUrl: 'https://t.me/userinfobot', category: 'Messaging' },
  { envVar: 'DISCORD_BOT_TOKEN',      label: 'Discord Bot',          hint: 'Token from the Developer Portal.',                             prefix: '',        docsUrl: 'https://discord.com/developers/applications', category: 'Messaging' },
  { envVar: 'DISCORD_ALLOWED_USERS',  label: 'Discord Allowed Users', hint: 'Comma-separated Discord user IDs (Developer Mode → Copy ID).', prefix: '',       docsUrl: 'https://discord.com/developers/applications', category: 'Messaging' },
  { envVar: 'SLACK_BOT_TOKEN',        label: 'Slack Bot',            hint: 'xoxb-… token from a Slack app.',                               prefix: 'xoxb-',   docsUrl: 'https://api.slack.com/apps',                  category: 'Messaging' },
  { envVar: 'SLACK_APP_TOKEN',        label: 'Slack App-Level',      hint: 'xapp-… token (Socket Mode).',                                  prefix: 'xapp-',   docsUrl: 'https://api.slack.com/apps',                  category: 'Messaging' },
  { envVar: 'SLACK_ALLOWED_USERS',    label: 'Slack Allowed Users',  hint: 'Comma-separated Slack member IDs (e.g. U01ABC2DEF3).',         prefix: '',        docsUrl: 'https://api.slack.com/apps',                  category: 'Messaging' },
  // WhatsApp via Baileys — QR pairing runs in-app (Channels → WhatsApp → Start QR pairing).
  { envVar: 'WHATSAPP_ENABLED',       label: 'WhatsApp Enabled',     hint: 'Set to "true" to turn the WhatsApp adapter on.',               prefix: '',        docsUrl: 'https://hermes-agent.nousresearch.com/docs/user-guide/messaging/whatsapp', category: 'Messaging' },
  { envVar: 'WHATSAPP_MODE',          label: 'WhatsApp Mode',        hint: '"bot" for a dedicated number, or "self-chat" for your own.',   prefix: '',        docsUrl: 'https://hermes-agent.nousresearch.com/docs/user-guide/messaging/whatsapp', category: 'Messaging' },
  { envVar: 'WHATSAPP_ALLOWED_USERS', label: 'WhatsApp Allowed Users', hint: 'Phone numbers (country code, no +). Comma-separated, or *.',  prefix: '',       docsUrl: 'https://hermes-agent.nousresearch.com/docs/user-guide/messaging/whatsapp', category: 'Messaging' },
  // Email — official Hermes vars (not the older SMTP_*/IMAP_* set).
  { envVar: 'EMAIL_ADDRESS',          label: "Agent's email address", hint: 'e.g. ron@yourdomain.com',                                     prefix: '',        category: 'Messaging' },
  { envVar: 'EMAIL_PASSWORD',         label: 'Email password',       hint: 'App password if your provider uses 2FA.',                      prefix: '',        category: 'Messaging' },
  { envVar: 'EMAIL_IMAP_HOST',        label: 'Email IMAP host',      hint: 'e.g. imap.gmail.com',                                          prefix: '',        category: 'Messaging' },
  { envVar: 'EMAIL_SMTP_HOST',        label: 'Email SMTP host',      hint: 'e.g. smtp.gmail.com',                                          prefix: '',        category: 'Messaging' },
  { envVar: 'EMAIL_IMAP_PORT',        label: 'Email IMAP port',      hint: 'Default 993 (IMAP SSL).',                                      prefix: '',        category: 'Messaging' },
  { envVar: 'EMAIL_SMTP_PORT',        label: 'Email SMTP port',      hint: 'Default 587 (SMTP STARTTLS).',                                 prefix: '',        category: 'Messaging' },
  { envVar: 'EMAIL_ALLOWED_USERS',    label: 'Email Allowed Users',  hint: 'Comma-separated allowed sender addresses.',                    prefix: '',        category: 'Messaging' },
  // Signal via signal-cli daemon.
  { envVar: 'SIGNAL_HTTP_URL',        label: 'signal-cli URL',       hint: 'Default http://127.0.0.1:8080',                                prefix: 'http',    docsUrl: 'https://hermes-agent.nousresearch.com/docs/user-guide/messaging/signal', category: 'Messaging' },
  { envVar: 'SIGNAL_ACCOUNT',         label: 'Signal account',       hint: 'Bot phone number, E.164 format (e.g. +15551234567).',          prefix: '+',       category: 'Messaging' },
  { envVar: 'SIGNAL_ALLOWED_USERS',   label: 'Signal Allowed Users', hint: 'E.164 numbers, comma-separated.',                              prefix: '',        category: 'Messaging' },
  { envVar: 'SIGNAL_GROUP_ALLOWED_USERS', label: 'Signal group allowlist', hint: 'Group IDs to monitor, or * for all groups. Omit to ignore groups.', prefix: '', docsUrl: 'https://hermes-agent.nousresearch.com/docs/user-guide/messaging/signal', category: 'Messaging' },
  { envVar: 'SIGNAL_ALLOW_ALL_USERS', label: 'Signal allow everyone', hint: 'true = skip DM allowlist (dangerous). Prefer allowlist or pairing.', prefix: '', docsUrl: 'https://hermes-agent.nousresearch.com/docs/user-guide/messaging/signal', category: 'Messaging' },
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
