// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { runHermesShell } from "./shell";

const ROOT = "$HOME/.hermes";
const PRESETS = "$HOME/.hermes/personalities";

export type PersonalityPresetInfo = { name: string; mtimeSec: number };

export function sanitizePersonalityPresetName(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, "_");
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(s)) return null;
  return s;
}

/** List saved personality folders under ~/.hermes/personalities/ */
export async function listPersonalityPresets(): Promise<{
  success: boolean;
  presets: PersonalityPresetInfo[];
  error?: string;
}> {
  const script = [
    "set -e",
    `ROOT="${PRESETS}"`,
    'if [ ! -d "$ROOT" ]; then echo "__EMPTY__"; exit 0; fi',
    'for d in "$ROOT"/*/; do',
    '  [ -e "$d" ] || continue',
    '  base=$(basename "${d%/}")',
    '  mt=$(stat -c %Y "$d" 2>/dev/null || echo 0)',
    '  echo "$base\t$mt"',
    "done",
  ].join("\n");
  const r = await runHermesShell(script, { timeout: 15_000 });
  if (!r.success) return { success: false, presets: [], error: r.stderr || r.stdout || "list failed" };
  const lines = (r.stdout || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 1 && lines[0] === "__EMPTY__") return { success: true, presets: [] };
  const presets: PersonalityPresetInfo[] = [];
  for (const line of lines) {
    const [name, mt] = line.split("\t");
    if (!name) continue;
    presets.push({ name, mtimeSec: Number(mt) || 0 });
  }
  presets.sort((a, b) => b.mtimeSec - a.mtimeSec);
  return { success: true, presets };
}

/** Snapshot current ~/.hermes persona files into personalities/<name>/. */
export async function savePersonalityPreset(name: string): Promise<{ success: boolean; error?: string }> {
  const safe = sanitizePersonalityPresetName(name);
  if (!safe) return { success: false, error: "Invalid preset name (use letters, numbers, dash, underscore, max 48)." };
  const script = [
    "set -e",
    `ROOT="${ROOT}"`,
    `DEST="${PRESETS}/${safe}"`,
    'mkdir -p "$DEST/memories"',
    'for f in SOUL.md PERSONALITY.md AGENTS.md; do',
    '  if [ -f "$ROOT/$f" ]; then cp "$ROOT/$f" "$DEST/$f"; fi',
    "done",
    'for f in MEMORY.md USER.md; do',
    '  if [ -f "$ROOT/memories/$f" ]; then cp "$ROOT/memories/$f" "$DEST/memories/$f"; fi',
    "done",
    'echo ok',
  ].join("\n");
  const r = await runHermesShell(script, { timeout: 30_000 });
  if (!r.success) return { success: false, error: r.stderr || r.stdout || "save preset failed" };
  return { success: true };
}

/** Copy preset back to ~/.hermes/ (backs up current files first). */
export async function applyPersonalityPreset(name: string): Promise<{ success: boolean; error?: string }> {
  const safe = sanitizePersonalityPresetName(name);
  if (!safe) return { success: false, error: "Invalid preset name." };
  const script = [
    "set -e",
    `SRC="${PRESETS}/${safe}"`,
    `ROOT="${ROOT}"`,
    'if [ ! -d "$SRC" ]; then echo "Preset not found"; exit 2; fi',
    'BK="$ROOT/.ronbot-personality-backup/preset-apply-$(date +%Y%m%d-%H%M%S)"',
    'mkdir -p "$BK/hermes-root" "$BK/memories" "$ROOT/memories"',
    'for f in SOUL.md PERSONALITY.md AGENTS.md; do',
    '  if [ -f "$ROOT/$f" ]; then cp "$ROOT/$f" "$BK/hermes-root/$f"; fi',
    "done",
    'for f in MEMORY.md USER.md; do',
    '  if [ -f "$ROOT/memories/$f" ]; then cp "$ROOT/memories/$f" "$BK/memories/$f"; fi',
    "done",
    'for f in SOUL.md PERSONALITY.md AGENTS.md; do',
    '  if [ -f "$SRC/$f" ]; then cp "$SRC/$f" "$ROOT/$f"; chmod 600 "$ROOT/$f"; fi',
    "done",
    'for f in MEMORY.md USER.md; do',
    '  if [ -f "$SRC/memories/$f" ]; then cp "$SRC/memories/$f" "$ROOT/memories/$f"; chmod 600 "$ROOT/memories/$f"; fi',
    "done",
    'echo ok',
  ].join("\n");
  const r = await runHermesShell(script, { timeout: 30_000 });
  if (!r.success || /not found/i.test(r.stdout || "")) {
    return { success: false, error: r.stderr || r.stdout || "apply preset failed" };
  }
  return { success: true };
}

export async function deletePersonalityPreset(name: string): Promise<{ success: boolean; error?: string }> {
  const safe = sanitizePersonalityPresetName(name);
  if (!safe) return { success: false, error: "Invalid preset name." };
  const script = [
    "set -e",
    `DEST="${PRESETS}/${safe}"`,
    'if [ ! -d "$DEST" ]; then exit 0; fi',
    'rm -rf "$DEST"',
    'echo ok',
  ].join("\n");
  const r = await runHermesShell(script, { timeout: 15_000 });
  if (!r.success) return { success: false, error: r.stderr || r.stdout || "delete preset failed" };
  return { success: true };
}

/** Snapshot active persona files into ~/.hermes/personalities/Default/ (no-op if root files missing). */
export async function saveDefaultPersonalityPreset(): Promise<{ success: boolean; error?: string }> {
  return savePersonalityPreset("Default");
}
