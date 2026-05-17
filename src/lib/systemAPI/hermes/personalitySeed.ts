// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { runHermesShell } from "./shell";
import { readHermesFile, writeHermesFile } from "./files";
import {
  buildDefaultSoulMarkdown,
  DEFAULT_MEMORY_MARKDOWN,
  DEFAULT_PERSONALITY_MARKDOWN,
  DEFAULT_USER_MARKDOWN,
} from "./defaultPersonalityMarkdown";
import { RONBOT_MEMORY_UI_POINTER } from "./ronbotRules";

export function buildDefaultMemoryMarkdown(): string {
  const base = DEFAULT_MEMORY_MARKDOWN.trimEnd();
  if (base.includes("~/.ronbot/APP_GUIDE.md")) return base;
  return `${base}\n\n${RONBOT_MEMORY_UI_POINTER}`;
}

const HERMES_ROOT = "$HOME/.hermes";
const MEMORIES_DIR = "$HOME/.hermes/memories";

/** Ronbot-written persona files carry this marker so upgrades can overwrite safely. */
export const RONBOT_MANAGED_PERSONA_MARKER = "<!-- ronbot-managed-persona v1 -->";

export const stripPersonaMarker = (body: string): string =>
  body
    .replace(/\n*<!--\s*ronbot-managed-persona[^>]*-->\s*$/i, "")
    .trimEnd();

export const appendPersonaMarker = (body: string): string => {
  const b = body.trimEnd();
  if (b.includes("ronbot-managed-persona")) return b.endsWith("\n") ? b : `${b}\n`;
  return `${b}\n\n${RONBOT_MANAGED_PERSONA_MARKER}\n`;
};

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();

const isRonbotManagedOrEmpty = (content: string | undefined): boolean => {
  const c = (content ?? "").trim();
  if (!c) return true;
  return /ronbot-managed-persona/i.test(c);
};

const matchesBundledDefault = (current: string, bundledDefault: string): boolean =>
  norm(stripPersonaMarker(current)) === norm(stripPersonaMarker(bundledDefault));

async function backupOneHermesFile(posixPath: string): Promise<void> {
  const script = [
    "set -e",
    `F="${posixPath}"`,
    'if [ ! -f "$F" ]; then exit 0; fi',
    'ROOT="$HOME/.hermes/.ronbot-personality-backup"',
    'TS=$(date +%Y%m%d-%H%M%S)',
    'DEST="$ROOT/$TS"',
    'mkdir -p "$DEST"',
    'cp "$F" "$DEST/$(basename "$F").bak"',
  ].join("\n");
  await runHermesShell(script, { timeout: 15_000 }).catch(() => undefined);
}

type SeedFile = {
  path: string;
  next: string;
  shouldWrite: (cur: string | undefined) => boolean;
};

/**
 * Ensure ~/.hermes + memories exist, then write Ronbot default persona files
 * only when missing, Ronbot-managed, or still matching bundled defaults.
 */
export async function seedCustomPersonalityFiles(agentName: string): Promise<{
  success: boolean;
  backupDir?: string;
  filesMoved?: number;
  written: string[];
  skipped: string[];
  error?: string;
}> {
  const mkdir = await runHermesShell(
    ['set -e', `mkdir -p "${HERMES_ROOT}"`, `mkdir -p "${MEMORIES_DIR}"`].join("\n"),
    { timeout: 10_000 },
  );
  if (!mkdir.success) {
    return {
      success: false,
      written: [],
      skipped: [],
      error: mkdir.stderr || mkdir.stdout || "mkdir failed",
    };
  }

  const soulBody = appendPersonaMarker(buildDefaultSoulMarkdown(agentName));
  const personalityBody = appendPersonaMarker(DEFAULT_PERSONALITY_MARKDOWN);
  const memoryBody = appendPersonaMarker(buildDefaultMemoryMarkdown());
  const userBody = appendPersonaMarker(DEFAULT_USER_MARKDOWN);

  const files: SeedFile[] = [
    {
      path: `${HERMES_ROOT}/SOUL.md`,
      next: soulBody,
      shouldWrite: (cur) =>
        isRonbotManagedOrEmpty(cur) ||
        matchesBundledDefault(cur ?? "", buildDefaultSoulMarkdown(agentName)),
    },
    {
      path: `${HERMES_ROOT}/PERSONALITY.md`,
      next: personalityBody,
      shouldWrite: (cur) =>
        isRonbotManagedOrEmpty(cur) || matchesBundledDefault(cur ?? "", DEFAULT_PERSONALITY_MARKDOWN),
    },
    {
      path: `${MEMORIES_DIR}/MEMORY.md`,
      next: memoryBody,
      shouldWrite: (cur) =>
        isRonbotManagedOrEmpty(cur) || matchesBundledDefault(cur ?? "", buildDefaultMemoryMarkdown()),
    },
    {
      path: `${MEMORIES_DIR}/USER.md`,
      next: userBody,
      shouldWrite: (cur) =>
        isRonbotManagedOrEmpty(cur) || matchesBundledDefault(cur ?? "", DEFAULT_USER_MARKDOWN),
    },
  ];

  const written: string[] = [];
  const skipped: string[] = [];
  let moved = 0;

  for (const f of files) {
    const r = await readHermesFile(f.path);
    const cur = r.success ? r.content : undefined;
    if (!f.shouldWrite(cur)) {
      skipped.push(f.path.replace(/\$HOME/g, "~"));
      continue;
    }
    await backupOneHermesFile(f.path);
    moved += 1;
    const w = await writeHermesFile(f.path, f.next, "600");
    if (!w.success) {
      return {
        success: false,
        backupDir: moved > 0 ? "~/.hermes/.ronbot-personality-backup/" : undefined,
        filesMoved: moved,
        written,
        skipped,
        error: w.error || `write failed: ${f.path}`,
      };
    }
    written.push(f.path.replace(/\$HOME/g, "~"));
  }

  return {
    success: true,
    backupDir: moved > 0 ? "~/.hermes/.ronbot-personality-backup/" : undefined,
    filesMoved: moved,
    written,
    skipped,
  };
}

export async function writeRonbotDefaultPersonalityFiles(
  agentName: string,
): Promise<{ success: boolean; error?: string }> {
  const r = await seedCustomPersonalityFiles(agentName);
  if (!r.success) return { success: false, error: r.error };
  return { success: true };
}
