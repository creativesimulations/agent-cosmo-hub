/**
 * Channels catalog — messaging gateways the agent can speak through.
 *
 * Free channels use Hermes' built-in gateway support and are configured via
 * a guided wizard that walks the user through obtaining credentials.
 * Paid channels are gated behind a one-time `Upgrade` (see ./licenses.ts).
 *
 * Each channel declares the env-var secrets it needs, where to find them,
 * and copy-paste-ready setup instructions for the wizard.
 */

import type { LucideIcon } from 'lucide-react';
import { Send, MessageSquare, Mail, Phone, Hash } from 'lucide-react';

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
  id: 'telegram' | 'slack' | 'email' | 'whatsapp' | 'discord';
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
        body: "BotFather is Telegram's official tool for creating bots. Open it and send the message /newbot.",
        link: { label: 'Open @BotFather', url: 'https://t.me/BotFather' },
      },
      {
        title: 'Pick a name and username',
        body: "BotFather will ask for a display name (e.g. 'Ron') then a username ending in 'bot' (e.g. ron_my_agent_bot).",
      },
      {
        title: 'Copy the bot token',
        body: "BotFather will reply with a token that looks like 1234567890:ABCdef-ghIJkl. Copy it — you'll paste it in the next step. Keep it secret: anyone with it controls the bot.",
      },
    ],
    credentials: [
      { envVar: 'TELEGRAM_BOT_TOKEN', label: 'Bot token', hint: 'Looks like 1234567890:ABCdef…' },
    ],
    testHint: "We'll send a test message to confirm Telegram accepts the token.",
  },
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
        body: "On the Slack API site click 'Create New App' → 'From scratch'. Name it after your agent and pick the workspace to install it in.",
        link: { label: 'Open api.slack.com/apps', url: 'https://api.slack.com/apps' },
      },
      {
        title: 'Add bot scopes and install',
        body: "Under 'OAuth & Permissions' add the scopes chat:write, im:history, channels:history. Then click 'Install to Workspace' at the top of the page.",
      },
      {
        title: 'Enable Socket Mode',
        body: "Under 'Socket Mode' toggle it on and generate an app-level token with the connections:write scope. You'll get an xapp- token.",
      },
      {
        title: 'Copy both tokens',
        body: "Copy the Bot User OAuth Token (starts with xoxb-) and the App-Level Token (starts with xapp-). Paste them in the next step.",
      },
    ],
    credentials: [
      { envVar: 'SLACK_BOT_TOKEN', label: 'Bot token', hint: 'Starts with xoxb-' },
      { envVar: 'SLACK_APP_TOKEN', label: 'App-level token', hint: 'Starts with xapp-' },
    ],
    testHint: "We'll verify both tokens are accepted by Slack's API.",
  },
  {
    id: 'email',
    name: 'Email',
    tagline: 'Email your agent from anywhere.',
    tier: 'free',
    icon: Mail,
    difficulty: 'Easy',
    setupSteps: [
      {
        title: 'Pick (or create) an email address for your agent',
        body: "We recommend a dedicated address — e.g. ron@yourdomain.com or a free Gmail. Your agent will receive messages here and reply from the same address.",
      },
      {
        title: 'Generate an app password',
        body: "For Gmail and most providers, you need an app-specific password (not your normal password). For Gmail, enable 2-step verification first, then create an app password.",
        link: { label: 'Gmail app passwords', url: 'https://myaccount.google.com/apppasswords' },
      },
      {
        title: 'Note your IMAP and SMTP servers',
        body: "Gmail: smtp.gmail.com / imap.gmail.com. iCloud: smtp.mail.me.com / imap.mail.me.com. Outlook: smtp-mail.outlook.com / outlook.office365.com.",
      },
    ],
    credentials: [
      { envVar: 'SMTP_HOST', label: 'SMTP server', hint: 'e.g. smtp.gmail.com', inputType: 'text' },
      { envVar: 'SMTP_PORT', label: 'SMTP port', hint: 'Usually 587', inputType: 'text', optional: true },
      { envVar: 'SMTP_USER', label: 'Email address', hint: 'The agent\'s email', inputType: 'text' },
      { envVar: 'SMTP_PASS', label: 'App password', hint: 'Generated above' },
      { envVar: 'IMAP_HOST', label: 'IMAP server', hint: 'e.g. imap.gmail.com', inputType: 'text' },
      { envVar: 'IMAP_USER', label: 'IMAP user', hint: 'Usually same as email', inputType: 'text' },
      { envVar: 'IMAP_PASS', label: 'IMAP password', hint: 'Usually same app password' },
    ],
    testHint: "We'll send a test email to the agent's own address to confirm SMTP and IMAP both work.",
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    tagline: 'Reach your agent on the world\'s biggest messenger.',
    tier: 'free',
    icon: Phone,
    difficulty: 'Advanced',
    setupSteps: [
      {
        title: 'Create a Meta Developer account',
        body: "WhatsApp Business is run by Meta. Sign up for a free developer account if you don't already have one.",
        link: { label: 'Open Meta for Developers', url: 'https://developers.facebook.com/' },
      },
      {
        title: 'Create a new app and add WhatsApp',
        body: "From your dashboard click 'Create App' → 'Other' → 'Business'. Once created, on the app's page click 'Add product' and pick WhatsApp.",
      },
      {
        title: 'Copy the test phone number ID and access token',
        body: "Meta gives you a free test number you can use to message up to 5 verified phone numbers. Copy the Phone Number ID and the temporary Access Token from the API Setup page.",
      },
      {
        title: 'Pick a verify token',
        body: "Make up a long random string (any letters and numbers). You'll paste this into Meta's webhook config to prove our agent owns the webhook URL.",
      },
      {
        title: 'Add your phone number as a recipient',
        body: "Still on the API Setup page, under 'To', click 'Manage phone number list' and add your own phone number as a recipient. Confirm the code Meta texts you.",
      },
    ],
    credentials: [
      { envVar: 'WHATSAPP_PHONE_NUMBER_ID', label: 'Phone number ID', hint: 'A long number from API Setup', inputType: 'text' },
      { envVar: 'WHATSAPP_ACCESS_TOKEN', label: 'Access token', hint: 'Starts with EAA…' },
      { envVar: 'WHATSAPP_VERIFY_TOKEN', label: 'Webhook verify token', hint: 'The string you made up' },
    ],
    testHint: "We'll send a 'hello' WhatsApp message to your verified phone number.",
  },
  {
    id: 'discord',
    name: 'Discord',
    tagline: 'Talk to your agent in any Discord server.',
    tier: 'paid',
    upgradeId: 'discord',
    icon: MessageSquare,
    difficulty: 'Medium',
    setupSteps: [
      {
        title: 'Create a Discord application',
        body: "On the Discord developer portal, click 'New Application'. Name it after your agent.",
        link: { label: 'Open Discord developer portal', url: 'https://discord.com/developers/applications' },
      },
      {
        title: 'Add a bot user',
        body: "On the left sidebar click 'Bot' → 'Add Bot'. Under 'Privileged Gateway Intents' enable 'Message Content Intent'.",
      },
      {
        title: 'Copy the bot token',
        body: "Click 'Reset Token' and copy the value. Anyone with this token controls the bot — keep it secret.",
      },
      {
        title: 'Invite the bot to your server',
        body: "Under 'OAuth2' → 'URL Generator' tick 'bot' and 'applications.commands', then under 'Bot Permissions' tick 'Send Messages' and 'Read Message History'. Open the generated URL and add the bot to a server you own.",
      },
    ],
    credentials: [
      { envVar: 'DISCORD_BOT_TOKEN', label: 'Bot token', hint: 'Long string with dots' },
    ],
    testHint: "We'll verify Discord accepts the token by fetching the bot's profile.",
  },
];

export const getChannel = (id: string): Channel | undefined =>
  CHANNELS.find((c) => c.id === id);
