// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { useState } from "react";
import { ChevronDown, ChevronRight, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  invalidateSkillCaches,
  skillRowKey,
  skillStatus,
  type ListedSkill,
} from "@/features/skills/skillModel";
import { systemAPI } from "@/lib/systemAPI";
import { toast } from "sonner";

type Props = {
  skill: ListedSkill;
  disabled: boolean;
  secretKeys: ReadonlySet<string>;
  highlighted?: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onSetup: (skill: ListedSkill) => void;
  onToggled: () => void;
};

export function SkillRow({
  skill,
  disabled,
  secretKeys,
  highlighted,
  expanded,
  onToggleExpand,
  onSetup,
  onToggled,
}: Props) {
  const [toggling, setToggling] = useState(false);
  const status = skillStatus(skill, new Set(disabled ? [skill.name] : []), secretKeys);
  const enabled = !disabled;

  const handleSwitch = async (next: boolean) => {
    setToggling(true);
    try {
      const r = await systemAPI.setSkillEnabled(skill.name, next);
      if (!r.success) {
        toast.error(`Could not ${next ? "enable" : "disable"} ${skill.name}`, {
          description: r.error,
        });
        return;
      }
      invalidateSkillCaches();
      onToggled();
      toast.success(next ? `Enabled ${skill.name}` : `Disabled ${skill.name}`);
    } finally {
      setToggling(false);
    }
  };

  const missing = status.missingSecrets;

  return (
    <li
      id={`skill-${skillRowKey(skill).replace(/\//g, "-")}`}
      className={cn(
        "glass-subtle rounded-lg border border-white/5 overflow-hidden transition-colors",
        highlighted && "ring-2 ring-primary/40 border-primary/30",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onToggleExpand}
          className="p-1 text-muted-foreground hover:text-foreground shrink-0"
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground truncate">{skill.name}</span>
            <Badge variant="outline" className="text-[10px] border-white/10 text-muted-foreground">
              {skill.source}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px]",
                status.tone === "ready" && "border-success/30 text-success",
                status.tone === "needs" && "border-warning/30 text-warning",
                status.tone === "disabled" && "border-muted-foreground/30 text-muted-foreground",
              )}
            >
              {status.label}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {toggling ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : (
            <Switch checked={enabled} onCheckedChange={(v) => void handleSwitch(v)} aria-label={`Toggle ${skill.name}`} />
          )}
          <Button size="sm" variant="outline" onClick={() => onSetup(skill)}>
            Set up
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="px-3 pb-3 pt-0 space-y-2 border-t border-white/5">
          {skill.description && (
            <p className="text-xs text-muted-foreground leading-relaxed">{skill.description}</p>
          )}
          {missing.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-warning flex items-center gap-1">
                <KeyRound className="w-3 h-3" /> Missing:
              </span>
              {missing.map((k) => (
                <a
                  key={k}
                  href={`#/secrets?focus=${encodeURIComponent(k)}`}
                  className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-warning/30 text-warning hover:bg-warning/10"
                >
                  {k}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
