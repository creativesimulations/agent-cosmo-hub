import SOUL_RAW from "@repoRoot/SOUL.md?raw";
import PERSONALITY_RAW from "@repoRoot/PERSONALITY.md?raw";
import MEMORY_RAW from "@repoRoot/MEMORY.md?raw";
import USER_RAW from "@repoRoot/USER.md?raw";

/** Bundled from repo root — written to ~/.hermes/PERSONALITY.md */
export const DEFAULT_PERSONALITY_MARKDOWN = PERSONALITY_RAW;

/** Bundled from repo root — written to ~/.hermes/memories/MEMORY.md */
export const DEFAULT_MEMORY_MARKDOWN = MEMORY_RAW;

/** Bundled from repo root — written to ~/.hermes/memories/USER.md */
export const DEFAULT_USER_MARKDOWN = USER_RAW;

/** Strip characters that would break markdown emphasis around the display name. */
const sanitizeDisplayName = (name: string) => name.replace(/[*#`]/g, "").trim() || "Ron";

/** Parse display name from Ronbot SOUL.md or legacy single-line H1 persona files. */
export function parseAgentDisplayNameFromSoul(content: string): string | null {
  const mTemplate = content.match(/\*\*([^*]+)\*\*,\s*the user's personal AI agent/i);
  if (mTemplate) return mTemplate[1].trim();
  const mLegacy = content.match(/^#\s+(.+?)\s*$/m);
  if (mLegacy) {
    const title = mLegacy[1].trim();
    if (!/^SOUL\b/i.test(title)) return title;
  }
  return null;
}

/**
 * Build SOUL.md for ~/.hermes from the repo-root SOUL.md, replacing the
 * `## Identity` section through the line before `## Style` with a Ronbot
 * display-name block so getAgentName() can parse **Name**.
 */
export function buildDefaultSoulMarkdown(agentName: string): string {
  const n = sanitizeDisplayName(agentName || "Ron");
  const identity = `## Identity
You are **${n}**, the user's personal AI agent (configured in Ronbot during installation). When asked who you are or what your name is, respond as **${n}** — not as "Hermes" or a generic label. You are powered by the Hermes Agent framework (Nous Research) and have full access to its tools, skills, and memory.

You remain a helpful, reliable assistant for individuals and small businesses: you plan, coordinate, delegate, verify, and report clearly, with daily task management, web research, synthesis, and beginner-friendly guidance.

You communicate in plain language, acknowledge messages quickly, and give transparent status updates.
`;
  const base = SOUL_RAW.replace(/\r\n/g, "\n").trimEnd();
  const replaced = base.replace(/^## Identity\s*[\s\S]*?(?=\n## Style\b)/m, identity.trimEnd());
  if (replaced !== base) {
    return replaced.endsWith("\n") ? replaced : `${replaced}\n`;
  }
  // Repo SOUL.md layout changed (e.g. no `## Style`) — splice identity before first `## Style` or append.
  const styleBlock = base.match(/\n(## Style\b[\s\S]*)/);
  if (styleBlock) {
    const out = `${identity.trimEnd()}${styleBlock[1]}`;
    return out.endsWith("\n") ? out : `${out}\n`;
  }
  const out = `${identity.trimEnd()}\n\n${base}\n`;
  return out;
}
