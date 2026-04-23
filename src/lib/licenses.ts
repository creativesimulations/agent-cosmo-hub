/**
 * Upgrades & licensing — generic, reusable system for one-time paid unlocks.
 *
 * Design goals:
 *  - One-time purchase, lifetime access (no subscriptions, no phone-home).
 *  - Offline verification: license keys are Ed25519-signed by the developer's
 *    private key. The matching public key is embedded in the app and used to
 *    verify keys without ever contacting a server.
 *  - Reusable: today it gates "Discord channel" — tomorrow the same code path
 *    handles "BRAID upgrade" or any other paid customization.
 *
 * License key format (single string the user pastes):
 *
 *     <UPGRADE_ID>.<PAYLOAD_B64URL>.<SIG_B64URL>
 *
 * where PAYLOAD is JSON like `{"u":"discord","e":"buyer@example.com","t":1729...}`
 * and SIG is the Ed25519 signature of `<UPGRADE_ID>.<PAYLOAD_B64URL>`.
 *
 * The placeholder public key below is a PLACEHOLDER. Swap it for your real
 * public key when you generate your first signing keypair (see
 * scripts/generate-license.md when you create it).
 */

import { secretsStore } from './systemAPI/secretsStore';
import { agentLogs } from './diagnostics';

export interface Upgrade {
  /** Stable id used in license keys, secret store key, and URLs. */
  id: string;
  /** Display name shown in the UI. */
  name: string;
  /** One-line value proposition. */
  tagline: string;
  /** Longer description shown on the upgrade card. */
  description: string;
  /** Where users buy the upgrade. Placeholder until the real store URL exists. */
  buyUrl: string;
  /** Approx. price shown on the card (display only — real price is on website). */
  priceLabel: string;
}

/** All purchasable upgrades. Add new entries here as you build more. */
export const UPGRADES: Upgrade[] = [
  {
    id: 'discord',
    name: 'Discord channel',
    tagline: 'Talk to your agent from any Discord server or DM.',
    description:
      "Discord setup requires creating a developer application, configuring intents, and inviting a bot — fiddly for non-technical users. This upgrade unlocks a guided wizard that does it in under 5 minutes, plus lifetime updates.",
    buyUrl: 'https://ronbot.com/upgrades/discord', // TODO: replace with real URL
    priceLabel: 'One-time · $19',
  },
  {
    id: 'browserbase',
    name: 'Browserbase browser',
    tagline: 'Strongest anti-bot — cloud browsers with stealth, proxies & CAPTCHA solving.',
    description:
      "Browserbase is a paid third-party cloud browser with built-in stealth, residential proxies, and CAPTCHA solving — the most reliable backend for sites that block bots. This upgrade unlocks the in-app setup wizard so Ron can use Browserbase as its browser backend without you touching a config file. Camofox and Local Chrome remain free.",
    buyUrl: 'https://ronbot.com/upgrades/browserbase', // TODO: replace with real URL
    priceLabel: 'One-time · $29',
  },
];

/** Look up an upgrade by id. */
export const getUpgrade = (id: string): Upgrade | undefined =>
  UPGRADES.find((u) => u.id === id);

/** Build the secret-store key under which a license key for `id` is saved. */
const licenseKeyName = (id: string) => `LICENSE_${id.toUpperCase()}`;

/**
 * Embedded Ed25519 public key (raw 32 bytes, base64url).
 *
 * ⚠️  PLACEHOLDER — replace with your real public key when you generate your
 *     signing keypair. Until then, `verifyLicenseSignature` will return false
 *     for all keys, so no one can unlock paid features by accident.
 */
const PUBLIC_KEY_B64URL = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/**
 * Developer "skeleton key" — unlocks ANY upgrade without a real signed key.
 *
 * Use this during development to test paid flows without going through the
 * purchase + signing pipeline. Format: `RONBOT-MASTER-<anything>` (case-insensitive).
 *
 * The accepted prefix below is intentionally hard to type by accident, but
 * before shipping a public production build you should either:
 *  (a) replace `MASTER_KEY_PREFIX` with `null` to disable it, or
 *  (b) leave it in place if you're fine with anyone who sees this source code
 *      being able to unlock everything (it IS open in the renderer bundle).
 */
const MASTER_KEY_PREFIX = 'RONBOT-MASTER-';

const isMasterKey = (raw: string): boolean =>
  !!MASTER_KEY_PREFIX &&
  raw.trim().toUpperCase().startsWith(MASTER_KEY_PREFIX.toUpperCase()) &&
  raw.trim().length > MASTER_KEY_PREFIX.length;

const b64urlDecode = (s: string): ArrayBuffer => {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
};

const isPlaceholderKey = (): boolean => /^A+$/.test(PUBLIC_KEY_B64URL);

/**
 * Verify an Ed25519 signature for the canonical message `<upgradeId>.<payloadB64>`.
 *
 * Falls back to false (locked) when:
 *   - the embedded public key is still the placeholder (so nothing unlocks
 *     accidentally during dev),
 *   - WebCrypto can't import the key,
 *   - the signature simply doesn't verify.
 */
const verifyLicenseSignature = async (
  upgradeId: string,
  payloadB64: string,
  signatureB64: string,
): Promise<boolean> => {
  if (isPlaceholderKey()) return false;
  if (typeof crypto === 'undefined' || !crypto.subtle) return false;
  try {
    const pub = b64urlDecode(PUBLIC_KEY_B64URL);
    const sig = b64urlDecode(signatureB64);
    const msg = new TextEncoder().encode(`${upgradeId}.${payloadB64}`);
    const key = await crypto.subtle.importKey(
      'raw',
      pub,
      { name: 'Ed25519' } as unknown as AlgorithmIdentifier,
      false,
      ['verify'],
    );
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, sig, msg);
  } catch (e) {
    agentLogs.push({
      source: 'system',
      level: 'warn',
      summary: 'verifyLicenseSignature failed',
      detail: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
};

/** Parse + verify a license key string. Returns null if malformed/invalid. */
export const parseLicenseKey = async (
  raw: string,
): Promise<{ upgradeId: string; payload: Record<string, unknown> } | null> => {
  const parts = raw.trim().split('.');
  if (parts.length !== 3) return null;
  const [upgradeId, payloadB64, sigB64] = parts;
  const ok = await verifyLicenseSignature(upgradeId, payloadB64, sigB64);
  if (!ok) return null;
  try {
    const json = new TextDecoder().decode(new Uint8Array(b64urlDecode(payloadB64)));
    return { upgradeId, payload: JSON.parse(json) };
  } catch {
    return null;
  }
};

/** True if the user has unlocked the upgrade (valid key in secrets store). */
export const isUpgradeUnlocked = async (id: string): Promise<boolean> => {
  const stored = await secretsStore.get(licenseKeyName(id));
  if (!stored) return false;
  const parsed = await parseLicenseKey(stored);
  return parsed != null && parsed.upgradeId === id;
};

/**
 * Persist a license key after verifying it. Returns:
 *   ok:    key is valid for the given upgrade and was stored
 *   wrong: key is well-formed but for a DIFFERENT upgrade
 *   bad:   key is malformed or signature doesn't verify
 */
export const enterLicenseKey = async (
  upgradeId: string,
  rawKey: string,
): Promise<'ok' | 'wrong' | 'bad'> => {
  const parsed = await parseLicenseKey(rawKey);
  if (!parsed) return 'bad';
  if (parsed.upgradeId !== upgradeId) return 'wrong';
  const saved = await secretsStore.set(licenseKeyName(upgradeId), rawKey.trim());
  return saved ? 'ok' : 'bad';
};

/** Forget a stored license key (e.g. user wants to remove it). */
export const removeLicenseKey = async (upgradeId: string): Promise<boolean> =>
  secretsStore.delete(licenseKeyName(upgradeId));

/** Convenience for the "Buy" button. */
export const buyUrl = (upgradeId: string): string =>
  getUpgrade(upgradeId)?.buyUrl ?? 'https://ronbot.com';
