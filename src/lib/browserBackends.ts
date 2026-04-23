/**
 * Browser backend catalog.
 *
 * The agent can drive a real browser through several different providers.
 * This file is the single source of truth for:
 *   - which providers we support
 *   - what env vars / config each one needs
 *   - which one is "free" vs. a paid Ronbot upgrade
 *   - how to detect the *currently active* backend from a list of stored
 *     secret keys (mirroring Hermes' precedence rules)
 *
 * Adding a new backend is a one-entry change here plus a new step in
 * `BrowserSetupDialog`.
 */

export type BrowserBackendId =
  | 'browserbase'
  | 'camofox'
  | 'localChrome'
  | 'browserUse'
  | 'firecrawl';

export type BrowserBackendTier = 'free' | 'paid';

export interface BrowserBackend {
  id: BrowserBackendId;
  name: string;
  tagline: string;
  /** Marketing copy shown on the picker card. */
  description: string;
  /** Free or paid (paid backends gate behind a Ronbot license key). */
  tier: BrowserBackendTier;
  /** When `tier === 'paid'`, the matching id in `src/lib/licenses.ts`. */
  upgradeId?: string;
  /** Lucide icon name. */
  icon: string;
  /** A small descriptor shown in the picker (e.g. "Cloud", "Local"). */
  surface: 'cloud' | 'local' | 'manual';
  /** Env vars that must all be present to consider the backend configured. */
  requiredEnv: string[];
  /** Optional env vars (UI shows them but doesn't require them). */
  optionalEnv?: string[];
  /**
   * Backends with no env vars (Local Chrome via CDP) are "manual" — the user
   * runs `/browser connect` from the agent terminal. We mark them configured
   * via `settings.capabilityPolicy.webBrowser = "allow"` instead of secrets.
   */
  manualOnly?: boolean;
  /** Where to learn more / purchase a key. */
  docsUrl?: string;
}

export const BROWSER_BACKENDS: BrowserBackend[] = [
  {
    id: 'browserbase',
    name: 'Browserbase',
    tagline: 'Strongest anti-bot — cloud browsers with stealth, proxies & CAPTCHA solving.',
    description:
      "Cloud-hosted real browsers with built-in stealth, residential proxies, and automatic CAPTCHA solving. The most reliable option for sites that block bots. Browserbase is a paid third-party service — you'll need an account at browserbase.com.",
    tier: 'paid',
    upgradeId: 'browserbase',
    icon: 'Cloud',
    surface: 'cloud',
    requiredEnv: ['BROWSERBASE_API_KEY', 'BROWSERBASE_PROJECT_ID'],
    optionalEnv: [
      'BROWSERBASE_PROXIES',
      'BROWSERBASE_ADVANCED_STEALTH',
      'BROWSERBASE_KEEP_ALIVE',
      'BROWSERBASE_SESSION_TIMEOUT',
    ],
    docsUrl: 'https://www.browserbase.com/dashboard',
  },
  {
    id: 'camofox',
    name: 'Camofox',
    tagline: 'Free, local, self-hosted Firefox with fingerprint spoofing.',
    description:
      'A Firefox fork that spoofs its fingerprint to look like a real human browser. Self-hosted — runs on your machine, no cloud account or API keys needed. Good for most modern anti-bot detection.',
    tier: 'free',
    icon: 'Server',
    surface: 'local',
    requiredEnv: ['CAMOFOX_URL'],
    docsUrl: 'https://github.com/jo-inc/camofox-browser',
  },
  {
    id: 'localChrome',
    name: 'Local Chrome (CDP)',
    tagline: 'Use your own Chrome — keeps your existing logins & cookies.',
    description:
      "Connects to a Chrome instance on your machine using the Chrome DevTools Protocol. Best when you're already logged in to the sites Ron needs to use. Setup is CLI-only — we'll guide you through the launch command.",
    tier: 'free',
    icon: 'Chrome',
    surface: 'manual',
    requiredEnv: [],
    manualOnly: true,
  },
  {
    id: 'browserUse',
    name: 'Browser Use',
    tagline: 'Hosted agentic browser API.',
    description:
      'Cloud browser-as-a-service from Browser Use. Drop in an API key and Ron can browse without any local setup.',
    tier: 'free',
    icon: 'MousePointerClick',
    surface: 'cloud',
    requiredEnv: ['BROWSER_USE_API_KEY'],
    docsUrl: 'https://browser-use.com',
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    tagline: 'Page-extraction API — good for content scraping.',
    description:
      "Not a full browser — Firecrawl extracts page content for the agent. Useful for reading articles and docs, less useful for sites that need clicks or logins.",
    tier: 'free',
    icon: 'Flame',
    surface: 'cloud',
    requiredEnv: ['FIRECRAWL_API_KEY'],
    docsUrl: 'https://www.firecrawl.dev/app/api-keys',
  },
];

export const getBrowserBackend = (id: string): BrowserBackend | undefined =>
  BROWSER_BACKENDS.find((b) => b.id === id);

/**
 * Hermes precedence: Browserbase → Browser Use → Camofox → Firecrawl.
 * We don't include `localChrome` here because it has no detectable env var —
 * its "active" state is signaled by `settings.capabilityPolicy.webBrowser`.
 */
const PRECEDENCE: BrowserBackendId[] = [
  'browserbase',
  'browserUse',
  'camofox',
  'firecrawl',
];

export interface ActiveBackendInfo {
  backend: BrowserBackend | null;
  /** Free-form badge text, e.g. "Camofox @ localhost:9377". */
  label: string;
}

/**
 * Given the set of stored secret keys (and an optional Camofox URL value),
 * return the backend Hermes will actually use, in precedence order.
 */
export const getActiveBrowserBackend = (
  secretKeys: Iterable<string>,
  opts?: { camofoxUrl?: string | null; localChromeManual?: boolean },
): ActiveBackendInfo => {
  const set = new Set(secretKeys);
  for (const id of PRECEDENCE) {
    const backend = getBrowserBackend(id);
    if (!backend) continue;
    const allPresent = backend.requiredEnv.every((k) => set.has(k));
    if (allPresent) {
      let label = `Active: ${backend.name}`;
      if (id === 'camofox' && opts?.camofoxUrl) {
        // Pretty-print just the host:port.
        try {
          const u = new URL(opts.camofoxUrl);
          label = `Camofox @ ${u.host}`;
        } catch {
          label = `Camofox @ ${opts.camofoxUrl}`;
        }
      }
      return { backend, label };
    }
  }
  if (opts?.localChromeManual) {
    return { backend: getBrowserBackend('localChrome') ?? null, label: 'Local Chrome (manual)' };
  }
  return { backend: null, label: 'Default (no anti-bot)' };
};

/** Convenience: is *any* browser backend configured? */
export const isAnyBackendConfigured = (
  secretKeys: Iterable<string>,
  opts?: { localChromeManual?: boolean },
): boolean => getActiveBrowserBackend(secretKeys, opts).backend != null;

/**
 * OS-specific Chrome launch command for the Local Chrome backend. We auto-
 * detect at render time using `navigator.userAgent` (crude but sufficient).
 */
export const localChromeLaunchCommand = (
  os: 'mac' | 'windows' | 'linux',
): string => {
  switch (os) {
    case 'mac':
      return `/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome \\\n  --remote-debugging-port=9222 \\\n  --user-data-dir="$HOME/.ronbot-chrome"`;
    case 'windows':
      return `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" ^\n  --remote-debugging-port=9222 ^\n  --user-data-dir="%USERPROFILE%\\.ronbot-chrome"`;
    case 'linux':
    default:
      return `google-chrome \\\n  --remote-debugging-port=9222 \\\n  --user-data-dir="$HOME/.ronbot-chrome"`;
  }
};

export const detectOS = (): 'mac' | 'windows' | 'linux' => {
  if (typeof navigator === 'undefined') return 'linux';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'mac';
  if (ua.includes('win')) return 'windows';
  return 'linux';
};

export const camofoxDockerSnippet = (): string =>
  `docker run -d --name camofox -p 9377:9377 ghcr.io/jo-inc/camofox-browser:latest`;

export const camofoxGitSnippet = (): string =>
  `git clone https://github.com/jo-inc/camofox-browser.git\ncd camofox-browser\n./run.sh`;
