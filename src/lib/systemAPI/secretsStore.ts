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
   * One-shot migration: pull every key out of the plaintext .env into
   * secure storage. Idempotent — safe to call on app startup.
   */
  async migrateFromEnv(): Promise<{ success: boolean; migrated?: number }> {
    if (isElectron()) {
      const platform = await coreAPI.getPlatform();
      return window.electronAPI!.secretsMigrateFromEnv(
        platform.isWindows ? undefined : `${platform.homeDir}/.hermes/.env`
      );
    }
    return { success: true, migrated: 0 };
  },
};
