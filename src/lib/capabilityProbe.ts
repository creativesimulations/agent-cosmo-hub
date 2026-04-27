/**
 * capabilityProbe — verify the *real* state of a capability instead of
 * trusting the agent's self-diagnosis. The agent often says "permission
 * error in this environment" when, in reality, no browser/fetch skill is
 * installed at all. This probe checks the ground truth:
 *
 *   1. Internet permission in ~/.hermes/config.yaml
 *   2. Whether any candidateSkills are installed AND not disabled
 *   3. Whether any candidateSecrets exist in the secrets store
 *   4. For browser-class capabilities: whether Python extras (e.g.
 *      `playwright`) are importable on the agent's interpreter.
 *
 * Results are cached for 60s so the chat path is cheap and we don't
 * shell out repeatedly when several messages fail back-to-back.
 */

import { systemAPI } from "@/lib/systemAPI";
import { BUILTIN_CAPABILITIES, type CapabilityDefinition } from "@/lib/capabilities";

export type ProbeReason =
  | "ready"
  | "noSkill"
  | "noKey"
  | "noExtras"
  | "permissionDenied"
  | "unknown";

export interface CapabilityProbeResult {
  capabilityId: string;
  ready: boolean;
  reason: ProbeReason;
  /** Human-readable, user-facing diagnosis. */
  message: string;
  /** Optional install hint (e.g. `pip install hermes-agent[web]`). */
  installHint?: string;
  /** Skills the user could install to fix this. */
  candidateSkills: string[];
  /** Secret keys (any one) that would fix this. */
  candidateSecrets: string[];
}

interface CacheEntry {
  at: number;
  result: CapabilityProbeResult;
}
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

const findCap = (capId: string): CapabilityDefinition | undefined => {
  return BUILTIN_CAPABILITIES.find((c) => c.id === capId);
};

interface ProbeContext {
  configYaml: string | null;
  installedSkillNames: Set<string>;
  disabledSkillNames: Set<string>;
  storedSecrets: Set<string>;
}

let ctxCache: { at: number; ctx: ProbeContext } | null = null;
const CTX_TTL_MS = 30_000;

const gatherContext = async (): Promise<ProbeContext> => {
  if (ctxCache && Date.now() - ctxCache.at < CTX_TTL_MS) return ctxCache.ctx;
  const ctx: ProbeContext = {
    configYaml: null,
    installedSkillNames: new Set(),
    disabledSkillNames: new Set(),
    storedSecrets: new Set(),
  };
  try {
    const cfg = await systemAPI.readConfig?.();
    if (cfg && cfg.success && cfg.content) ctx.configYaml = cfg.content;
  } catch { /* best effort */ }
  try {
    const r = await systemAPI.listSkills?.();
    if (r && r.success && Array.isArray(r.skills)) {
      for (const s of r.skills) ctx.installedSkillNames.add(s.name.toLowerCase());
    }
  } catch { /* best effort */ }
  try {
    const r = await systemAPI.getSkillsConfig?.();
    if (r && Array.isArray(r.disabled)) {
      for (const n of r.disabled) ctx.disabledSkillNames.add(n.toLowerCase());
    }
  } catch { /* best effort */ }
  try {
    const r = await systemAPI.secrets?.list?.();
    if (r && Array.isArray(r.keys)) {
      for (const k of r.keys) ctx.storedSecrets.add(k);
    }
  } catch { /* best effort */ }
  ctxCache = { at: Date.now(), ctx };
  return ctx;
};

/** Force-clear caches — call after install / skill toggle / secret change. */
export const invalidateCapabilityProbeCache = () => {
  cache.clear();
  ctxCache = null;
};

const internetIsDenied = (yaml: string | null): boolean => {
  if (!yaml) return false;
  // Look for `internet: deny` (or `internet: false`) inside the permissions block.
  const m = yaml.match(/^\s*internet\s*:\s*(\w+)/m);
  if (!m) return false;
  const v = m[1].toLowerCase();
  return v === "deny" || v === "false" || v === "off" || v === "no";
};

const checkPythonExtra = async (importName: string): Promise<boolean> => {
  if (typeof window === "undefined" || !window.electronAPI) return true; // can't check; assume ok
  try {
    const cmd = `python3 -c "import ${importName}" 2>/dev/null && echo OK || (python -c "import ${importName}" 2>/dev/null && echo OK)`;
    const r = await systemAPI.runCommand?.(cmd, { timeoutMs: 8000 });
    if (!r) return true;
    return /OK/.test((r.stdout as string) || "");
  } catch {
    return true;
  }
};

const hasHermesCliToolset = (yaml: string | null): boolean => {
  if (!yaml) return false;
  return /(^|\n)\s*-\s*hermes-cli\b/m.test(yaml) || /(^|\n)\s*-\s*hermes-web\b/m.test(yaml);
};

const EXTRA_IMPORT: Record<string, string> = {
  web: "playwright",
  voice: "elevenlabs",
  messaging: "telegram",
};

/**
 * Probe a capability. Returns a precise, user-facing diagnosis.
 */
export const capabilityProbe = async (
  capabilityId: string,
): Promise<CapabilityProbeResult> => {
  const cached = cache.get(capabilityId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

  const cap = findCap(capabilityId);
  if (!cap) {
    const result: CapabilityProbeResult = {
      capabilityId,
      ready: false,
      reason: "unknown",
      message: "Unknown capability — install a skill or contact support.",
      candidateSkills: [],
      candidateSecrets: [],
    };
    cache.set(capabilityId, { at: Date.now(), result });
    return result;
  }

  const ctx = await gatherContext();

  // 1. Internet permission gate (only for web-class capabilities).
  if (cap.group === "web" || capabilityId === "internet") {
    if (internetIsDenied(ctx.configYaml)) {
      const result: CapabilityProbeResult = {
        capabilityId,
        ready: false,
        reason: "permissionDenied",
        message: `Internet access is set to "deny" in your agent config. Switch it to "allow" or "ask" in Settings → Permissions.`,
        candidateSkills: cap.candidateSkills,
        candidateSecrets: cap.candidateSecrets,
      };
      cache.set(capabilityId, { at: Date.now(), result });
      return result;
    }
  }

  // 2. Skill present (and enabled)?
  const installedAndEnabled = cap.candidateSkills.some((cs) => {
    const lower = cs.toLowerCase();
    return ctx.installedSkillNames.has(lower) && !ctx.disabledSkillNames.has(lower);
  });
  const builtinToolsetReady = cap.source === "builtin" && hasHermesCliToolset(ctx.configYaml);
  if (cap.candidateSkills.length > 0 && !installedAndEnabled && !builtinToolsetReady) {
    const skillList = cap.candidateSkills.slice(0, 3).join(", ");
    const result: CapabilityProbeResult = {
      capabilityId,
      ready: false,
      reason: "noSkill",
      message: `Ron has no ${cap.label.toLowerCase()} skill installed (looking for: ${skillList}). Open Skills & Tools to add one.`,
      candidateSkills: cap.candidateSkills,
      candidateSecrets: cap.candidateSecrets,
    };
    cache.set(capabilityId, { at: Date.now(), result });
    return result;
  }

  // 3. Secret present?
  // Special-case webBrowser: any one configured backend (Browserbase pair,
  // Browser Use, Camofox URL, or Firecrawl) is enough to be considered ready.
  // Browserbase requires BOTH api key + project id, so a generic "any one of
  // candidateSecrets" check isn't enough.
  let hasSecret =
    cap.candidateSecrets.length === 0 ||
    cap.candidateSecrets.some((k) => ctx.storedSecrets.has(k));
  if (capabilityId === "webBrowser") {
    const bbase =
      ctx.storedSecrets.has("BROWSERBASE_API_KEY") &&
      ctx.storedSecrets.has("BROWSERBASE_PROJECT_ID");
    const buse = ctx.storedSecrets.has("BROWSER_USE_API_KEY");
    const cam = ctx.storedSecrets.has("CAMOFOX_URL");
    const fc = ctx.storedSecrets.has("FIRECRAWL_API_KEY");
    hasSecret = bbase || buse || cam || fc;
  }
  if (!hasSecret) {
    const message =
      capabilityId === "webBrowser"
        ? 'No browser backend configured. Click "Set up browser" to pick Browserbase, Camofox, or Local Chrome.'
        : `Ron needs an API key to use ${cap.label.toLowerCase()}. Add one of: ${cap.candidateSecrets.slice(0, 3).join(" / ")} in Secrets.`;
    const result: CapabilityProbeResult = {
      capabilityId,
      ready: false,
      reason: "noKey",
      message,
      candidateSkills: cap.candidateSkills,
      candidateSecrets: cap.candidateSecrets,
    };
    cache.set(capabilityId, { at: Date.now(), result });
    return result;
  }

  // 4. Python extras (best-effort, only checked when an extra is declared).
  if (cap.extrasPackage) {
    const importName = EXTRA_IMPORT[cap.extrasPackage];
    if (importName) {
      const ok = await checkPythonExtra(importName);
      if (!ok) {
        const result: CapabilityProbeResult = {
          capabilityId,
          ready: false,
          reason: "noExtras",
          message: `Ron is missing the Python extras for ${cap.label.toLowerCase()}.`,
          installHint: `pip install hermes-agent[${cap.extrasPackage}]`,
          candidateSkills: cap.candidateSkills,
          candidateSecrets: cap.candidateSecrets,
        };
        cache.set(capabilityId, { at: Date.now(), result });
        return result;
      }
    }
  }

  const result: CapabilityProbeResult = {
    capabilityId,
    ready: true,
    reason: "ready",
    message: `${cap.label} setup looks fine on Ron's side. The agent may have hallucinated a block — try rephrasing or check the agent log.`,
    candidateSkills: cap.candidateSkills,
    candidateSecrets: cap.candidateSecrets,
  };
  cache.set(capabilityId, { at: Date.now(), result });
  return result;
};
