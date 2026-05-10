import { runHermesShell } from "./shell";
import { writeHermesFile } from "./files";
import {
  buildDefaultSoulMarkdown,
  DEFAULT_MEMORY_MARKDOWN,
  DEFAULT_PERSONALITY_MARKDOWN,
  DEFAULT_USER_MARKDOWN,
} from "./defaultPersonalityMarkdown";

const HERMES_ROOT = "$HOME/.hermes";
const MEMORIES_DIR = "$HOME/.hermes/memories";

export type PersonalityBackupResult = {
  success: boolean;
  /** Human-readable path, e.g. ~/.hermes/.ronbot-personality-backup/20260110-120000 */
  backupDir?: string;
  movedCount?: number;
  error?: string;
};

/**
 * Move existing SOUL.md / PERSONALITY.md (under ~/.hermes) and MEMORY.md /
 * USER.md (under ~/.hermes/memories) into a timestamped backup folder before
 * Ronbot writes its defaults.
 */
export async function backupHermesPersonalityToTimestampedFolder(): Promise<PersonalityBackupResult> {
  const script = [
    "set -e",
    `ROOT="${HERMES_ROOT}"`,
    'BACKROOT="$ROOT/.ronbot-personality-backup"',
    'TS=$(date +%Y%m%d-%H%M%S)',
    'DEST="$BACKROOT/$TS"',
    'mkdir -p "$DEST/hermes-root" "$DEST/memories"',
    'MOVED=0',
    'for f in SOUL.md PERSONALITY.md; do',
    '  if [ -f "$ROOT/$f" ]; then',
    '    mv "$ROOT/$f" "$DEST/hermes-root/$f"',
    "    MOVED=$((MOVED+1))",
    "  fi",
    "done",
    'mkdir -p "$ROOT/memories"',
    'for f in MEMORY.md USER.md; do',
    '  if [ -f "$ROOT/memories/$f" ]; then',
    '    mv "$ROOT/memories/$f" "$DEST/memories/$f"',
    "    MOVED=$((MOVED+1))",
    "  fi",
    "done",
    'echo "RONBOT_BACKUP_REL=.hermes/.ronbot-personality-backup/$TS"',
    'echo "RONBOT_BACKUP_MOVED=$MOVED"',
  ].join("\n");

  const r = await runHermesShell(script, { timeout: 30000 });
  if (!r.success) {
    return {
      success: false,
      error: r.stderr || r.stdout || "Backup script failed",
    };
  }
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  const rel = out.match(/RONBOT_BACKUP_REL=(.+)/)?.[1]?.trim();
  const moved = Number(out.match(/RONBOT_BACKUP_MOVED=(\d+)/)?.[1] ?? 0);
  return {
    success: true,
    backupDir: rel ? `~/${rel}` : "~/.hermes/.ronbot-personality-backup/<timestamp>",
    movedCount: Number.isFinite(moved) ? moved : 0,
  };
}

export async function writeRonbotDefaultPersonalityFiles(
  agentName: string,
): Promise<{ success: boolean; error?: string }> {
  const soul = buildDefaultSoulMarkdown(agentName);
  const w1 = await writeHermesFile(`${HERMES_ROOT}/SOUL.md`, soul, "600");
  if (!w1.success) return w1;
  const w2 = await writeHermesFile(`${HERMES_ROOT}/PERSONALITY.md`, DEFAULT_PERSONALITY_MARKDOWN, "600");
  if (!w2.success) return w2;
  const w3 = await writeHermesFile(`${MEMORIES_DIR}/MEMORY.md`, DEFAULT_MEMORY_MARKDOWN, "600");
  if (!w3.success) return w3;
  const w4 = await writeHermesFile(`${MEMORIES_DIR}/USER.md`, DEFAULT_USER_MARKDOWN, "600");
  if (!w4.success) return w4;
  return { success: true };
}
