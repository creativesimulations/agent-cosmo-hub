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
   * Call this immediately before launching the agent OR right after the
   * user edits a secret in the Secrets tab.
   *
   * Strategy: build the .env content fully in JS, then hand it to the
   * shell as a base64 blob. On Windows we additionally stage the payload
   * through a Windows temp file and use a minimal `wsl cp` — this avoids
   * cmd.exe mangling shell metacharacters (the source of the recurring
   * "'true' is not recognized" + "system cannot find the path specified"
   * errors).
   */
  async materializeEnv(): Promise<{ success: boolean; count?: number; path?: string; error?: string }> {
    if (!isElectron()) return { success: true, count: memoryStore.size };

    // 1. Collect all secrets.
    const { keys } = await this.list();
    const entries = (await Promise.all(
      keys.map(async (k) => [k, await this.get(k)] as const),
    )).filter(([, v]) => v !== '');

    const platform = await coreAPI.getPlatform();

    // 2. Read existing .env (if any) and preserve non-managed lines so we
    //    don't clobber comments or user-added keys.
    const managedKeys = new Set(entries.map(([k]) => k));
    const readScript = [
      'TARGET="$HOME/.hermes/.env"',
      '[ -f "$TARGET" ] && cat "$TARGET" || true',
    ].join('\n');
    const readB64 = btoa(unescape(encodeURIComponent(readScript)));
    const readDecode = `echo ${readB64} | base64 -d | bash`;
    const readCmd = platform.isWindows ? `wsl bash -lc "${readDecode}"` : `bash -lc "${readDecode}"`;
    const readRes = await coreAPI.runCommand(readCmd, { timeout: 15000 });

    const preservedLines: string[] = [];
    if (readRes.success && readRes.stdout) {
      for (const line of readRes.stdout.split('\n')) {
        const t = line.trim();
        if (!t) { preservedLines.push(line); continue; }
        if (t.startsWith('#')) {
          // Skip our own managed-block marker so it doesn't accumulate.
          if (/Managed by Ainoval/i.test(t)) continue;
          preservedLines.push(line);
          continue;
        }
        const eq = t.indexOf('=');
        if (eq < 1) { preservedLines.push(line); continue; }
        const k = t.substring(0, eq).trim();
        if (!managedKeys.has(k)) preservedLines.push(line);
      }
    }

    // 3. Build the final .env content entirely in JS (no shell quoting).
    const escapeForDoubleQuotes = (v: string) =>
      v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
    const managedBlock = entries
      .map(([k, v]) => `${k}="${escapeForDoubleQuotes(v)}"`)
      .join('\n');
    const content =
      (preservedLines.length ? preservedLines.join('\n').replace(/\n+$/, '') + '\n' : '') +
      '# ─── Managed by Ainoval (do not edit by hand) ───\n' +
      managedBlock + '\n';

    // 4. Write the content. On Windows, stage via Windows temp + `wsl cp`
    //    to sidestep cmd.exe quoting bugs entirely.
    if (platform.isWindows) {
      const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const winTmpDir = `${platform.homeDir}\\.ainoval\\tmp`;
      const winTmpFile = `${winTmpDir}\\env-${stamp}.dat`;
      await coreAPI.mkdir(winTmpDir);
      const wrote = await coreAPI.writeFile(winTmpFile, content);
      if (!wrote.success) {
        return { success: false, error: wrote.error || 'Failed to stage .env content' };
      }
      const drive = winTmpFile[0].toLowerCase();
      const wslSource = `/mnt/${drive}${winTmpFile.slice(2).replace(/\\/g, '/')}`;
      // Base64-encode the entire bash script before handing it to cmd.exe.
      // cmd.exe doesn't honor backslash-escaping of `"`, so any nested double
      // quote (e.g. `"$(dirname "$TARGET")"`) gets chopped, leaving cp/chmod
      // with missing operands ("'true' is not recognized...", "missing
      // destination file operand"). Encoding sidesteps that entirely.
      const script = [
        'set -e',
        'TARGET="$HOME/.hermes/.env"',
        'mkdir -p "$(dirname "$TARGET")"',
        `cp "${wslSource}" "$TARGET"`,
        `rm -f "${wslSource}" 2>/dev/null || true`,
        'chmod 600 "$TARGET" || true',
        'echo "[materialize] wrote $TARGET ($(wc -l < "$TARGET") lines)"',
      ].join('\n');
      const scriptB64 = btoa(unescape(encodeURIComponent(script)));
      const result = await coreAPI.runCommand(
        `wsl bash -c "echo ${scriptB64} | base64 -d | bash"`,
        { timeout: 30000 },
      );
      return {
        success: result.success,
        count: entries.length,
        path: '\\\\wsl$\\<distro>\\home\\<user>\\.hermes\\.env',
        error: result.success ? undefined : (result.stderr || result.stdout || 'wsl materialize failed'),
      };
    }

    // macOS / Linux: write content via base64 pipe — single shell, no cmd.exe.
    const contentB64 = btoa(unescape(encodeURIComponent(content)));
    const writeScript = [
      'set -e',
      'TARGET="$HOME/.hermes/.env"',
      'mkdir -p "$(dirname "$TARGET")"',
      `echo ${contentB64} | base64 -d > "$TARGET"`,
      'chmod 600 "$TARGET" || true',
      'echo "[materialize] wrote $TARGET"',
    ].join('\n');
    const writeB64 = btoa(unescape(encodeURIComponent(writeScript)));
    const writeCmd = `bash -lc "echo ${writeB64} | base64 -d | bash"`;
    const result = await coreAPI.runCommand(writeCmd, { timeout: 30000 });
    return {
      success: result.success,
      count: entries.length,
      path: `${platform.homeDir}/.hermes/.env`,
      error: result.success ? undefined : (result.stderr || result.stdout || 'write failed'),
    };
  },

  /**
   * Heuristic: is this .env entry an actual user secret (API key / token /
   * password), or just a Hermes config flag like TERMINAL_TIMEOUT?
   * Used ONLY to decide what to import from a plaintext .env into secure
   * storage — never to delete existing secrets the user has stored.
   */
  isLikelySecretKey(key: string): boolean {
    const k = key.toUpperCase();
    const KNOWN = [
      'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
      'NOUS_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY',
      'MISTRAL_API_KEY', 'COHERE_API_KEY', 'PERPLEXITY_API_KEY',
      'TELEGRAM_BOT_TOKEN', 'DISCORD_BOT_TOKEN', 'SLACK_BOT_TOKEN',
      'EXA_API_KEY', 'FIRECRAWL_API_KEY', 'ELEVENLABS_API_KEY',
      'BROWSERBASE_API_KEY', 'BROWSERBASE_PROJECT_ID',
      'HUGGINGFACE_API_KEY', 'REPLICATE_API_TOKEN',
      'DEEPSEEK_API_KEY',
    ];
    if (KNOWN.includes(k)) return true;
    if (/(_API_KEY|_SECRET|_TOKEN|_PASSWORD|_PRIVATE_KEY|_ACCESS_KEY)$/.test(k)) return true;
    return false;
  },

  /**
   * IMPORT-ONLY migration: pull credential-shaped keys out of the plaintext
   * .env into secure storage. Idempotent — safe to call repeatedly.
   *
   * IMPORTANT: This function NEVER deletes anything from secure storage.
   * Earlier versions auto-pruned keys whose names didn't match the heuristic,
   * which caused real user-entered secrets to silently disappear when the
   * Secrets page remounted. Pruning is now a separate, explicit operation.
   *
   * - Skips Hermes config flags (TERMINAL_*, BROWSER_*, *_DEBUG, etc.)
   * - Won't overwrite an existing stored value with a placeholder
   * - Reads from the agent's actual .env location (inside WSL on Windows)
   */
  async migrateFromEnv(): Promise<{ success: boolean; migrated?: number }> {
    if (!isElectron()) return { success: true, migrated: 0 };

    const platform = await coreAPI.getPlatform();
    const useWsl = platform.isWindows;

    const script = [
      'TARGET="$HOME/.hermes/.env"',
      '[ -f "$TARGET" ] && cat "$TARGET" || true',
    ].join('\n');
    const b64 = btoa(unescape(encodeURIComponent(script)));
    const decode = `echo ${b64} | base64 -d | bash`;
    const cmd = useWsl ? `wsl bash -lc "${decode}"` : `bash -lc "${decode}"`;
    const read = await coreAPI.runCommand(cmd, { timeout: 15000 });
    if (!read.success || !read.stdout) return { success: true, migrated: 0 };

    // Don't overwrite already-stored secrets — only import keys that aren't
    // already in secure storage (or whose stored value is empty).
    const existing = new Set((await this.list()).keys);

    let migrated = 0;
    for (const line of read.stdout.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 1) continue;
      const key = t.substring(0, eq).trim();
      if (!this.isLikelySecretKey(key)) continue;
      let value = t.substring(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!value || /^(your[-_]|placeholder|changeme|xxx)/i.test(value)) continue;
      // Don't clobber a value the user already has in secure storage.
      if (existing.has(key)) {
        const stored = await this.get(key);
        if (stored) continue;
      }
      if (await this.set(key, value)) migrated++;
    }
    return { success: true, migrated };
  },
};
