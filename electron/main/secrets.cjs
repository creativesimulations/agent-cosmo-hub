'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

let keytar = null;
try {
  keytar = require('keytar');
} catch (e) {
  console.warn('[secrets] keytar unavailable, falling back to safeStorage:', e.message);
}

const KEYCHAIN_SERVICE = 'Ronbot';
const SAFESTORAGE_FILE = path.join(os.homedir(), '.ronbot', 'secrets.enc');

function keychainLabel() {
  if (process.platform === 'darwin') return 'macOS Keychain';
  if (process.platform === 'win32') return 'Windows Credential Manager';
  return 'System Keyring (libsecret)';
}

function safeStorageLabel() {
  if (process.platform === 'darwin') return 'Encrypted (Keychain-derived key)';
  if (process.platform === 'win32') return 'Encrypted (DPAPI)';
  return 'Encrypted (safeStorage)';
}

function backendInfo(safeStorage) {
  if (keytar) return { backend: 'keychain', label: keychainLabel() };
  if (safeStorage.isEncryptionAvailable()) return { backend: 'safestorage', label: safeStorageLabel() };
  return { backend: 'plaintext', label: 'Plaintext file (insecure fallback)' };
}

async function readSafeStorageFile() {
  try {
    const buf = await fs.promises.readFile(SAFESTORAGE_FILE, 'utf-8');
    return JSON.parse(buf);
  } catch {
    return {};
  }
}

async function writeSafeStorageFile(map) {
  await fs.promises.mkdir(path.dirname(SAFESTORAGE_FILE), { recursive: true });
  await fs.promises.writeFile(SAFESTORAGE_FILE, JSON.stringify(map, null, 2), 'utf-8');
  if (process.platform !== 'win32') {
    try { await fs.promises.chmod(SAFESTORAGE_FILE, 0o600); } catch { /* best effort */ }
  }
}

function registerSecretsHandlers(ipcMain, safeStorage, IPC) {
  ipcMain.handle(IPC.SECRETS_BACKEND, async () => backendInfo(safeStorage));

  ipcMain.handle(IPC.SECRETS_LIST, async () => {
    if (keytar) {
      try {
        const items = await keytar.findCredentials(KEYCHAIN_SERVICE);
        return { success: true, backend: 'keychain', keys: items.map((i) => i.account) };
      } catch (e) {
        return { success: false, error: e.message, keys: [] };
      }
    }
    if (safeStorage.isEncryptionAvailable()) {
      const map = await readSafeStorageFile();
      return { success: true, backend: 'safestorage', keys: Object.keys(map) };
    }
    return { success: true, backend: 'plaintext', keys: [] };
  });

  ipcMain.handle(IPC.SECRETS_GET, async (_event, key) => {
    if (keytar) {
      try {
        const v = await keytar.getPassword(KEYCHAIN_SERVICE, key);
        return { success: true, value: v ?? '' };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    if (safeStorage.isEncryptionAvailable()) {
      const map = await readSafeStorageFile();
      const enc = map[key];
      if (!enc) return { success: true, value: '' };
      try {
        const value = safeStorage.decryptString(Buffer.from(enc, 'base64'));
        return { success: true, value };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    return { success: false, error: 'No secure storage available' };
  });

  ipcMain.handle(IPC.SECRETS_SET, async (_event, key, value) => {
    if (keytar) {
      try {
        await keytar.setPassword(KEYCHAIN_SERVICE, key, value);
        return { success: true, backend: 'keychain' };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    if (safeStorage.isEncryptionAvailable()) {
      const map = await readSafeStorageFile();
      map[key] = safeStorage.encryptString(value).toString('base64');
      await writeSafeStorageFile(map);
      return { success: true, backend: 'safestorage' };
    }
    return { success: false, error: 'No secure storage available' };
  });

  ipcMain.handle(IPC.SECRETS_DELETE, async (_event, key) => {
    if (keytar) {
      try {
        await keytar.deletePassword(KEYCHAIN_SERVICE, key);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    if (safeStorage.isEncryptionAvailable()) {
      const map = await readSafeStorageFile();
      delete map[key];
      await writeSafeStorageFile(map);
      return { success: true };
    }
    return { success: false, error: 'No secure storage available' };
  });
}

module.exports = {
  registerSecretsHandlers,
};
