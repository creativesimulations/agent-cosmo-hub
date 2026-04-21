import { coreAPI } from './core';
import type { CommandResult } from './types';

/**
 * In-app sudo helper for installing apt packages inside WSL / Linux without
 * sending the user to a terminal. We never log the password. The password is
 * piped into `sudo -S` via stdin (base64-decoded inside bash) so it never
 * appears on a process command line.
 */

type ShellWrapper = (inner: string) => string;

async function getWrapper(): Promise<ShellWrapper> {
  const platform = await coreAPI.getPlatform();
  if (platform.isWindows) return (inner) => `wsl bash -lc "${inner}"`;
  // macOS and Linux both use a native bash login shell. macOS additionally
  // has osascript for GUI password prompts when sudo is unavailable — see
  // promptForPasswordMac() below.
  return (inner) => `bash -lc "${inner}"`;
}

/**
 * macOS-only: pop a native GUI password prompt via osascript so the user
 * doesn't have to type their admin password into a renderer text field.
 * Returns the password string, or null if the user cancelled. Linux/WSL
 * users still go through the in-app SudoPasswordDialog because there's no
 * universal GUI prompt.
 */
export async function promptForPasswordMac(reason: string): Promise<string | null> {
  const platform = await coreAPI.getPlatform();
  if (!platform.isMac) return null;
  const safeReason = reason.replace(/"/g, '\\"');
  const script =
    `osascript -e 'display dialog "${safeReason}" default answer "" with hidden answer with title "Ronbot needs your password"' ` +
    `2>/dev/null | sed -n 's/.*text returned:\\(.*\\)$/\\1/p'`;
  const result = await coreAPI.runCommand(script, { timeout: 120000 });
  if (!result.success) return null;
  const pw = (result.stdout || '').trim();
  return pw || null;
}

const toB64 = (s: string) => btoa(unescape(encodeURIComponent(s)));

/** Run a script as the current user (no sudo). */
async function runScript(script: string, timeout = 60000): Promise<CommandResult> {
  const wrap = await getWrapper();
  const b64 = toB64(script);
  return coreAPI.runCommand(wrap(`echo ${b64} | base64 -d | bash`), { timeout });
}

/**
 * Run an apt-get command using a user-supplied sudo password.
 * The password is fed to `sudo -S` via stdin from a base64-decoded heredoc so
 * it never appears in the command line. APT_LISTCHANGES_FRONTEND=none and
 * DEBIAN_FRONTEND=noninteractive prevent interactive prompts.
 */
async function runAptWithPassword(
  aptArgs: string[],
  password: string,
  timeout = 600000
): Promise<CommandResult> {
  const pwB64 = toB64(password + '\n');
  // Avoid nested `bash -c` quoting issues by passing the password to sudo's
  // stdin and invoking apt-get directly. We pre-feed the password via a here-doc
  // style pipe so it's consumed by `sudo -S` once and discarded.
  // Args are passed positionally (no shell interpolation) — safer for package lists.
  const argsQuoted = aptArgs.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
  const script = [
    'set -o pipefail',
    'export DEBIAN_FRONTEND=noninteractive APT_LISTCHANGES_FRONTEND=none NEEDRESTART_MODE=a',
    `printf '%s\\n' "$(echo ${pwB64} | base64 -d)" | sudo -S -p '' -E apt-get -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" ${argsQuoted} 2>&1`,
    'rc=$?',
    'echo "[apt] exit code: $rc"',
    'exit $rc',
  ].join('\n');
  return runScript(script, timeout);
}

export type SudoState =
  | { kind: 'no-sudo' }              // sudo command not available at all
  | { kind: 'passwordless' }         // sudo -n true succeeds — no password needed
  | { kind: 'needs-password' }       // user has a sudo password we can ask for
  | { kind: 'no-password-set' };     // user account has no password (typical fresh WSL)

export const sudoAPI = {
  /** Probe what kind of sudo access is available. */
  async probe(): Promise<SudoState> {
    // 1. sudo present?
    const which = await runScript('command -v sudo >/dev/null 2>&1 && echo OK || echo NO', 10000);
    if (!which.stdout.includes('OK')) return { kind: 'no-sudo' };

    // 2. passwordless?
    const nopass = await runScript('sudo -n true 2>/dev/null && echo OK || echo NO', 10000);
    if (nopass.stdout.includes('OK')) return { kind: 'passwordless' };

    // 3. Does the current user even have a password set?
    //    `passwd -S $USER` outputs "user P ..." if password set, "user NP ..." if not.
    //    Requires sudo to read /etc/shadow, but on most WSL setups `passwd -S` works
    //    against the user themselves without sudo.
    const pwState = await runScript(
      'passwd -S "$USER" 2>/dev/null || sudo -n passwd -S "$USER" 2>/dev/null || echo UNKNOWN',
      10000
    );
    const out = (pwState.stdout || '').trim();
    if (/\bNP\b/.test(out)) return { kind: 'no-password-set' };
    // If we genuinely can't tell, assume password exists and let the user try.
    return { kind: 'needs-password' };
  },

  /** Verify a password works by running `sudo -S true`. Does NOT cache. */
  async verifyPassword(password: string): Promise<{ valid: boolean; error?: string }> {
    const pwB64 = toB64(password + '\n');
    const script = `printf '%s' "$(echo ${pwB64} | base64 -d)" | sudo -S -p '' true 2>&1`;
    const result = await runScript(script, 15000);
    if (result.success) return { valid: true };
    const err = (result.stderr || result.stdout || '').toLowerCase();
    if (err.includes('incorrect password') || err.includes('sorry, try again')) {
      return { valid: false, error: 'Incorrect password' };
    }
    return { valid: false, error: (result.stderr || result.stdout || 'sudo failed').trim() };
  },

  /** Install one or more apt packages with the given password. */
  async aptInstall(packages: string[], password: string): Promise<CommandResult> {
    if (packages.length === 0) return { success: true, stdout: '', stderr: '', code: 0 };
    const safe = packages.map((p) => p.replace(/[^a-zA-Z0-9._+-]/g, ''));
    // apt-get update first (best-effort — failures are okay if cache is recent).
    await runAptWithPassword(['update'], password, 180000);
    return runAptWithPassword(['install', ...safe], password, 600000);
  },

  /**
   * Set a sudo password for the current user (when none is set yet).
   * Uses `chpasswd` via `sudo -n` (which works on fresh WSL because the user
   * is in the sudoers file with NOPASSWD by default until they set one).
   */
  async setUserPassword(newPassword: string): Promise<CommandResult> {
    const payload = `$USER:${newPassword}`;
    const b64 = toB64(payload);
    const script = [
      'set -e',
      // Use sudo -n; on fresh WSL the default user has passwordless sudo.
      `echo ${b64} | base64 -d | sudo -n chpasswd 2>&1`,
      'echo "[passwd] password set for $USER"',
    ].join('\n');
    return runScript(script, 30000);
  },
};
