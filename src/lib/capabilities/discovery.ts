/**
 * Capability discovery — single entry point that builds the runtime
 * registry consumed by Dashboard tiles, Channels page, slash palette,
 * and (eventually) the permissions panel.
 *
 * Discovery order (later sources merge over / enrich earlier ones):
 *
 *   1. SEED_CAPABILITIES  — instant, always present.
 *   2. installed skills   — `systemAPI.listSkills()`.
 *   3. Hermes CLI         — `systemAPI.discoverCapabilities()` (channels,
 *                           tools, connectors, MCP, …).
 *
 * Each pass is wrapped in try/catch so a single failure never empties
 * the UI. The final result is keyed by capability id with a stable
 * shape (`DiscoveredCapability`).
 */

import { systemAPI } from "@/lib/systemAPI";
import { SEED_CAPABILITIES } from "./seed";
import type {
  DiscoveredCapability,
  DiscoveredCategory,
  DiscoveredKind,
  DiscoveryResult,
} from "./types";

/* ───────────────────────────── helpers ───────────────────────────── */

const titleCase = (s: string): string =>
  s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const inferCategory = (
  name: string,
  hint?: string,
): DiscoveredCategory => {
  const s = `${name} ${hint ?? ""}`.toLowerCase();
  if (/(telegram|slack|whatsapp|discord|signal|matrix|sms|imessage|messag|chat)/.test(s)) return "communication";
  if (/(gmail|email|smtp|calendar|drive|docs|sheets|notion|todo|task)/.test(s)) return "productivity";
  if (/(search|wiki|news|wikipedia|exa|tavily|fetch|youtube)/.test(s)) return "knowledge";
  if (/(file|terminal|shell|bash|browser|chrome|playwright|os|disk)/.test(s)) return "computer";
  if (/(image|audio|voice|tts|stt|video|stable|dall|replicate|gen)/.test(s)) return "media";
  if (/(github|git|code|repo|python|deploy|build)/.test(s)) return "developer";
  return "other";
};

const inferIcon = (name: string, kind: DiscoveredKind, fallback?: string): string => {
  if (fallback) return fallback;
  const s = name.toLowerCase();
  // Channel-specific
  if (s.includes("telegram")) return "Send";
  if (s.includes("slack")) return "Hash";
  if (s.includes("whatsapp")) return "MessageCircle";
  if (s.includes("discord")) return "MessageSquare";
  if (s.includes("signal")) return "Lock";
  if (s.includes("matrix")) return "Hexagon";
  if (s.includes("imessage") || s.includes("bluebubbles")) return "MessagesSquare";
  if (s.includes("sms")) return "Smartphone";
  // Connectors / tools
  if (s.includes("gmail") || s.includes("mail")) return "Mail";
  if (s.includes("calendar")) return "Calendar";
  if (s.includes("drive") || s.includes("folder")) return "FolderOpen";
  if (s.includes("github")) return "Github";
  if (s.includes("youtube")) return "Youtube";
  if (s.includes("search")) return "Search";
  if (s.includes("browser") || s.includes("web")) return "Globe";
  if (s.includes("file")) return "HardDrive";
  if (s.includes("terminal") || s.includes("shell")) return "Terminal";
  if (s.includes("image")) return "Image";
  if (s.includes("voice") || s.includes("audio") || s.includes("tts")) return "Mic";
  if (s.includes("memory") || s.includes("db") || s.includes("database")) return "Database";
  if (kind === "channel") return "Radio";
  if (kind === "skill") return "Puzzle";
  return "Sparkles";
};

const synthesizeSetupPrompt = (
  name: string,
  kind: DiscoveredKind,
  requiresSetup: boolean,
): string => {
  if (kind === "channel") return `Set up ${name} so I can message you from ${name}.`;
  if (requiresSetup) return `Connect ${name} so you can use it for me.`;
  return `Tell me how to use ${name} — I want to try it.`;
};

/** Coerce an unknown CLI entry into a DiscoveredCapability. */
const fromHermesEntry = (
  entry: Record<string, unknown>,
  defaultKind: DiscoveredKind,
): DiscoveredCapability | null => {
  const name = typeof entry.name === "string" ? entry.name : typeof entry.id === "string" ? entry.id : "";
  if (!name) return null;
  const id = typeof entry.id === "string" ? entry.id : name.toLowerCase().replace(/\s+/g, "-");
  const kindRaw = typeof entry.kind === "string" ? entry.kind : defaultKind;
  const kind = (["channel", "tool", "skill", "media", "connector"] as DiscoveredKind[]).includes(
    kindRaw as DiscoveredKind,
  )
    ? (kindRaw as DiscoveredKind)
    : defaultKind;
  const oneLiner =
    typeof entry.description === "string" ? entry.description :
    typeof entry.oneLiner === "string" ? entry.oneLiner :
    typeof entry.tagline === "string" ? entry.tagline :
    `${titleCase(name)} — provided by your agent.`;
  const requiredSecrets = Array.isArray(entry.requiredEnv)
    ? (entry.requiredEnv as unknown[]).filter((x): x is string => typeof x === "string")
    : Array.isArray(entry.requiredSecrets)
      ? (entry.requiredSecrets as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
  const optionalSecrets = Array.isArray(entry.optionalEnv)
    ? (entry.optionalEnv as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const requiresSetup =
    typeof entry.requiresSetup === "boolean" ? entry.requiresSetup :
    requiredSecrets.length > 0 || kind === "channel" || kind === "connector";
  const category = (typeof entry.category === "string" ? entry.category : undefined) as DiscoveredCategory | undefined;
  const docsUrl = typeof entry.docsUrl === "string" ? entry.docsUrl : undefined;
  const setupPrompt =
    typeof entry.setupPrompt === "string" ? entry.setupPrompt :
    synthesizeSetupPrompt(titleCase(name), kind, requiresSetup);
  return {
    id,
    kind,
    name: titleCase(name),
    oneLiner,
    icon: inferIcon(name, kind, typeof entry.icon === "string" ? entry.icon : undefined),
    category: category ?? inferCategory(name, oneLiner),
    requiresSetup,
    requiredSecrets,
    optionalSecrets,
    setupPrompt,
    docsUrl,
    source: "hermes",
  };
};

/** Coerce a discovered skill into a DiscoveredCapability. */
const fromSkill = (skill: { name: string; category?: string; description?: string; requiredSecrets?: string[] }): DiscoveredCapability => {
  const name = titleCase(skill.name);
  const requiredSecrets = skill.requiredSecrets ?? [];
  const requiresSetup = requiredSecrets.length > 0;
  return {
    id: `skill:${skill.name.toLowerCase()}`,
    kind: "skill",
    name,
    oneLiner: skill.description?.trim() || `Skill from your agent — ${name}.`,
    icon: inferIcon(skill.name, "skill"),
    category: inferCategory(skill.name, skill.category) ?? "other",
    requiresSetup,
    requiredSecrets,
    optionalSecrets: [],
    setupPrompt: synthesizeSetupPrompt(name, "skill", requiresSetup),
    source: "skill",
    skillName: skill.name,
  };
};

/* ───────────────────────────── main ───────────────────────────── */

let cache: { at: number; result: DiscoveryResult } | null = null;
const CACHE_TTL_MS = 60_000;

export const discoverCapabilities = async (
  options?: { force?: boolean },
): Promise<DiscoveryResult> => {
  if (!options?.force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.result;
  }

  const errors: string[] = [];
  const capabilities: Record<string, DiscoveredCapability> = {};

  // 1) Seed.
  for (const c of SEED_CAPABILITIES) capabilities[c.id] = { ...c };

  // 2) Hermes CLI.
  let fromHermes = false;
  try {
    const r = await systemAPI.discoverCapabilities();
    if (r.ok && r.raw) {
      fromHermes = true;
      const buckets: Array<[unknown, DiscoveredKind]> = [
        [r.raw.channels, "channel"],
        [r.raw.tools, "tool"],
        [r.raw.connectors, "connector"],
        [r.raw.media, "media"],
      ];
      for (const [list, kind] of buckets) {
        if (!Array.isArray(list)) continue;
        for (const raw of list) {
          if (!raw || typeof raw !== "object") continue;
          const cap = fromHermesEntry(raw as Record<string, unknown>, kind);
          if (!cap) continue;
          // Hermes wins over seed; merge by id.
          const prev = capabilities[cap.id];
          capabilities[cap.id] = prev
            ? {
                ...prev,
                ...cap,
                // Preserve seed examplePrompts if Hermes didn't provide any.
                examplePrompts: cap.examplePrompts ?? prev.examplePrompts,
                requiredSecrets: cap.requiredSecrets.length ? cap.requiredSecrets : prev.requiredSecrets,
                docsUrl: cap.docsUrl ?? prev.docsUrl,
                source: "hermes",
              }
            : cap;
        }
      }
    } else if (r.error && r.error !== "browser-mode") {
      errors.push(r.error);
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  // 3) Installed skills.
  try {
    const r = await systemAPI.listSkills?.();
    if (r && r.success && Array.isArray(r.skills)) {
      for (const skill of r.skills) {
        const cap = fromSkill(skill);
        // Don't shadow a richer Hermes/seed entry that already covers this skill.
        if (capabilities[cap.id]) continue;
        // Check if any existing capability mentions this skill name in its id/name.
        const lower = skill.name.toLowerCase();
        const existing = Object.values(capabilities).find(
          (c) => c.id.toLowerCase() === lower || c.skillName?.toLowerCase() === lower,
        );
        if (existing) continue;
        capabilities[cap.id] = cap;
      }
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  const result: DiscoveryResult = {
    capabilities,
    fromHermes,
    fetchedAt: Date.now(),
    errors,
  };
  cache = { at: Date.now(), result };
  return result;
};

/** Drop the in-memory cache. Used by `rediscover()` in CapabilitiesContext. */
export const invalidateDiscoveryCache = (): void => {
  cache = null;
};

/* ───────────────────────────── selectors ───────────────────────────── */

/** Filter helper used by Channels page / Dashboard tiles. */
export const filterByKind = (
  capabilities: Record<string, DiscoveredCapability>,
  kinds: DiscoveredKind[],
): DiscoveredCapability[] => {
  const set = new Set(kinds);
  return Object.values(capabilities).filter((c) => set.has(c.kind));
};

/** Group helper used by `CapabilityGallery`. */
export const groupByCategory = (
  capabilities: DiscoveredCapability[],
): { category: DiscoveredCategory; entries: DiscoveredCapability[] }[] => {
  const order: DiscoveredCategory[] = [
    "communication", "productivity", "knowledge", "computer", "media", "developer", "other",
  ];
  const map = new Map<DiscoveredCategory, DiscoveredCapability[]>();
  for (const c of capabilities) {
    const list = map.get(c.category) ?? [];
    list.push(c);
    map.set(c.category, list);
  }
  return order
    .filter((cat) => (map.get(cat)?.length ?? 0) > 0)
    .map((cat) => ({
      category: cat,
      entries: (map.get(cat) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    }));
};
