/**
 * Normalized shape used across the app whenever a UI surface needs to
 * answer "what can the agent do?". This is the *runtime-discovered*
 * shape — it is intentionally richer than the policy-only
 * `CapabilityDefinition` in `src/lib/capabilities.ts` because it also
 * powers Dashboard tiles, the Channels page, and the slash palette.
 *
 * The registry is built by `src/lib/capabilities/discovery.ts` from
 * three sources, in priority order:
 *
 *   1. The Hermes CLI (`hermes capabilities --json` etc.).
 *   2. Installed skills (`systemAPI.listSkills()`).
 *   3. A small static seed (this file's siblings) so the UI is never
 *      empty on first launch / older Hermes versions.
 *
 * Anything Hermes ships in the future automatically appears in the
 * three discovery surfaces — no app code change required.
 */

export type DiscoveredKind = "channel" | "tool" | "skill" | "media" | "connector";

export type DiscoveredCategory =
  | "communication"
  | "productivity"
  | "knowledge"
  | "computer"
  | "media"
  | "developer"
  | "other";

export type DiscoveredSource = "hermes" | "skill" | "seed" | "observed";

export interface DiscoveredCapability {
  /** Stable id, lowercase + dash/underscore. Used as policy key + nav id. */
  id: string;
  /** What kind of thing this is — drives which UI surfaces it appears on. */
  kind: DiscoveredKind;
  /** Display name. */
  name: string;
  /** One-line plain-English description. */
  oneLiner: string;
  /** Lucide icon name. Falls back to `Sparkles`. */
  icon?: string;
  /** Category bucket for grouping. */
  category: DiscoveredCategory;
  /** True when the user must connect an account / paste a key first. */
  requiresSetup: boolean;
  /** Env-var keys that activate the capability (any one is enough). */
  requiredSecrets: string[];
  /** Optional env-var keys (improve, but not required). */
  optionalSecrets: string[];
  /**
   * Prompt seeded into the chat composer when the user clicks "Set up".
   * Hermes can override this; otherwise we synthesize one.
   */
  setupPrompt: string;
  /** Optional example prompts surfaced as chips. */
  examplePrompts?: string[];
  /** Optional docs URL. */
  docsUrl?: string;
  /** Where this entry came from. */
  source: DiscoveredSource;
  /** When source = 'skill', the original skill name. */
  skillName?: string;
}

/** A snapshot of the registry returned by discovery. */
export interface DiscoveryResult {
  /** All capabilities, keyed by id. */
  capabilities: Record<string, DiscoveredCapability>;
  /** Did at least one Hermes CLI call succeed? Drives "live vs seed" UX. */
  fromHermes: boolean;
  /** ms timestamp of this snapshot. */
  fetchedAt: number;
  /** Errors collected during discovery (best-effort). */
  errors: string[];
}
