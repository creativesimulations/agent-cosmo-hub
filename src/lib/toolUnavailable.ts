/**
 * Detects when the agent itself reports a tool / capability as unavailable
 * (NOT a Ronbot permission denial — that's handled separately in
 * ChatContext via `permissionMismatch`).
 *
 * Hermes has dozens of optional tools that can fail at runtime for one of
 * three reasons:
 *   1. The skill folder is missing or disabled in config.yaml.
 *   2. A required secret (API key) isn't set in ~/.hermes/.env.
 *   3. An optional Python extra (e.g. `[web]`, `[voice]`) wasn't installed.
 *
 * The agent typically replies with phrases like:
 *   "I tried to load X, but the browser tool returned a permission-denied
 *    error in this environment."
 *   "the web_search tool is unavailable"
 *   "I don't have access to image generation right now"
 *
 * This module recognises those phrasings, identifies which capability the
 * agent was trying to use, and tells the UI exactly what's missing so we
 * can surface a one-click fix in the chat bubble.
 */

export type ToolCapability =
  | "browser"
  | "webSearch"
  | "imageGen"
  | "codeInterpreter"
  | "voice"
  | "email"
  | "messaging"
  | "memory"
  | "filesystem";

export interface ToolUnavailableHit {
  capability: ToolCapability;
  /** Friendly name shown in the warning bubble. */
  label: string;
  /** Phrase from the agent's reply that triggered the match (for context). */
  matchedText: string;
  /** Env vars (any one of these) that, if set, typically enables the tool. */
  candidateSecrets: string[];
  /** Skill folder names that provide this capability (for the Skills page). */
  candidateSkills: string[];
  /** Optional `pip install hermes-agent[<extra>]` extras package name. */
  extrasPackage?: string;
  /** Short hint shown to the user. */
  hint: string;
}

interface PatternDef {
  capability: ToolCapability;
  label: string;
  patterns: RegExp[];
  candidateSecrets: string[];
  candidateSkills: string[];
  extrasPackage?: string;
  hint: string;
}

/**
 * Order matters — first match wins. Put more-specific phrasings (e.g.
 * "browser tool") above more-general ones (e.g. "fetch the page").
 */
const TOOL_PATTERNS: PatternDef[] = [
  {
    capability: "browser",
    label: "Web browsing",
    patterns: [
      /browser\s+tool[^.\n]{0,80}\b(?:returned|reported|gave)?[^.\n]{0,40}\bpermission[-\s]?denied/i,
      /browser\s+tool[^.\n]{0,80}\b(?:unavailable|not available|not enabled|disabled|missing|isn'?t available)/i,
      /can(?:'t|not)\s+(?:open|load|render|use)\s+(?:the\s+)?browser/i,
      /no\s+browser\s+(?:tool|access|available)/i,
      /browser\s+(?:tool|capability)[^.\n]{0,60}\bin this environment/i,
      // New broader phrasing — catches "I can't access ryukyu-kenpo.info content
      // right now due to a permission error in this environment" which doesn't
      // mention the word "browser" at all.
      /can(?:'t|not)\s+access[^.\n]{0,80}\b(?:content|page|site|url|website)[^.\n]{0,80}\bpermission\s+error/i,
      /can(?:'t|not)\s+(?:fetch|retrieve|load|read)[^.\n]{0,80}\bpermission\s+error\s+in\s+this\s+environment/i,
      /permission\s+error\s+in\s+this\s+environment/i,
    ],
    candidateSecrets: ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID", "FIRECRAWL_API_KEY"],
    candidateSkills: ["browser", "browser_use", "web_browser", "playwright"],
    extrasPackage: "web",
    hint: "The agent's headless browser needs either a Browserbase or Firecrawl key, plus the browser skill installed.",
  },
  {
    capability: "webSearch",
    label: "Web search",
    patterns: [
      /web[_\s-]?search\s+tool[^.\n]{0,80}\b(?:unavailable|not available|disabled|missing|isn'?t available)/i,
      /search\s+tool[^.\n]{0,80}\b(?:unavailable|not configured|requires)/i,
      /can(?:'t|not)\s+(?:perform|run|do)\s+(?:a\s+)?web\s+search/i,
      /no\s+(?:web\s+)?search\s+(?:provider|tool|api)/i,
    ],
    candidateSecrets: ["EXA_API_KEY", "TAVILY_API_KEY", "PARALLEL_API_KEY", "FIRECRAWL_API_KEY"],
    candidateSkills: ["web_search", "search", "exa", "tavily"],
    hint: "Web search needs an API key from a supported provider (Exa, Tavily, Parallel, or Firecrawl).",
  },
  {
    capability: "imageGen",
    label: "Image generation",
    patterns: [
      /image\s+generation[^.\n]{0,60}\b(?:unavailable|not available|disabled|isn'?t available|not enabled)/i,
      /can(?:'t|not)\s+generate\s+(?:an?\s+)?image/i,
      /no\s+image\s+(?:generation|gen|model)\s+(?:tool|configured|available)/i,
    ],
    candidateSecrets: ["OPENAI_API_KEY", "REPLICATE_API_TOKEN", "STABILITY_API_KEY", "FAL_KEY"],
    candidateSkills: ["image_gen", "image_generation", "dalle", "replicate"],
    hint: "Image generation needs an OpenAI / Replicate / Stability / Fal.ai key.",
  },
  {
    capability: "voice",
    label: "Voice / TTS",
    patterns: [
      /(?:voice|text[-\s]?to[-\s]?speech|tts|speech\s+synthesis)\s+(?:tool|capability)?[^.\n]{0,60}\b(?:unavailable|not available|disabled|not configured)/i,
      /can(?:'t|not)\s+(?:speak|generate\s+audio|produce\s+speech)/i,
    ],
    candidateSecrets: ["ELEVENLABS_API_KEY", "OPENAI_API_KEY"],
    candidateSkills: ["voice", "tts", "elevenlabs"],
    extrasPackage: "voice",
    hint: "Voice output needs an ElevenLabs or OpenAI key, plus the voice extras installed.",
  },
  {
    capability: "email",
    label: "Email sending",
    patterns: [
      /(?:email|smtp|mail)\s+(?:tool|sending)[^.\n]{0,60}\b(?:unavailable|not available|disabled|not configured|requires)/i,
      /can(?:'t|not)\s+send\s+(?:an?\s+)?email/i,
    ],
    candidateSecrets: ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"],
    candidateSkills: ["email", "smtp", "mail"],
    hint: "Email sending needs SMTP credentials (host, user, password).",
  },
  {
    capability: "messaging",
    label: "Messaging",
    patterns: [
      /(?:telegram|discord|slack|whatsapp)\s+(?:tool|bot|integration)[^.\n]{0,60}\b(?:unavailable|not available|disabled|not configured|requires)/i,
      /can(?:'t|not)\s+(?:send|post)\s+(?:a\s+)?(?:telegram|discord|slack|whatsapp)\s+message/i,
    ],
    candidateSecrets: [
      "TELEGRAM_BOT_TOKEN", "DISCORD_BOT_TOKEN", "SLACK_BOT_TOKEN",
      "WHATSAPP_ACCESS_TOKEN",
    ],
    candidateSkills: ["telegram", "discord", "slack", "whatsapp", "messaging"],
    extrasPackage: "messaging",
    hint: "Messaging needs the relevant bot token plus the messaging extras installed.",
  },
  {
    capability: "codeInterpreter",
    label: "Code interpreter",
    patterns: [
      /code\s+interpreter[^.\n]{0,60}\b(?:unavailable|not available|disabled|sandboxed)/i,
      /can(?:'t|not)\s+(?:execute|run)\s+(?:python|code)\s+(?:in\s+a\s+sandbox)/i,
    ],
    candidateSecrets: [],
    candidateSkills: ["code_interpreter", "python_sandbox"],
    hint: "Code interpreter requires the sandbox skill to be installed and enabled in Skills.",
  },
  {
    capability: "memory",
    label: "Long-term memory",
    patterns: [
      /(?:long[-\s]?term\s+)?memory\s+(?:tool|store|backend)[^.\n]{0,60}\b(?:unavailable|not available|disabled|not configured)/i,
    ],
    candidateSecrets: ["MEM0_API_KEY", "ZEP_API_KEY"],
    candidateSkills: ["memory", "mem0", "zep"],
    hint: "Long-term memory needs an external memory provider key (Mem0, Zep, etc.).",
  },
];

/**
 * Scan an assistant reply for any tool-unavailable phrasing. Returns the
 * first hit (most-specific patterns are listed first), or null if nothing
 * matches.
 */
export const detectToolUnavailable = (reply: string): ToolUnavailableHit | null => {
  if (!reply) return null;
  for (const def of TOOL_PATTERNS) {
    for (const re of def.patterns) {
      const m = reply.match(re);
      if (m) {
        return {
          capability: def.capability,
          label: def.label,
          matchedText: m[0].slice(0, 200),
          candidateSecrets: def.candidateSecrets,
          candidateSkills: def.candidateSkills,
          extrasPackage: def.extrasPackage,
          hint: def.hint,
        };
      }
    }
  }
  return null;
};
