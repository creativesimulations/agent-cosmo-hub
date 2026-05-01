/**
 * Static fallback catalog used when:
 *   - The desktop bridge is unavailable (browser dev mode).
 *   - The installed Hermes version doesn't expose `hermes capabilities`.
 *   - Discovery is in flight on first paint and we want SSR-quality copy.
 *
 * Every entry should be safe to render; richer copy comes from the agent
 * once discovery completes.
 */

import type { DiscoveredCapability } from "./types";

const ch = (
  id: string,
  name: string,
  icon: string,
  oneLiner: string,
  setupPrompt: string,
  requiredSecrets: string[] = [],
  docsUrl?: string,
): DiscoveredCapability => ({
  id,
  kind: "channel",
  name,
  oneLiner,
  icon,
  category: "communication",
  requiresSetup: true,
  requiredSecrets,
  optionalSecrets: [],
  setupPrompt,
  source: "seed",
  docsUrl,
});

const tool = (
  id: string,
  name: string,
  icon: string,
  oneLiner: string,
  setupPrompt: string,
  category: DiscoveredCapability["category"] = "other",
  requiresSetup = false,
  requiredSecrets: string[] = [],
): DiscoveredCapability => ({
  id,
  kind: "tool",
  name,
  oneLiner,
  icon,
  category,
  requiresSetup,
  requiredSecrets,
  optionalSecrets: [],
  setupPrompt,
  source: "seed",
});

export const SEED_CAPABILITIES: DiscoveredCapability[] = [
  // ── Channels (well-known Hermes messaging gateways) ──
  ch("telegram", "Telegram", "Send", "Chat with your agent from Telegram.",
     "Set up Telegram so I can chat with you from the Telegram app.",
     ["TELEGRAM_BOT_TOKEN"],
     "https://hermes-agent.nousresearch.com/docs/user-guide/messaging/telegram/"),
  ch("slack", "Slack", "Hash", "Talk to your agent in any Slack workspace.",
     "Set up Slack so I can message you from my Slack workspace.",
     ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"],
     "https://hermes-agent.nousresearch.com/docs/user-guide/messaging/slack/"),
  ch("whatsapp", "WhatsApp", "MessageCircle", "Message your agent from WhatsApp.",
     "Set up WhatsApp so I can message you from WhatsApp.",
     [],
     "https://hermes-agent.nousresearch.com/docs/user-guide/messaging/whatsapp/"),
  ch("discord", "Discord", "MessageSquare", "Use your agent inside a Discord server.",
     "Set up Discord so I can interact with you from a Discord server.",
     ["DISCORD_BOT_TOKEN"],
     "https://hermes-agent.nousresearch.com/docs/user-guide/messaging/discord/"),
  ch("signal", "Signal", "Lock", "End-to-end encrypted chat with your agent.",
     "Set up Signal so I can chat with you privately from Signal.",
     ["SIGNAL_HTTP_URL"],
     "https://hermes-agent.nousresearch.com/docs/user-guide/messaging/signal/"),
  ch("matrix", "Matrix", "Hexagon", "Chat with your agent over Matrix.",
     "Set up Matrix so I can chat with you over a Matrix server.",
     ["MATRIX_HOMESERVER", "MATRIX_USER_ID"]),
  ch("imessage", "iMessage", "MessagesSquare", "Talk to your agent over iMessage (BlueBubbles).",
     "Set up iMessage via BlueBubbles so I can text you.",
     ["BLUEBUBBLES_URL"]),
  ch("sms", "SMS", "Smartphone", "Text your agent over SMS.",
     "Set up SMS so I can text you.",
     []),

  // ── Productivity / connectors ──
  {
    ...tool("gmail", "Gmail", "Mail", "Read, send, and triage your email.",
            "Connect my Gmail so you can read and send email for me.",
            "productivity", true, ["GOOGLE_OAUTH_REFRESH_TOKEN"]),
    examplePrompts: ["Summarize my unread email from today"],
  },
  {
    ...tool("google-calendar", "Google Calendar", "Calendar", "Schedule, reschedule, and reason about your day.",
            "Connect my Google Calendar so you can manage my schedule.",
            "productivity", true, ["GOOGLE_OAUTH_REFRESH_TOKEN"]),
    examplePrompts: ["What's on my calendar tomorrow?"],
  },
  tool("google-drive", "Google Drive / Docs / Sheets", "FolderOpen",
       "Read and edit your Drive, Docs, and Sheets.",
       "Connect my Google Drive so you can work with my Docs and Sheets.",
       "productivity", true, ["GOOGLE_OAUTH_REFRESH_TOKEN"]),

  // ── Knowledge ──
  {
    ...tool("web-search", "Web search", "Search", "Search the web and read pages.",
            "Make sure web search is set up and tell me how to use it.",
            "knowledge", false),
    examplePrompts: ["What's the latest news on…"],
  },
  tool("wikipedia", "Wikipedia", "BookOpen", "Look up facts and summaries.",
       "Show me how to ask you to look things up on Wikipedia.", "knowledge"),
  {
    ...tool("youtube-transcripts", "YouTube transcripts", "Youtube",
            "Summarize and quote any YouTube video.",
            "Install the YouTube transcript skill so you can summarize videos.",
            "knowledge"),
    examplePrompts: ["Summarize this YouTube video: <url>"],
  },

  // ── Computer ──
  tool("filesystem", "Files & folders", "HardDrive",
       "Read, write, and organize files on your computer.",
       "Walk me through how you handle files on my computer and what I should approve.",
       "computer"),
  tool("terminal", "Terminal commands", "Terminal",
       "Run shell commands with your approval.",
       "Show me how to safely let you run terminal commands.",
       "computer"),
  tool("browser-automation", "Browser automation", "Globe",
       "Open pages, fill forms, take screenshots.",
       "Set up browser automation so you can load pages and interact with the web for me.",
       "computer", true),

  // ── Media ──
  tool("image-generation", "Image generation", "Image",
       "Generate images from a description.",
       "Set up image generation and tell me how to ask for images.",
       "media"),
  tool("audio-transcription", "Audio transcription", "Mic",
       "Turn voice notes and meetings into text.",
       "Install an audio transcription skill so you can transcribe recordings.",
       "media"),

  // ── Developer ──
  tool("github", "GitHub", "Github", "Read repos, open issues, and review PRs.",
       "Connect my GitHub so you can work with my repos.", "developer", true,
       ["GITHUB_TOKEN"]),
  tool("code-execution", "Run code", "Code2",
       "Execute Python or shell snippets in a sandbox.",
       "Show me how I can ask you to run a quick script for me.", "developer"),
];
