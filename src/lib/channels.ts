/**
 * Channels catalog — messaging gateways the agent can speak through.
 *
 * Names, env vars, and setup steps are aligned with the official
 * Hermes messaging docs:
 *   https://hermes-agent.nousresearch.com/docs/user-guide/messaging/
 *
 * Each channel declares the env-var secrets it needs, where to find them,
 * and copy-paste-ready setup instructions for the wizard. The wizard
 * writes secrets to the OS keychain and materialises them into
 * `~/.hermes/.env` so `hermes gateway` can pick them up.
 *
 * Security: Hermes denies unknown senders unless `WHATSAPP_ALLOWED_USERS`,
 * `*`, or `WHATSAPP_ALLOW_ALL_USERS=true` is set (see official WhatsApp docs).
 * Defaults favour novice self-chat + open testing (`*`), with an optional
 * strict E.164 allowlist in the wizard.
 */

/**
 * Accepts identifiers that Hermes recognises in `WHATSAPP_ALLOWED_USERS`:
 *   - E.164 digits (no +): `15551234567`
 *   - WhatsApp `@lid` JID:  `112966246649933@lid`
 *   - WhatsApp standard JID: `15551234567@s.whatsapp.net`
 *
 * Hermes compares stored allowlist entries verbatim against the JID emitted
 * by Baileys, so we keep the original text — we only validate the shape.
 */
export const isValidWhatsAppAllowEntry = (value: string): boolean => {
  const v = (value || '').trim();
  if (!v) return false;
  if (/^[1-9]\d{6,14}$/.test(v)) return true;
  if (/^\d{6,20}@lid$/.test(v)) return true;
  if (/^\d{6,20}@s\.whatsapp\.net$/.test(v)) return true;
  return false;
};

import type { LucideIcon } from 'lucide-react';
import { Send, MessageSquare, Phone, Hash, Lock } from 'lucide-react';

export type ChannelTier = 'free' | 'paid';

export interface ChannelCredential {
  /** Canonical UPPER_SNAKE_CASE env var name. Must exist in secretPresets.ts. */
  envVar: string;
  /** Display label in the wizard form. */
  label: string;
  /** Hint shown under the input (e.g. example value, where it comes from). */
  hint: string;
  /** Render as `password` (masked) or `text`. Default password. */
  inputType?: 'password' | 'text';
  /** True if this credential is optional (e.g. SMTP_PORT defaults to 587). */
  optional?: boolean;
  /**
   * Credential kind. Defaults to 'input' (rendered as a text/password field).
   * - 'hidden': not shown in the UI; the wizard auto-writes `defaultValue`.
   * - 'choice': rendered as a radio group of `choices`; user picks one.
   */
  kind?: 'input' | 'hidden' | 'choice';
  /** Default/auto value (used by 'hidden' and as initial selection for 'choice'). */
  defaultValue?: string;
  /** Options for 'choice' kind. */
  choices?: { value: string; label: string; description?: string }[];
}

export interface ChannelSetupStep {
  /** Short bold title for the step. */
  title: string;
  /** Body copy — 1–3 plain-English sentences. */
  body: string;
  /** Optional external URL the user clicks ("Open in browser"). */
  link?: { label: string; url: string };
}

export interface Channel {
  /** Stable id, also the gateway name in `~/.hermes/config.yaml`. */
  id: 'telegram' | 'slack' | 'whatsapp' | 'discord' | 'signal';
  /** Display name. */
  name: string;
  /** One-line tagline shown on the card. */
  tagline: string;
  /** Free or paid (paid requires unlocked upgrade). */
  tier: ChannelTier;
  /** When tier === 'paid', the upgrade id required to unlock. */
  upgradeId?: string;
  /** Lucide icon shown on the card. */
  icon: LucideIcon;
  /** Approx. setup difficulty for the user (display only). */
  difficulty: 'Easy' | 'Medium' | 'Advanced';
  /** Step-by-step instructions shown in wizard step 2. */
  setupSteps: ChannelSetupStep[];
  /** Credentials the wizard collects in step 3 → secrets store. */
  credentials: ChannelCredential[];
  /** What "test" does in step 4 — short copy shown on the test screen. */
  testHint: string;
  /**
   * Env var names the "Reset channel" action should strip from
   * `~/.hermes/.env` (and from the secrets store). Defaults to all
   * `credentials[].envVar` when omitted, but can be overridden if a
   * channel writes auxiliary keys not collected as credentials.
   */
  resetEnvVars?: string[];
  /**
   * Extra warning shown in the reset confirmation dialog. Use for
   * channels with state Ronbot can't fully clean (e.g. signal-cli).
   */
  resetCaveat?: string;
}

export const CHANNELS: Channel[] = [
  // ─── Telegram ─────────────────────────────────────────────────────
  {
    id: 'telegram',
    name: 'Telegram',
    tagline: 'Chat with your agent from any phone.',
    tier: 'free',
    icon: Send,
    difficulty: 'Easy',
    setupSteps: [
      {
        title: 'Open the official Hermes Telegram guide',
        body: "Follow Hermes' channel-specific Telegram checklist if you want a canonical reference while setting up.",
        link: { label: 'Hermes Telegram docs', url: 'https://hermes-agent.nousresearch.com/docs/user-guide/messaging/telegram/' },
      },
      {
        title: 'Open BotFather in Telegram',
        body: "BotFather is Telegram's official tool for creating bots. Open it and send /newbot.",
        link: { label: 'Open @BotFather', url: 'https://t.me/BotFather' },
      },
      {
        title: 'Pick a name and username',
        body: "BotFather will ask for a display name (anything) then a username that must end in 'bot' (e.g. ron_my_agent_bot).",
      },
      {
        title: 'Copy the bot token',
        body: "BotFather replies with a token like 1234567890:ABCdef-ghIJkl. Copy it. Anyone with this token controls the bot — keep it secret.",
      },
      {
        title: 'Find your Telegram user ID',
        body: "Open @userinfobot in Telegram and send any message — it replies with your numeric user ID. You'll paste this as the allowed user so the bot only listens to you.",
        link: { label: 'Open @userinfobot', url: 'https://t.me/userinfobot' },
      },
      {
        title: 'Using the bot in groups? Check privacy mode',
        body: "Hermes bots in groups only see every message if Telegram privacy mode is off for your bot, or if the bot is a group admin. Otherwise it only sees slash commands and replies to itself. After changing privacy in BotFather, remove and re-add the bot to the group so Telegram picks up the change.",
        link: { label: 'Hermes Telegram docs (groups)', url: 'https://hermes-agent.nousresearch.com/docs/user-guide/messaging/telegram/' },
      },
    ],
    credentials: [
      { envVar: 'TELEGRAM_BOT_TOKEN', label: 'Bot token', hint: 'Looks like 1234567890:ABCdef…' },
      {
        envVar: 'TELEGRAM_ALLOWED_USERS',
        label: 'Allowed Telegram user IDs',
        hint: 'Your numeric ID from @userinfobot. Comma-separated for multiple.',
        inputType: 'text',
      },
    ],
    testHint:
      "We'll verify the token with Telegram's API and confirm only the listed users can message the bot.",
    resetEnvVars: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_USERS'],
  },

  // ─── Slack ────────────────────────────────────────────────────────
  {
    id: 'slack',
    name: 'Slack',
    tagline: "Add your agent to your team's workspace.",
    tier: 'free',
    icon: Hash,
    difficulty: 'Medium',
    setupSteps: [
      {
        title: 'Fastest path: Hermes-generated manifest (recommended if you use Hermes on the command line)',
        body: "Hermes can write a complete Slack app manifest (scopes, events, slash commands, Socket Mode) to a JSON file under your Hermes config folder. In Slack: Create New App → From an app manifest → paste that JSON. If you only use Ronbot here, skip this and create the app from scratch in the next step.",
        link: { label: 'Hermes Slack setup (manifest)', url: 'https://hermes-agent.nousresearch.com/docs/user-guide/messaging/slack/' },
      },
      {
        title: 'Create a new Slack app (from scratch)',
        body: "On api.slack.com/apps click Create New App → From scratch. Name it after your agent and pick the workspace to install it in.",
        link: { label: 'Open api.slack.com/apps', url: 'https://api.slack.com/apps' },
      },
      {
        title: 'Add bot scopes',
        body: "Under OAuth & Permissions → Bot Token Scopes, add: chat:write, app_mentions:read, channels:history, channels:read, groups:history, im:history, im:read, im:write, users:read, files:read, files:write. Optional: groups:read for private channel metadata. Channel history scopes are required if you want the bot in channels, not only DMs.",
        link: { label: 'Hermes scope checklist', url: 'https://hermes-agent.nousresearch.com/docs/user-guide/messaging/slack/' },
      },
      {
        title: 'Enable Socket Mode',
        body: "Under 'Socket Mode' toggle it on, then generate an App-Level Token with the connections:write scope. You'll get an xapp- token — copy it.",
      },
      {
        title: 'Subscribe to events',
        body: "Under 'Event Subscriptions' toggle Enable Events on, then under 'Subscribe to bot events' add: message.im, message.channels, message.groups, app_mention. Save changes.",
      },
      {
        title: 'Enable the Messages tab',
        body: "Under 'App Home' → 'Show Tabs' toggle the Messages Tab on, and tick 'Allow users to send Slash commands and messages from the messages tab'. Without this, DMs are blocked.",
      },
      {
        title: 'Install to workspace and copy the bot token',
        body: "Click 'Install to Workspace' at the top and approve. You'll get a Bot User OAuth Token starting with xoxb-. Copy both that and the xapp- App-Level Token.",
      },
      {
        title: 'Copy your Slack Member ID',
        body: "Click your own avatar → View full profile → ⋮ → Copy member ID. It looks like U01ABC2DEF3. You'll paste this as the allowed user.",
      },
      {
        title: 'Invite the bot to each channel',
        body: "After the gateway is running, type /invite @YourAppName in every channel (public or private) where you want the bot to read and reply. Slack does not auto-join the bot to channels.",
        link: { label: 'Hermes Slack docs', url: 'https://hermes-agent.nousresearch.com/docs/user-guide/messaging/slack/' },
      },
    ],
    credentials: [
      { envVar: 'SLACK_BOT_TOKEN', label: 'Bot token', hint: 'Starts with xoxb-' },
      { envVar: 'SLACK_APP_TOKEN', label: 'App-level token', hint: 'Starts with xapp-' },
      {
        envVar: 'SLACK_ALLOWED_USERS',
        label: 'Allowed Slack member IDs',
        hint: 'e.g. U01ABC2DEF3 — comma-separated for multiple',
        inputType: 'text',
      },
    ],
    testHint: "We'll verify both tokens are accepted by Slack and confirm the allowlist is set.",
    resetEnvVars: ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'SLACK_ALLOWED_USERS'],
  },

  // ─── WhatsApp (Baileys / WhatsApp Web) ────────────────────────────
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    tagline: "Chat with your agent on the world's biggest messenger.",
    tier: 'free',
    icon: Phone,
    difficulty: 'Medium',
    // Wizard no longer shows a separate “setup checklist” step for WhatsApp;
    // intro + Hermes docs link live in ChannelWizard. Keep empty for type consistency.
    setupSteps: [],
    credentials: [
      {
        envVar: 'WHATSAPP_ENABLED',
        label: 'Enable WhatsApp',
        hint: 'Automatically set to true during setup.',
        kind: 'hidden',
        defaultValue: 'true',
      },
      {
        envVar: 'WHATSAPP_MODE',
        label: 'How this WhatsApp number is used',
        hint: 'Must match the phone number you will link in the next step.',
        kind: 'choice',
        defaultValue: 'self-chat',
        choices: [
          {
            value: 'self-chat',
            label: 'Personal number (self-chat)',
            description:
              'You link your own WhatsApp. You usually chat with yourself in WhatsApp to talk to the agent. Simplest for solo use.',
          },
          {
            value: 'bot',
            label: 'Dedicated number (bot)',
            description:
              'A separate phone/SIM used only for the agent. Better if others will message this number. Same Hermes flow; you still scan a QR once.',
          },
        ],
      },
      {
        envVar: 'WHATSAPP_ALLOWED_USERS',
        label: 'Who may message the agent',
        hint: 'Hermes format: E.164 digits only (country code first, no +), comma-separated.',
        inputType: 'text',
        defaultValue: '',
      },
    ],
    testHint:
      "First link WhatsApp using the QR code in this window. After your phone shows the device as linked, we verify the saved session and run a quick gateway check.",
    resetEnvVars: ['WHATSAPP_ENABLED', 'WHATSAPP_MODE', 'WHATSAPP_ALLOWED_USERS', 'WHATSAPP_ALLOW_ALL_USERS', 'WHATSAPP_DEBUG'],
    resetCaveat:
      "Reset also wipes the local WhatsApp session and bridge auth files so the next pairing starts with a fresh QR code. Your phone may keep the linked-device entry until you remove it from WhatsApp → Settings → Linked Devices.",
  },

  // ─── Discord ──────────────────────────────────────────────────────
  {
    id: 'discord',
    name: 'Discord',
    tagline: 'Talk to your agent in any Discord server or DM.',
    tier: 'free',
    icon: MessageSquare,
    difficulty: 'Medium',
    setupSteps: [
      {
        title: 'Open the official Hermes Discord guide',
        body: "Use the Hermes Discord guide as the source of truth for required bot intents and permissions.",
        link: { label: 'Hermes Discord docs', url: 'https://hermes-agent.nousresearch.com/docs/user-guide/messaging/discord/' },
      },
      {
        title: 'Create a Discord application',
        body: "On the Discord developer portal click 'New Application' and name it after your agent.",
        link: {
          label: 'Open Discord developer portal',
          url: 'https://discord.com/developers/applications',
        },
      },
      {
        title: 'Add a bot user',
        body: "On the left sidebar click 'Bot' → 'Add Bot'.",
      },
      {
        title: 'Enable the privileged intents',
        body: "Still on the Bot page, scroll to 'Privileged Gateway Intents' and enable BOTH 'Server Members Intent' and 'Message Content Intent'. Without Message Content, the bot literally cannot read what you typed. Click Save Changes.",
      },
      {
        title: 'Reset and copy the bot token',
        body: "Under 'Token' click 'Reset Token' and copy it immediately — Discord only shows it once. Anyone with this token controls the bot.",
      },
      {
        title: 'Invite the bot to your server',
        body: "Under OAuth2 → URL Generator tick bot and applications.commands, then under Bot Permissions tick: View Channels, Send Messages, Read Message History, Embed Links, Attach Files, Send Messages in Threads, Add Reactions. Open the generated URL and add the bot to a server you own. Hermes needs Message Content Intent (already enabled above) to read what people type.",
        link: { label: 'Hermes Discord docs', url: 'https://hermes-agent.nousresearch.com/docs/user-guide/messaging/discord/' },
      },
      {
        title: 'Find your Discord user ID',
        body: "In Discord open Settings → Advanced → enable Developer Mode. Then right-click your own username anywhere → Copy User ID. It's a long number like 284102345871466496.",
      },
    ],
    credentials: [
      { envVar: 'DISCORD_BOT_TOKEN', label: 'Bot token', hint: 'Long string with dots' },
      {
        envVar: 'DISCORD_ALLOWED_USERS',
        label: 'Allowed Discord user IDs',
        hint: 'Your user ID. Comma-separated for multiple.',
        inputType: 'text',
      },
    ],
    testHint:
      "We'll verify Discord accepts the token by fetching the bot's profile, and confirm the allowlist is set.",
    resetEnvVars: ['DISCORD_BOT_TOKEN', 'DISCORD_ALLOWED_USERS'],
  },

  // ─── Signal ───────────────────────────────────────────────────────
  {
    id: 'signal',
    name: 'Signal',
    tagline: 'End-to-end encrypted chat with your agent.',
    tier: 'free',
    icon: Lock,
    difficulty: 'Advanced',
    setupSteps: [
      {
        title: 'Advanced: Ronbot does not set up Signal for you',
        body: "Signal uses the separate signal-cli program plus Java 17+, account linking, and a long-running HTTP daemon. Ronbot only stores the URL, account, and allowlist Hermes expects once you have completed those steps outside this app. If you want a guided flow, use Hermes gateway setup or follow the Hermes Signal guide in a browser.",
        link: { label: 'Hermes Signal docs', url: 'https://hermes-agent.nousresearch.com/docs/user-guide/messaging/signal/' },
      },
      {
        title: 'Install Java 17+ and signal-cli',
        body: "Install a Java 17 or newer runtime, then install signal-cli using the method that matches your system (for example Homebrew on macOS, or the official release archive on Linux — Hermes documents both). Ronbot cannot install or update signal-cli automatically.",
        link: {
          label: 'signal-cli releases',
          url: 'https://github.com/AsamK/signal-cli/releases',
        },
      },
      {
        title: 'Link this device as a secondary Signal client',
        body: "Linking shows a QR code on the machine where signal-cli runs. Use the Hermes guide to complete linking and to confirm your account phone number is in standard international format.",
        link: { label: 'Hermes: link account', url: 'https://hermes-agent.nousresearch.com/docs/user-guide/messaging/signal/' },
      },
      {
        title: 'Run the signal-cli HTTP daemon',
        body: "Hermes talks to Signal over HTTP to the daemon. The process must stay running in the background (for example as a user service on Linux or macOS). Use the default URL here unless you changed the listen address in signal-cli.",
        link: { label: 'Hermes Signal docs (daemon)', url: 'https://hermes-agent.nousresearch.com/docs/user-guide/messaging/signal/' },
      },
      {
        title: 'Choose who can message the bot',
        body: "Enter the phone numbers (E.164, with the leading +) that are allowed to talk to the agent. Hermes recommends an allowlist or DM pairing for safety. Optional Hermes variables for groups or broad access are listed in the official docs.",
        link: { label: 'Hermes: access control', url: 'https://hermes-agent.nousresearch.com/docs/user-guide/messaging/signal/' },
      },
    ],
    credentials: [
      {
        envVar: 'SIGNAL_HTTP_URL',
        label: 'signal-cli HTTP endpoint',
        hint: 'Default http://127.0.0.1:8080',
        inputType: 'text',
      },
      {
        envVar: 'SIGNAL_ACCOUNT',
        label: 'Bot phone number',
        hint: 'E.164 format, e.g. +15551234567',
        inputType: 'text',
      },
      {
        envVar: 'SIGNAL_ALLOWED_USERS',
        label: 'Allowed phone numbers',
        hint: 'E.164 format, comma-separated. e.g. +15551234567,+15559876543',
        inputType: 'text',
      },
    ],
    testHint:
      "We'll use curl to hit the signal-cli health endpoint Hermes documents. Install curl in the same environment as Hermes if this step fails.",
    resetEnvVars: ['SIGNAL_HTTP_URL', 'SIGNAL_ACCOUNT', 'SIGNAL_ALLOWED_USERS'],
    resetCaveat:
      "Ronbot does not control signal-cli. Resetting here only clears the env keys Hermes reads — the linked-device state inside signal-cli stays until you remove it with `signal-cli -a <number> removeDevice` or by re-linking.",
  },
];

export const getChannel = (id: string): Channel | undefined =>
  CHANNELS.find((c) => c.id === id);
