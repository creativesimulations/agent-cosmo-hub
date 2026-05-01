/**
 * User-facing capability catalog.
 *
 * This is the discoverability surface — a declarative list of things the
 * agent can do, grouped by category. It is intentionally separate from
 * `src/lib/capabilities.ts` (which drives the permission-policy runtime).
 *
 * Each entry includes:
 *   - icon (lucide name) + one-line "what it does" copy
 *   - a `setupPrompt` that the UI can seed into chat. The agent then
 *     drives the real setup via the agent-intent protocol — the app
 *     itself has no setup logic for these capabilities.
 *   - optional `examplePrompts` shown as quick-start chips.
 */

export type CapabilityCategory =
  | "communication"
  | "productivity"
  | "knowledge"
  | "computer"
  | "media"
  | "developer";

export interface CapabilityEntry {
  /** Stable id (lowercase, dash-separated). */
  id: string;
  /** Display label. */
  name: string;
  /** Lucide icon name (resolved at render). */
  icon: string;
  /** One-line description, plain language. */
  oneLiner: string;
  /** Category bucket for grouping in the UI. */
  category: CapabilityCategory;
  /** Prompt seeded into the chat input when the user clicks "Set up". */
  setupPrompt: string;
  /** A few example prompts surfaced as chips after setup. */
  examplePrompts?: string[];
  /** Whether this capability requires user-supplied credentials/setup. */
  requiresSetup?: boolean;
}

export const CAPABILITY_CATEGORIES: { id: CapabilityCategory; label: string; description: string }[] = [
  { id: "communication", label: "Communication", description: "Talk to your agent through the apps you already use" },
  { id: "productivity",  label: "Productivity",  description: "Email, calendar, docs, and task tools" },
  { id: "knowledge",     label: "Knowledge",     description: "Search the web and read content" },
  { id: "computer",      label: "Your computer", description: "Files, terminal, and local automation" },
  { id: "media",         label: "Media",         description: "Images, audio, and video" },
  { id: "developer",     label: "Developer",     description: "Code, repos, and dev tooling" },
];

export const CAPABILITY_CATALOG: CapabilityEntry[] = [
  // Communication
  {
    id: "telegram",
    name: "Telegram",
    icon: "Send",
    oneLiner: "Chat with your agent from Telegram.",
    category: "communication",
    requiresSetup: true,
    setupPrompt: "Set up Telegram so I can chat with you from the Telegram app.",
    examplePrompts: ["Send me a Telegram message when my build finishes"],
  },
  {
    id: "slack",
    name: "Slack",
    icon: "Slack",
    oneLiner: "Talk to your agent in any Slack workspace.",
    category: "communication",
    requiresSetup: true,
    setupPrompt: "Set up Slack so I can message you from my Slack workspace.",
    examplePrompts: ["Post a daily summary to my #status Slack channel"],
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    icon: "MessageCircle",
    oneLiner: "Message your agent from WhatsApp.",
    category: "communication",
    requiresSetup: true,
    setupPrompt: "Set up WhatsApp so I can message you from WhatsApp.",
    examplePrompts: ["Send me a WhatsApp message when something important happens"],
  },
  {
    id: "discord",
    name: "Discord",
    icon: "Hash",
    oneLiner: "Use your agent inside a Discord server.",
    category: "communication",
    requiresSetup: true,
    setupPrompt: "Set up Discord so I can interact with you from a Discord server.",
  },
  {
    id: "signal",
    name: "Signal",
    icon: "Shield",
    oneLiner: "End-to-end encrypted chat with your agent.",
    category: "communication",
    requiresSetup: true,
    setupPrompt: "Set up Signal so I can chat with you privately from Signal.",
  },

  // Productivity
  {
    id: "gmail",
    name: "Gmail",
    icon: "Mail",
    oneLiner: "Read, send, and triage your email.",
    category: "productivity",
    requiresSetup: true,
    setupPrompt: "Connect my Gmail so you can read and send email for me.",
    examplePrompts: ["Summarize my unread email from today", "Draft a polite decline to the latest meeting invite"],
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    icon: "Calendar",
    oneLiner: "Schedule, reschedule, and reason about your day.",
    category: "productivity",
    requiresSetup: true,
    setupPrompt: "Connect my Google Calendar so you can manage my schedule.",
    examplePrompts: ["What's on my calendar tomorrow?", "Find a 30-minute slot next week for a call with Alex"],
  },
  {
    id: "google-drive",
    name: "Google Drive / Docs / Sheets",
    icon: "FolderOpen",
    oneLiner: "Read and edit your Drive, Docs, and Sheets.",
    category: "productivity",
    requiresSetup: true,
    setupPrompt: "Connect my Google Drive so you can work with my Docs and Sheets.",
  },

  // Knowledge
  {
    id: "web-search",
    name: "Web search",
    icon: "Search",
    oneLiner: "Search the web and read pages.",
    category: "knowledge",
    setupPrompt: "Make sure web search is set up and tell me how to use it.",
    examplePrompts: ["What's the latest news on…", "Find three articles comparing X and Y"],
  },
  {
    id: "wikipedia",
    name: "Wikipedia",
    icon: "BookOpen",
    oneLiner: "Look up facts and summaries.",
    category: "knowledge",
    setupPrompt: "Show me how to ask you to look things up on Wikipedia.",
  },
  {
    id: "youtube-transcripts",
    name: "YouTube transcripts",
    icon: "Youtube",
    oneLiner: "Summarize and quote any YouTube video.",
    category: "knowledge",
    setupPrompt: "Install the YouTube transcript skill so you can summarize videos.",
    examplePrompts: ["Summarize this YouTube video: <url>"],
  },

  // Computer
  {
    id: "filesystem",
    name: "Files & folders",
    icon: "HardDrive",
    oneLiner: "Read, write, and organize files on your computer.",
    category: "computer",
    setupPrompt: "Walk me through how you handle files on my computer and what I should approve.",
    examplePrompts: ["Organize my Downloads folder by file type", "Find all PDFs modified this week"],
  },
  {
    id: "terminal",
    name: "Terminal commands",
    icon: "Terminal",
    oneLiner: "Run shell commands with your approval.",
    category: "computer",
    setupPrompt: "Show me how to safely let you run terminal commands.",
  },
  {
    id: "browser-automation",
    name: "Browser automation",
    icon: "Globe",
    oneLiner: "Open pages, fill forms, take screenshots.",
    category: "computer",
    requiresSetup: true,
    setupPrompt: "Set up browser automation so you can load pages and interact with the web for me.",
    examplePrompts: ["Take a screenshot of example.com", "Log in to my dashboard and grab today's numbers"],
  },

  // Media
  {
    id: "image-generation",
    name: "Image generation",
    icon: "Image",
    oneLiner: "Generate images from a description.",
    category: "media",
    setupPrompt: "Set up image generation and tell me how to ask for images.",
  },
  {
    id: "audio-transcription",
    name: "Audio transcription",
    icon: "Mic",
    oneLiner: "Turn voice notes and meetings into text.",
    category: "media",
    setupPrompt: "Install an audio transcription skill so you can transcribe recordings.",
  },

  // Developer
  {
    id: "github",
    name: "GitHub",
    icon: "Github",
    oneLiner: "Read repos, open issues, and review PRs.",
    category: "developer",
    requiresSetup: true,
    setupPrompt: "Connect my GitHub so you can work with my repos.",
    examplePrompts: ["Open a PR with these changes", "Triage the issues in <repo>"],
  },
  {
    id: "code-execution",
    name: "Run code",
    icon: "Code2",
    oneLiner: "Execute Python or shell snippets in a sandbox.",
    category: "developer",
    setupPrompt: "Show me how I can ask you to run a quick script for me.",
  },
];

/** Group catalog by category (preserving definition order within each group). */
export function groupCatalog(): { category: CapabilityCategory; label: string; description: string; entries: CapabilityEntry[] }[] {
  return CAPABILITY_CATEGORIES.map((c) => ({
    category: c.id,
    label: c.label,
    description: c.description,
    entries: CAPABILITY_CATALOG.filter((e) => e.category === c.id),
  })).filter((g) => g.entries.length > 0);
}

/** Aggregate example prompts for the chat empty-state. */
export function topExamplePrompts(limit = 8): string[] {
  const out: string[] = [];
  for (const entry of CAPABILITY_CATALOG) {
    for (const p of entry.examplePrompts ?? []) {
      if (out.length < limit && !out.includes(p)) out.push(p);
    }
  }
  return out;
}
