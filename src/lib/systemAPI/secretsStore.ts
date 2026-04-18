/**
 * Secure secrets store — talks to the Electron main process which
 * picks the best available backend:
 *   1. OS keychain (keytar)
 *   2. Electron safeStorage encrypted file
 *   3. plaintext (last-resort fallback)
 *
 * In browser dev mode, falls back to in-memory storage so the UI is testable.
 */

import { isElectron } from './types';
import { coreAPI } from './core';

export type SecretsBackend = 'keychain' | 'safestorage' | 'plaintext' | 'memory';

export interface BackendInfo {
  backend: SecretsBackend;
  label: string;
}

// In-memory fallback for browser dev
const memoryStore = new Map<string, string>();

function devBackend(): BackendInfo {
  return { backend: 'memory', label: 'In-memory (dev preview only)' };
}

export const secretsStore = {
  async getBackend(): Promise<BackendInfo> {
    if (isElectron()) {
      const r = await window.electronAPI!.secretsBackend();
      return { backend: r.backend as SecretsBackend, label: r.label };
    }
    return devBackend();
  },

  async list(): Promise<{ keys: string[]; backend: SecretsBackend }> {
    if (isElectron()) {
      const r = await window.electronAPI!.secretsList();
      return { keys: r.keys || [], backend: (r.backend || 'plaintext') as SecretsBackend };
    }
    return { keys: Array.from(memoryStore.keys()), backend: 'memory' };
  },

  async get(key: string): Promise<string> {
    if (isElectron()) {
      const r = await window.electronAPI!.secretsGet(key);
      return r.success ? r.value || '' : '';
    }
    return memoryStore.get(key) || '';
  },

  async set(key: string, value: string): Promise<boolean> {
    if (isElectron()) {
      const r = await window.electronAPI!.secretsSet(key, value);
      return !!r.success;
    }
    memoryStore.set(key, value);
    return true;
  },

  async delete(key: string): Promise<boolean> {
    if (isElectron()) {
      const r = await window.electronAPI!.secretsDelete(key);
      return !!r.success;
    }
    memoryStore.delete(key);
    return true;
  },

  /**
   * Decrypt all stored secrets and write them to ~/.hermes/.env (chmod 600).
   * Call this immediately before launching the agent.
   *
   * IMPORTANT: On Windows the agent lives inside WSL at
   * \\wsl$\<distro>\home\<user>\.hermes — NOT under C:\Users\<user>\.
   * We therefore write the .env via `wsl bash -lc` so it lands in the
   * Linux $HOME, not the Windows profile (where the hermes CLI can't see it).
   * On macOS/Linux the OS home directory matches, so a direct shell write works.
   */
  async materializeEnv(): Promise<{ success: boolean; count?: number; path?: string }> {
    if (!isElectron()) return { success: true, count: memoryStore.size };

    // Collect all secrets in the renderer (we already have IPC for this).
    const { keys } = await this.list();
    const entries = (await Promise.all(
      keys.map(async (k) => [k, await this.get(k)] as const),
    )).filter(([, v]) => v !== '');

    const platform = await coreAPI.getPlatform();
    const useWsl = platform.isWindows;

    // Build a heredoc-safe script that writes ~/.hermes/.env atomically with chmod 600.
    // We base64-encode each value so quotes/newlines/backticks can't break out.
    const encoded = entries.map(([k, v]) => {
      const b64 = btoa(unescape(encodeURIComponent(v)));
      return `${k}|${b64}`;
    }).join('\n');

    const payloadB64 = btoa(unescape(encodeURIComponent(encoded)));
    const script = [
      'set -e',
      'TARGET="$HOME/.hermes/.env"',
      'mkdir -p "$(dirname "$TARGET")"',
      // Preserve any existing non-managed lines (comments, user-added keys).
      'PRESERVED=""',
      'if [ -f "$TARGET" ]; then',
      `  MANAGED_KEYS="${entries.map(([k]) => k).join(' ')}"`,
      '  PRESERVED=$(awk -v keys="$MANAGED_KEYS" \'',
      '    BEGIN { n=split(keys, arr, " "); for (i=1;i<=n;i++) drop[arr[i]]=1 }',
      '    /^[[:space:]]*#/ || /^[[:space:]]*$/ { print; next }',
      '    { eq=index($0, "="); if (eq<2) { print; next } k=substr($0,1,eq-1); gsub(/^[ \\t]+|[ \\t]+$/, "", k); if (!(k in drop)) print }',
      '  \' "$TARGET")',
      'fi',
      '{',
      '  if [ -n "$PRESERVED" ]; then printf "%s\\n" "$PRESERVED"; fi',
      '  echo "# ─── Managed by Ainoval (do not edit by hand) ───"',
      `  echo "${payloadB64}" | base64 -d | while IFS='|' read -r key b64v; do`,
      '    [ -z "$key" ] && continue',
      '    val=$(echo "$b64v" | base64 -d)',
      '    # Escape backslashes and double-quotes for the .env value',
      '    esc=$(printf "%s" "$val" | sed -e \'s/\\\\/\\\\\\\\/g\' -e \'s/"/\\\\"/g\')',
      '    printf "%s=\\"%s\\"\\n" "$key" "$esc"',
      '  done',
      '} > "$TARGET.tmp" && mv "$TARGET.tmp" "$TARGET"',
      'chmod 600 "$TARGET" || true',
      'echo "[materialize] wrote $TARGET"',
    ].join('\n');

    const wrappedB64 = btoa(unescape(encodeURIComponent(script)));
    const decode = `echo ${wrappedB64} | base64 -d | bash`;
    const cmd = useWsl ? `wsl bash -lc "${decode}"` : `bash -lc "${decode}"`;

    const result = await coreAPI.runCommand(cmd, { timeout: 30000 });
    return {
      success: result.success,
      count: entries.length,
      path: useWsl ? '\\\\wsl$\\<distro>\\home\\<user>\\.hermes\\.env' : `${platform.homeDir}/.hermes/.env`,
    };
  },

  /**
   * Heuristic: is this .env entry an actual user secret (API key / token /
   * password), or just a Hermes config flag like TERMINAL_TIMEOUT or
   * BROWSERBASE_PROXIES that the installer dropped into .env as a default?
   *
   * We deliberately keep the Secrets tab focused on credentials only — config
   * flags belong in the Config Editor, not in an "encrypted secret" list.
   */
  isLikelySecretKey(key: string): boolean {
    const k = key.toUpperCase();
    // Allow-list: well-known credential providers we explicitly support.
    const KNOWN = [
      'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
      'NOUS_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY',
      'MISTRAL_API_KEY', 'COHERE_API_KEY', 'PERPLEXITY_API_KEY',
      'TELEGRAM_BOT_TOKEN', 'DISCORD_BOT_TOKEN', 'SLACK_BOT_TOKEN',
      'EXA_API_KEY', 'FIRECRAWL_API_KEY', 'ELEVENLABS_API_KEY',
      'BROWSERBASE_API_KEY', 'BROWSERBASE_PROJECT_ID',
      'HUGGINGFACE_API_KEY', 'REPLICATE_API_TOKEN',
    ];
    if (KNOWN.includes(k)) return true;
    // Generic shape match: looks like a credential.
    if (/(_API_KEY|_SECRET|_TOKEN|_PASSWORD|_PRIVATE_KEY|_ACCESS_KEY)$/.test(k)) return true;
    return false;
  },

  /**
   * One-shot migration: pull credential-shaped keys out of the plaintext .env
   * into secure storage. Idempotent — safe to call on app startup.
   *
   * Skips Hermes config flags (TERMINAL_*, BROWSER_*, *_DEBUG, etc.) so the
   * Secrets tab only shows actual user credentials.
   *
   * Reads from the agent's actual .env location: on Windows that's inside WSL
   * (\\wsl$\<distro>\home\<user>\.hermes\.env), not the Windows profile.
   */
  async migrateFromEnv(): Promise<{ success: boolean; migrated?: number; cleanedUp?: number }> {
    if (!isElectron()) return { success: true, migrated: 0 };

    // First, prune any non-secret junk that previous versions of this app
    // imported (TERMINAL_TIMEOUT, BROWSERBASE_PROXIES, *_DEBUG, etc.).
    const existing = await this.list();
    let cleanedUp = 0;
    for (const k of existing.keys) {
      if (!this.isLikelySecretKey(k)) {
        if (await this.delete(k)) cleanedUp++;
      }
    }

    const platform = await coreAPI.getPlatform();
    const useWsl = platform.isWindows;

    // Cat the .env from inside the correct shell environment (WSL on Windows,
    // native shell elsewhere). Returns nothing if the file is absent.
    const script = [
      'TARGET="$HOME/.hermes/.env"',
      '[ -f "$TARGET" ] && cat "$TARGET" || true',
    ].join('\n');
    const b64 = btoa(unescape(encodeURIComponent(script)));
    const decode = `echo ${b64} | base64 -d | bash`;
    const cmd = useWsl ? `wsl bash -lc "${decode}"` : `bash -lc "${decode}"`;
    const read = await coreAPI.runCommand(cmd, { timeout: 15000 });
    if (!read.success || !read.stdout) return { success: true, migrated: 0, cleanedUp };

    let migrated = 0;
    for (const line of read.stdout.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 1) continue;
      const key = t.substring(0, eq).trim();
      // Skip non-secret config flags entirely.
      if (!this.isLikelySecretKey(key)) continue;
      let value = t.substring(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // Don't overwrite a non-empty user-entered value with a placeholder.
      if (!value || /^(your[-_]|placeholder|changeme|xxx)/i.test(value)) continue;
      if (await this.set(key, value)) migrated++;
    }
    return { success: true, migrated, cleanedUp };
  },
};
