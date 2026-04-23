/**
 * Universal Capability Registry — single source of truth for every
 * feature/skill/tool the agent might try to use.
 *
 * The registry is built from THREE sources, merged at runtime:
 *   1. Built-in catalog (this file) — well-known capabilities the agent
 *      ships with (shell, internet, web browsing, etc.).
 *   2. Installed skills — discovered via `systemAPI.listSkills()` and
 *      bucketed into capabilities by category/name/requiredSecrets.
 *   3. Observed at runtime — when the agent invokes or fails on a tool
 *      we've never seen, it gets auto-registered as `unknown:<name>`.
 *
 * Every capability gets a per-user policy stored in
 * `settings.capabilityPolicy[id]` with one of four values:
 *   ask | allow | session | deny
 *
 * The runtime gate (in ChatContext) consults the policy before letting
 * the agent proceed, and the same registry powers the auto-generated
 * Capabilities panel in Settings — so adding/removing skills updates
 * the toggles automatically with no code changes.
 */

export type CapabilityChoice = "ask" | "allow" | "session" | "deny";
export type CapabilityRisk = "low" | "medium" | "high";

export interface CapabilityDefinition {
  /** Stable id used as the policy key. Lowercase, no spaces. */
  id: string;
  /** Human-readable name shown in dialogs and Settings. */
  label: string;
  /** Short explanation of what the capability does. */
  description: string;
  /** Risk badge — drives the dialog accent color. */
  risk: CapabilityRisk;
  /** Lucide icon name (resolved at render time). */
  icon: string;
  /** Env vars (any one) that typically enable the underlying tool. */
  candidateSecrets: string[];
  /** Skill folder names that provide this capability. */
  candidateSkills: string[];
  /** Optional `pip install hermes-agent[<extra>]` extras package. */
  extrasPackage?: string;
  /** Where this entry came from — affects how it's rendered/edited. */
  source: "builtin" | "skill" | "observed";
  /** When source = 'skill', the original skill name. */
  skillName?: string;
  /** Tags used to group capabilities in the Settings list. */
  group: "system" | "web" | "media" | "communication" | "data" | "other";
}

/**
 * Built-in catalog — mirrors the existing `permissions` config plus the
 * well-known optional tool capabilities Hermes ships with. The ids here
 * are the ones used by ChatContext's tool-use detector and by the
 * existing `toolUnavailable` mapper, so they stay in sync.
 */
export const BUILTIN_CAPABILITIES: CapabilityDefinition[] = [
  {
    id: "shell",
    label: "Shell command",
    description: "Run any command in your terminal (rm, curl, git, etc.). High-impact — can modify files and the system.",
    risk: "high",
    icon: "Terminal",
    candidateSecrets: [],
    candidateSkills: [],
    source: "builtin",
    group: "system",
  },
  {
    id: "fileRead",
    label: "Read files",
    description: "Read files from your disk, optionally restricted to allow-listed folders.",
    risk: "low",
    icon: "FileText",
    candidateSecrets: [],
    candidateSkills: [],
    source: "builtin",
    group: "system",
  },
  {
    id: "fileWrite",
    label: "Write files",
    description: "Create, edit, or delete files on your disk. Restricted to allow-listed folders by default.",
    risk: "medium",
    icon: "FilePen",
    candidateSecrets: [],
    candidateSkills: [],
    source: "builtin",
    group: "system",
  },
  {
    id: "internet",
    label: "Internet access",
    description: "Make outbound network requests (HTTP, DNS, websockets). Required by browser, web search, APIs.",
    risk: "medium",
    icon: "Globe",
    candidateSecrets: [],
    candidateSkills: [],
    source: "builtin",
    group: "web",
  },
  {
    id: "script",
    label: "Run scripts",
    description: "Execute Python / Node / Bash scripts in the sandbox.",
    risk: "high",
    icon: "Code2",
    candidateSecrets: [],
    candidateSkills: [],
    source: "builtin",
    group: "system",
  },
  {
    id: "webBrowser",
    label: "Web browsing",
    description: "Load and read web pages with a real browser. Pick a backend (Browserbase, Camofox, or Local Chrome) in Set up browser.",
    risk: "medium",
    icon: "Globe",
    candidateSecrets: [
      "BROWSERBASE_API_KEY",
      "BROWSERBASE_PROJECT_ID",
      "BROWSER_USE_API_KEY",
      "CAMOFOX_URL",
      "FIRECRAWL_API_KEY",
    ],
    candidateSkills: ["browser", "browser_use", "web_browser", "playwright"],
    extrasPackage: "web",
    source: "builtin",
    group: "web",
  },
  {
    id: "webSearch",
    label: "Web search",
    description: "Search the web via a third-party search API (Exa, Tavily, Serper, Brave, Firecrawl).",
    risk: "low",
    icon: "Search",
    candidateSecrets: ["EXA_API_KEY", "TAVILY_API_KEY", "SERPER_API_KEY", "BRAVE_API_KEY", "FIRECRAWL_API_KEY"],
    candidateSkills: ["web_search", "search", "exa", "tavily"],
    source: "builtin",
    group: "web",
  },
  {
    id: "imageGen",
    label: "Image generation",
    description: "Generate images with an external model (OpenAI, Replicate, Stability, Fal.ai).",
    risk: "low",
    icon: "Image",
    candidateSecrets: ["OPENAI_API_KEY", "REPLICATE_API_TOKEN", "STABILITY_API_KEY", "FAL_KEY"],
    candidateSkills: ["image_gen", "image_generation", "dalle", "replicate"],
    source: "builtin",
    group: "media",
  },
  {
    id: "voice",
    label: "Voice / Text-to-speech",
    description: "Generate spoken audio replies (ElevenLabs, OpenAI TTS).",
    risk: "low",
    icon: "Mic",
    candidateSecrets: ["ELEVENLABS_API_KEY", "OPENAI_API_KEY"],
    candidateSkills: ["voice", "tts", "elevenlabs"],
    extrasPackage: "voice",
    source: "builtin",
    group: "media",
  },
  {
    id: "email",
    label: "Send email",
    description: "Send emails via SMTP. Needs SMTP host, user, and password.",
    risk: "medium",
    icon: "Mail",
    candidateSecrets: ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"],
    candidateSkills: ["email", "smtp", "mail"],
    source: "builtin",
    group: "communication",
  },
  {
    id: "messaging",
    label: "Messaging",
    description: "Send messages on Telegram / Discord / Slack / WhatsApp via bot tokens.",
    risk: "medium",
    icon: "MessageCircle",
    candidateSecrets: ["TELEGRAM_BOT_TOKEN", "DISCORD_BOT_TOKEN", "SLACK_BOT_TOKEN", "WHATSAPP_ACCESS_TOKEN"],
    candidateSkills: ["telegram", "discord", "slack", "whatsapp", "messaging"],
    extrasPackage: "messaging",
    source: "builtin",
    group: "communication",
  },
  {
    id: "memory",
    label: "Long-term memory",
    description: "Persist facts to an external memory backend (Mem0, Zep).",
    risk: "low",
    icon: "Database",
    candidateSecrets: ["MEM0_API_KEY", "ZEP_API_KEY"],
    candidateSkills: ["memory", "mem0", "zep"],
    source: "builtin",
    group: "data",
  },
  {
    id: "calendar",
    label: "Calendar",
    description: "Read or create calendar events (Google Calendar, etc.).",
    risk: "medium",
    icon: "Calendar",
    candidateSecrets: ["GOOGLE_CALENDAR_CREDENTIALS", "GOOGLE_API_KEY"],
    candidateSkills: ["calendar", "google_calendar"],
    source: "builtin",
    group: "data",
  },
];

/**
 * Map an installed skill to a capability id. Returns the matching
 * built-in id if the skill provides a known capability, otherwise
 * returns `skill:<name>` so the user can still gate it.
 */
export const skillToCapabilityId = (skillName: string): string => {
  const lower = skillName.toLowerCase().replace(/[\s-]/g, "_");
  for (const cap of BUILTIN_CAPABILITIES) {
    if (cap.candidateSkills.some((s) => s.toLowerCase() === lower)) {
      return cap.id;
    }
  }
  return `skill:${lower}`;
};

/** Default policy when nothing is set yet. Conservative — surface the dialog. */
export const DEFAULT_CAPABILITY_POLICY: Record<string, CapabilityChoice> = {
  // Inherit existing permissions defaults so existing users see no surprise.
  shell: "ask",
  fileRead: "allow",
  fileWrite: "ask",
  internet: "ask",
  script: "ask",
  // New capabilities all default to ask so the user is in control.
  webBrowser: "ask",
  webSearch: "ask",
  imageGen: "ask",
  voice: "ask",
  email: "ask",
  messaging: "ask",
  memory: "ask",
  calendar: "ask",
};

/**
 * Merge built-ins, installed skills, and observed tools into a single
 * registry keyed by capability id. Skills that map to a built-in
 * capability override the built-in's `candidateSkills` so the readiness
 * check uses the actual installed name.
 */
export interface DiscoveredSkill {
  name: string;
  category?: string;
  requiredSecrets?: string[];
  enabled?: boolean;
}

export const buildRegistry = (
  installedSkills: DiscoveredSkill[],
  observedToolNames: string[],
): Record<string, CapabilityDefinition> => {
  const reg: Record<string, CapabilityDefinition> = {};
  for (const cap of BUILTIN_CAPABILITIES) {
    reg[cap.id] = { ...cap };
  }

  // Layer skills on top — either enrich a built-in or add a new entry.
  for (const skill of installedSkills) {
    const id = skillToCapabilityId(skill.name);
    if (reg[id]) {
      // Enrich: add the actual skill name + any extra required secrets.
      reg[id] = {
        ...reg[id],
        skillName: skill.name,
        candidateSecrets: Array.from(
          new Set([...(reg[id].candidateSecrets), ...(skill.requiredSecrets || [])]),
        ),
      };
    } else {
      reg[id] = {
        id,
        label: skill.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        description: skill.category
          ? `Skill from category "${skill.category}". The agent may invoke it during tasks.`
          : "User-installed skill. The agent may invoke it during tasks.",
        risk: "medium",
        icon: "Puzzle",
        candidateSecrets: skill.requiredSecrets || [],
        candidateSkills: [skill.name],
        source: "skill",
        skillName: skill.name,
        group: "other",
      };
    }
  }

  // Layer observed tools on top — only if not already covered.
  for (const name of observedToolNames) {
    const id = `observed:${name.toLowerCase()}`;
    if (reg[id]) continue;
    // Check if any built-in already covers this name.
    const builtinMatch = Object.values(reg).find((c) =>
      c.candidateSkills.some((s) => s.toLowerCase() === name.toLowerCase()),
    );
    if (builtinMatch) continue;
    reg[id] = {
      id,
      label: name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      description: `Tool the agent attempted to use that wasn't pre-registered. Decide how to handle it.`,
      risk: "medium",
      icon: "HelpCircle",
      candidateSecrets: [],
      candidateSkills: [name],
      source: "observed",
      group: "other",
    };
  }

  return reg;
};

/** Readiness assessment for a capability — surfaced in Settings/Skills. */
export interface CapabilityReadiness {
  ready: boolean;
  /** Human-readable reason the capability isn't ready (empty if ready). */
  reason?: string;
  missingSecret: boolean;
  missingSkill: boolean;
}

export const assessReadiness = (
  cap: CapabilityDefinition,
  storedSecretKeys: string[],
  installedSkills: DiscoveredSkill[],
): CapabilityReadiness => {
  // System capabilities (shell, fileRead, etc.) don't need keys/skills.
  if (cap.group === "system" && cap.candidateSecrets.length === 0 && cap.candidateSkills.length === 0) {
    return { ready: true, missingSecret: false, missingSkill: false };
  }

  const hasSecret =
    cap.candidateSecrets.length === 0 ||
    cap.candidateSecrets.some((k) => storedSecretKeys.includes(k));
  const hasSkill =
    cap.candidateSkills.length === 0 ||
    installedSkills.some((s) =>
      cap.candidateSkills.some((cs) => cs.toLowerCase() === s.name.toLowerCase()),
    );

  if (!hasSkill && cap.candidateSkills.length > 0) {
    return {
      ready: false,
      reason: "Skill missing or disabled",
      missingSecret: !hasSecret,
      missingSkill: true,
    };
  }
  if (!hasSecret && cap.candidateSecrets.length > 0) {
    return {
      ready: false,
      reason: "Provider key missing",
      missingSecret: true,
      missingSkill: false,
    };
  }
  return { ready: true, missingSecret: false, missingSkill: false };
};

export const CHOICE_LABELS: Record<CapabilityChoice, string> = {
  ask: "Ask each time",
  allow: "Always allow",
  session: "Allow this session",
  deny: "Always deny",
};
