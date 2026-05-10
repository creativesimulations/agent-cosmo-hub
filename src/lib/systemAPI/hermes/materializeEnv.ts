import { agentLogs } from '../../diagnostics';
import { secretsStore } from '../secretsStore';
import { HERMES_ENV } from './constants';
import { readHermesFile, writeHermesFile } from './files';

const quoteEnvValue = (value: string) =>
  `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export async function materializeHermesEnv(): Promise<{
  success: boolean;
  count?: number;
  missing?: string[];
  error?: string;
}> {
  const { keys, backend } = await secretsStore.list();
  const secretEntries = (await Promise.all(
    keys.map(async (key) => [key, await secretsStore.get(key)] as const),
  )).filter(([, value]) => value !== '');

  agentLogs.push({
    source: 'system',
    level: secretEntries.length === 0 ? 'warn' : 'info',
    summary: `materializeHermesEnv: ${secretEntries.length}/${keys.length} non-empty key(s) from ${backend}`,
    detail:
      secretEntries.length === 0
        ? `Credential store has ${keys.length} key entries but all values are empty. Re-add your API keys in the Secrets tab — the OS credential backend (${backend}) may not be persisting them.`
        : `Keys to write: ${secretEntries.map(([k, v]) => `${k}(${v.length}c)`).join(', ')}`,
  });

  const isPlaceholderLine = (line: string): boolean => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return false;
    const eq = t.indexOf('=');
    if (eq < 1) return false;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!v) return true;
    return /^(your[-_]|<your|placeholder|changeme|xxx|sk-\.{3}|example|insert[-_]|todo$)/i.test(v);
  };

  const managedKeys = new Set(secretEntries.map(([key]) => key));
  const VALID_ENV = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const droppedInvalid: string[] = [];
  const existing = await readHermesFile(HERMES_ENV);
  const preserved =
    existing.success && existing.content
      ? existing.content
          .split('\n')
          .filter((line) => {
            const trimmed = line.trim();
            if (!trimmed) return true;
            if (trimmed.startsWith('#')) {
              if (/Copy this file to \.env/i.test(trimmed)) return false;
              if (/fill in your API keys/i.test(trimmed)) return false;
              if (/Hermes Agent Environment Configuration/i.test(trimmed)) return false;
              return true;
            }
            const eqIndex = trimmed.indexOf('=');
            if (eqIndex < 1) return true;
            const k = trimmed.slice(0, eqIndex).trim();
            if (!VALID_ENV.test(k)) {
              droppedInvalid.push(k);
              return false;
            }
            if (managedKeys.has(k)) return false;
            if (isPlaceholderLine(line)) return false;
            return true;
          })
          .join('\n')
          .replace(/\n+$/, '')
      : '';

  if (droppedInvalid.length > 0) {
    agentLogs.push({
      source: 'system',
      level: 'warn',
      summary: `materializeHermesEnv: purged ${droppedInvalid.length} invalid env var line(s)`,
      detail: `These names contain characters bash can't parse (hyphens, spaces, etc.) and would crash the agent: ${droppedInvalid.join(', ')}. They've been removed from ~/.hermes/.env.`,
    });
  }

  const managed = secretEntries.map(([key, value]) => `${key}=${quoteEnvValue(value)}`).join('\n');
  const sections = [
    preserved,
    managed ? '# ─── Managed by Ronbot (do not edit by hand) ───' : '',
    managed,
  ].filter(Boolean);

  if (sections.length === 0) {
    agentLogs.push({
      source: 'system',
      level: 'warn',
      summary: 'materializeHermesEnv: nothing to write (no secrets, no preserved lines)',
    });
    return { success: true, count: 0 };
  }

  const result = await writeHermesFile(HERMES_ENV, `${sections.join('\n')}\n`, '600');
  if (!result.success) {
    return { success: false, count: secretEntries.length, error: result.error };
  }

  const verify = await readHermesFile(HERMES_ENV);
  if (!verify.success || !verify.content) {
    return {
      success: false,
      count: secretEntries.length,
      error: 'Verification failed: could not read back ~/.hermes/.env',
    };
  }
  const written: Record<string, string> = {};
  for (const line of verify.content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    written[t.slice(0, eq).trim()] = v;
  }
  const missing = secretEntries
    .filter(([k]) => !(written[k] && written[k].length > 0))
    .map(([k]) => k);
  if (missing.length > 0) {
    return {
      success: false,
      count: secretEntries.length,
      missing,
      error: `Verification failed: ${missing.length} key(s) missing from ~/.hermes/.env after write: ${missing.join(', ')}`,
    };
  }
  agentLogs.push({
    source: 'system',
    level: 'info',
    summary: `materializeHermesEnv: ✓ wrote ${secretEntries.length} key(s) to ~/.hermes/.env`,
  });
  return { success: true, count: secretEntries.length };
}
