// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { SkillRow } from "@/components/skills/SkillRow";
import { skillRowKey, type ListedSkill } from "@/features/skills/skillModel";

type Props = {
  categories: [string, ListedSkill[]][];
  disabledSet: ReadonlySet<string>;
  secretKeys: ReadonlySet<string>;
  expanded: ReadonlySet<string>;
  highlightName?: string | null;
  onToggleExpand: (key: string) => void;
  onSetup: (skill: ListedSkill) => void;
  onToggled: () => void;
};

export function SkillsByCategory({
  categories,
  disabledSet,
  secretKeys,
  expanded,
  highlightName,
  onToggleExpand,
  onSetup,
  onToggled,
}: Props) {
  if (categories.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No skills match your search.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {categories.map(([category, items]) => (
        <section key={category} className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 px-1">
            {category}
          </h3>
          <ul className="space-y-2">
            {items.map((skill) => {
              const key = skillRowKey(skill);
              const hl =
                !!highlightName &&
                (skill.name.toLowerCase() === highlightName.toLowerCase() ||
                  highlightName.toLowerCase().includes(skill.name.toLowerCase()));
              return (
                <SkillRow
                  key={key}
                  skill={skill}
                  disabled={disabledSet.has(skill.name)}
                  secretKeys={secretKeys}
                  highlighted={hl}
                  expanded={expanded.has(key)}
                  onToggleExpand={() => onToggleExpand(key)}
                  onSetup={onSetup}
                  onToggled={onToggled}
                />
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
