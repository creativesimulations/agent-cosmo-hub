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
 * Security: every Hermes platform denies all users by default unless an
 * `*_ALLOWED_USERS` env var is set or the user is approved via DM
 * pairing. We always collect the allowlist credential up-front so the
 * agent works on first message instead of silently dropping everything.
 */

import type { LucideIcon } from 'lucide-react';
import { Send, MessageSquare, Mail, Phone, Hash, Lock } from 'lucide-react';

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
  id: 'telegram' | 'slack' | 'email' | 'whatsapp' | 'discord' | 'signal';
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
        title: 'Create a new Slack app',
        body: "On api.slack.com/apps click 'Create New App' → 'From scratch'. Name it after your agent and pick the workspace to install it in.",
        link: { label: 'Open api.slack.com/apps', url: 'https://api.slack.com/apps' },
      },
      {
        title: 'Add bot scopes',
        body: "Under 'OAuth & Permissions' add bot scopes: app_mentions:read, chat:write, im:history, im:read, im:write, groups:history, mpim:history, channels:history, users:read, files:read, files:write.",
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
  },

  // ─── Email ────────────────────────────────────────────────────────
  {
    id: 'email',
    name: 'Email',
    tagline: 'Email your agent from anywhere.',
    tier: 'free',
    icon: Mail,
    difficulty: 'Easy',
    setupSteps: [
      {
        title: 'Pick (or create) a dedicated email address for your agent',
        body: "Don't use your personal email — the agent stores the password and reads the inbox. We recommend a free Gmail or a dedicated address like ron@yourdomain.com.",
      },
      {
        title: 'Enable IMAP',
        body: "On Gmail: Settings → 'Forwarding and POP/IMAP' → enable IMAP. Most other providers have IMAP on by default.",
      },
      {
        title: 'Generate an app password',
        body: "If your provider supports 2FA (Gmail does, and requires it), create an app-specific password instead of using your normal one.",
        link: { label: 'Gmail app passwords', url: 'https://myaccount.google.com/apppasswords' },
      },
      {
        title: 'Note your IMAP and SMTP servers',
        body: "Gmail: imap.gmail.com / smtp.gmail.com. iCloud: imap.mail.me.com / smtp.mail.me.com. Outlook: outlook.office365.com / smtp.office365.com.",
      },
    ],
    credentials: [
      {
        envVar: 'EMAIL_ADDRESS',
        label: "Agent's email address",
        hint: 'e.g. ron@yourdomain.com',
        inputType: 'text',
      },
      { envVar: 'EMAIL_PASSWORD', label: 'Email password', hint: 'App password if you use 2FA' },
      {
        envVar: 'EMAIL_IMAP_HOST',
        label: 'IMAP server',
        hint: 'e.g. imap.gmail.com',
        inputType: 'text',
      },
      {
        envVar: 'EMAIL_SMTP_HOST',
        label: 'SMTP server',
        hint: 'e.g. smtp.gmail.com',
        inputType: 'text',
      },
      {
        envVar: 'EMAIL_IMAP_PORT',
        label: 'IMAP port',
        hint: 'Default 993',
        inputType: 'text',
        optional: true,
      },
      {
        envVar: 'EMAIL_SMTP_PORT',
        label: 'SMTP port',
        hint: 'Default 587',
        inputType: 'text',
        optional: true,
      },
      {
        envVar: 'EMAIL_ALLOWED_USERS',
        label: 'Allowed sender addresses',
        hint: 'Comma-separated. Without this, the bot ignores everyone except via pairing.',
        inputType: 'text',
      },
    ],
    testHint:
      "We'll verify IMAP and SMTP both connect with the credentials and confirm the allowlist is set.",
  },

  // ─── WhatsApp (Baileys / WhatsApp Web) ────────────────────────────
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    tagline: "Chat with your agent on the world's biggest messenger.",
    tier: 'free',
    icon: Phone,
    difficulty: 'Medium',
    setupSteps: [
      {
        title: 'Pick a phone number',
        body: "Two options: dedicate a separate phone number to the bot (recommended — cleanest UX, lower ban risk), or use your personal WhatsApp and message yourself. A second SIM, Google Voice, or a prepaid number all work.",
      },
      {
        title: 'Run the WhatsApp pairing wizard',
        body: "After enabling WhatsApp here, open a terminal and run `hermes whatsapp`. It installs the bridge dependencies (Node.js v18+ required) and shows a QR code.",
      },
      {
        title: 'Scan the QR code from your phone',
        body: "On your phone open WhatsApp → Settings → Linked Devices → Link a Device, then scan the QR code in the terminal. Hermes saves the session under ~/.hermes/platforms/whatsapp/session and reuses it across restarts.",
      },
      {
        title: 'Pick the allowed phone numbers',
        body: "Enter the phone numbers (with country code, no `+` or spaces) that are allowed to message the bot — usually just yours. Use `*` to allow everyone (not recommended).",
      },
    ],
    credentials: [
      {
        envVar: 'WHATSAPP_ENABLED',
        label: 'Enable WhatsApp',
        hint: 'Set to true to turn the WhatsApp adapter on.',
        inputType: 'text',
      },
      {
        envVar: 'WHATSAPP_MODE',
        label: 'Mode',
        hint: '"bot" for a dedicated bot number, or "self-chat" for your own number',
        inputType: 'text',
      },
      {
        envVar: 'WHATSAPP_ALLOWED_USERS',
        label: 'Allowed phone numbers',
        hint: 'e.g. 15551234567 (country code, no +). Comma-separated. Or `*` for all.',
        inputType: 'text',
      },
    ],
    testHint:
      "Pairing happens via QR code in the terminal — after you've run `hermes whatsapp` and scanned, we confirm the saved session exists.",
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
        body: "Under 'OAuth2' → 'URL Generator' tick `bot` and `applications.commands`, then under Bot Permissions tick: View Channels, Send Messages, Read Message History, Embed Links, Attach Files, Send Messages in Threads, Add Reactions. Open the generated URL and add the bot to a server you own.",
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
        title: 'Install signal-cli',
        body: "Hermes talks to Signal through the signal-cli daemon (requires Java 17+). On macOS: `brew install signal-cli`. On Linux: download the latest release from GitHub.",
        link: {
          label: 'signal-cli releases',
          url: 'https://github.com/AsamK/signal-cli/releases',
        },
      },
      {
        title: 'Link your Signal account',
        body: "Run `signal-cli link -n \"HermesAgent\"` in a terminal — it shows a QR code. On your phone open Signal → Settings → Linked Devices → Link New Device, then scan the QR.",
      },
      {
        title: 'Start the signal-cli daemon',
        body: "Run `signal-cli --account +YOURNUMBER daemon --http 127.0.0.1:8080` (replace +YOURNUMBER with your phone number in E.164 format). Keep it running — use systemd, tmux, or screen.",
      },
      {
        title: 'Choose who can message the bot',
        body: "Enter the phone numbers (E.164, with the leading `+`) that are allowed to talk to the agent. Without an allowlist, every Signal sender is denied for safety.",
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
      "We'll ping the signal-cli daemon to make sure it's running and verify the account is linked.",
  },
];

export const getChannel = (id: string): Channel | undefined =>
  CHANNELS.find((c) => c.id === id);
