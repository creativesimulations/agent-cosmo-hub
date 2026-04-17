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
   */
  async materializeEnv(): Promise<{ success: boolean; count?: number; path?: string }> {
    if (isElectron()) {
      const platform = await coreAPI.getPlatform();
      return window.electronAPI!.secretsMaterializeEnv(
        platform.isWindows ? undefined : `${platform.homeDir}/.hermes/.env`
      );
    }
    return { success: true, count: memoryStore.size };
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
