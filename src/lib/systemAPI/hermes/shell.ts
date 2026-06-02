// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { coreAPI } from "../core";
import { isElectron } from "../types";
import type { CommandResult } from "../types";
import { INLINE_SCRIPT_LIMIT } from "./constants";
import { DEFAULT_HERMES_CHAT_CAPS, parseHermesChatHelp, type HermesChatCliCaps } from "./chatCliCaps";

export type CommandOutputHandler = (chunk: {
  type: string;
  data?: string;
  code?: number;
}) => void;

export const encodeScript = (value: string) => btoa(unescape(encodeURIComponent(value)));

export const toWslMountedPath = (windowsPath: string): string | null => {
  const normalized = windowsPath.replace(/\\/g, "/");
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!match) return null;
  return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
};

const stageScript = async (
  script: string,
  tag: string,
): Promise<{ path: string; cleanup: string } | null> => {
  if (!isElectron()) return null;
  const platform = await coreAPI.getPlatform();
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const fileName = `ronbot-${tag}-${stamp}.sh`;

  if (platform.isWindows) {
    const dir = `${platform.homeDir}\\.ronbot\\tmp`;
    const writePath = `${dir}\\${fileName}`;
    await coreAPI.mkdir(dir);
    const wrote = await coreAPI.writeFile(writePath, script);
    if (!wrote.success) return null;
    const drive = writePath[0].toLowerCase();
    const rest = writePath.slice(2).replace(/\\/g, "/");
    const execPath = `/mnt/${drive}${rest}`;
    return { path: execPath, cleanup: `rm -f "${execPath}" 2>/dev/null || true` };
  }

  const writePath = `/tmp/${fileName}`;
  const wrote = await coreAPI.writeFile(writePath, script);
  if (!wrote.success) return null;
  return { path: writePath, cleanup: `rm -f "${writePath}" 2>/dev/null || true` };
};

export const buildHermesShellCommand = async (script: string): Promise<string> => {
  const platform = await coreAPI.getPlatform();

  if (script.length <= INLINE_SCRIPT_LIMIT) {
    const b64 = encodeScript(script);
    const decodeCmd = `echo ${b64} | base64 -d | bash`;
    const markedDecodeCmd = `export RONBOT_MANAGED_PROCESS=1; ${decodeCmd}`;
    return platform.isWindows ? `wsl bash -lc "${markedDecodeCmd}"` : `bash -lc "${markedDecodeCmd}"`;
  }

  const staged = await stageScript(script, "hermes");
  if (!staged) {
    const b64 = encodeScript(script);
    const decodeCmd = `echo ${b64} | base64 -d | bash`;
    const markedDecodeCmd = `export RONBOT_MANAGED_PROCESS=1; ${decodeCmd}`;
    return platform.isWindows ? `wsl bash -lc "${markedDecodeCmd}"` : `bash -lc "${markedDecodeCmd}"`;
  }

  const exec = `export RONBOT_MANAGED_PROCESS=1; bash ${staged.path}; __rc=$?; ${staged.cleanup}; exit $__rc`;
  if (platform.isWindows) {
    const execB64 = encodeScript(exec);
    return `wsl bash -lc "export RONBOT_MANAGED_PROCESS=1; echo ${execB64} | base64 -d | bash"`;
  }
  return `bash -lc '${exec}'`;
};

const HERMES_CHAT_CAPS: { probed: boolean } & HermesChatCliCaps = {
  probed: false,
  supportsNoColor: DEFAULT_HERMES_CHAT_CAPS.supportsNoColor,
};

let hermesCapsProbePromise: Promise<void> | null = null;

export async function ensureHermesChatCaps(): Promise<void> {
  if (HERMES_CHAT_CAPS.probed) return;
  if (hermesCapsProbePromise) return hermesCapsProbePromise;
  hermesCapsProbePromise = (async () => {
    try {
      const platform = await coreAPI.getPlatform();
      const inner =
        'export PATH="$HOME/.hermes/venv/bin:$HOME/.local/bin:$PATH" && hermes chat --help 2>&1 || true';
      const b64 = btoa(unescape(encodeURIComponent(inner)));
      const cmd = platform.isWindows
        ? `wsl bash -lc "echo ${b64} | base64 -d | bash"`
        : `bash -lc "echo ${b64} | base64 -d | bash"`;
      const r = await coreAPI.runCommand(cmd, { timeout: 10000 });
      const out = (r.stdout || "") + (r.stderr || "");
      const parsed = parseHermesChatHelp(out);
      HERMES_CHAT_CAPS.supportsNoColor = parsed.supportsNoColor;
    } catch {
      Object.assign(HERMES_CHAT_CAPS, DEFAULT_HERMES_CHAT_CAPS);
    } finally {
      HERMES_CHAT_CAPS.probed = true;
    }
  })();
  return hermesCapsProbePromise;
}

export function getHermesChatCaps(): HermesChatCliCaps & { probed: boolean } {
  return HERMES_CHAT_CAPS;
}

export const runHermesShell = async (
  script: string,
  options?: Record<string, unknown> & { onStreamId?: (id: string) => void; displayCommand?: string },
  onOutput?: CommandOutputHandler,
): Promise<CommandResult> => {
  const cmd = await buildHermesShellCommand(script);
  const displayCommand = options?.displayCommand || script;
  const mergedOptions = { ...(options || {}), displayCommand };
  const needsStream = !!onOutput || !!options?.onStreamId;
  return needsStream
    ? coreAPI.runCommandStream(cmd, mergedOptions, onOutput || (() => {}))
    : coreAPI.runCommand(cmd, mergedOptions);
};

/** Prepended to shell snippets that need the venv Hermes on PATH. */
export const HERMES_PATH_EXPORT =
  'export PATH="$HOME/.hermes/venv/bin:$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:/snap/bin:$PATH"';

export const runHermesCli = async (
  command: string,
  options?: Record<string, unknown>,
  onOutput?: CommandOutputHandler,
): Promise<CommandResult> => {
  return runHermesShell(
    [
      "set -e",
      HERMES_PATH_EXPORT,
      'command -v hermes >/dev/null 2>&1 || { echo "[hermes] FATAL: hermes CLI not found on PATH" >&2; exit 127; }',
      'echo "[hermes] using $(command -v hermes)"',
      command,
    ].join("\n"),
    options,
    onOutput,
  );
};
