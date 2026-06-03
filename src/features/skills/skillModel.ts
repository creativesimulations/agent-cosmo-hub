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
  const secrets =
    skill.requiredSecrets && skill.requiredSecrets.length > 0
      ? ` Required secrets: ${skill.requiredSecrets.join(", ")}.`
      : "";
  return `Please set up the "${skill.name}" skill for me.${secrets} When finished, confirm it works and tell me what I can ask you to do with this skill.`;
}

export function skillRowKey(skill: ListedSkill): string {
  return `${skill.category}/${skill.name}`;
}
