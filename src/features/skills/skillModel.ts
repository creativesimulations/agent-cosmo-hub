// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { invalidateCapabilityProbeCache } from "@/lib/capabilityProbe";
import { invalidateDiscoveryCache } from "@/lib/capabilities/discovery";
import { invalidateListSkillsCache } from "@/lib/systemAPI/hermes/listSkills";

export type ListedSkill = {
  name: string;
  category: string;
  source: "user" | "bundled";
  description?: string;
  requiredSecrets?: string[];
};

export type SkillStatusTone = "ready" | "needs" | "disabled";

export type SkillStatus = {
  label: string;
  tone: SkillStatusTone;
  missingSecrets: string[];
};

const RECIPE_HINTS: Record<string, string> = {
  "google-workspace":
    "Run `hermes auth google-workspace` in your shell. Use Ronbot credential_request / oauth_open intents for client ID, secret, and consent — never ask for secrets in plain chat.",
  whatsapp:
    "Run `hermes whatsapp` in your shell. Use qr_display or pairing_approve intents when the wizard shows a QR or pairing code.",
  telegram:
    "Run `hermes telegram` if needed. Collect TELEGRAM_API_ID and TELEGRAM_API_HASH via credential_request intents.",
};

/** Invalidate caches after install, enable/disable, or reload — call CapabilitiesContext.rediscover() from UI after this. */
export function invalidateSkillCaches(): void {
  invalidateListSkillsCache();
  invalidateDiscoveryCache();
  invalidateCapabilityProbeCache();
}

export function skillStatus(
  skill: ListedSkill,
  disabledSet: ReadonlySet<string>,
  secretKeys: ReadonlySet<string>,
): SkillStatus {
  if (disabledSet.has(skill.name)) {
    return { label: "Disabled", tone: "disabled", missingSecrets: [] };
  }
  const missingSecrets = (skill.requiredSecrets ?? []).filter((k) => !secretKeys.has(k));
  if (missingSecrets.length > 0) {
    return { label: "Needs setup", tone: "needs", missingSecrets };
  }
  return { label: "Ready", tone: "ready", missingSecrets: [] };
}

export function skillSetupPrompt(skill: ListedSkill): string {
  const key = skill.name.toLowerCase();
  const recipe = RECIPE_HINTS[key];
  const secrets =
    skill.requiredSecrets && skill.requiredSecrets.length > 0
      ? ` Required secrets: ${skill.requiredSecrets.join(", ")}.`
      : "";
  const base =
    `Please set up the "${skill.name}" skill for me. Enable it in ~/.hermes if needed, install any missing pieces, and walk me through login or permissions.${secrets}`;
  if (recipe) {
    return `${base} ${recipe} When finished, confirm it works and tell me what I can ask you to do with this skill.`;
  }
  return `${base} Use Ronbot credential_request intents for any API keys. When finished, confirm it works.`;
}

export function skillRowKey(skill: ListedSkill): string {
  return `${skill.category}/${skill.name}`;
}
