import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import GlassCard from "@/components/ui/GlassCard";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { ThemeMode } from "@/contexts/SettingsContext";
import { ChevronDown } from "lucide-react";

export const ToggleRow = ({
  title,
  description,
  checked,
  onCheckedChange,
  disabled,
  trailing,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  trailing?: ReactNode;
}) => (
  <div className="flex items-start justify-between gap-4 py-3 border-b border-border/40 last:border-b-0">
    <div className="space-y-0.5 min-w-0 flex-1">
      <Label className="text-sm font-medium text-foreground cursor-pointer">{title}</Label>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
    <div className="flex items-center gap-2 shrink-0">
      {trailing}
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  </div>
);

export const ThemeOption = ({
  mode,
  current,
  onSelect,
  icon: Icon,
  label,
}: {
  mode: ThemeMode;
  current: ThemeMode;
  onSelect: (m: ThemeMode) => void;
  icon: LucideIcon;
  label: string;
}) => {
  const active = mode === current;
  return (
    <button
      type="button"
      onClick={() => onSelect(mode)}
      className={cn(
        "flex flex-col items-center gap-2 px-4 py-3 rounded-lg border transition-all",
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border bg-background/30 text-muted-foreground hover:text-foreground hover:border-border",
      )}
    >
      <Icon className={cn("w-5 h-5", active && "text-primary")} />
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
};

/**
 * Collapsible Settings section. `bare` skips the outer GlassCard frame.
 */
export const SettingsSection = ({
  icon: Icon,
  title,
  iconClassName,
  bare,
  className,
  children,
}: {
  icon: LucideIcon;
  title: string;
  iconClassName?: string;
  bare?: boolean;
  className?: string;
  children: ReactNode;
}) => {
  const Header = (
    <CollapsibleTrigger
      className={cn(
        "group w-full flex items-center justify-between gap-3 rounded-lg text-left transition-colors",
        bare ? "px-5 py-4 glass hover:bg-foreground/5" : "hover:bg-foreground/5 -m-2 p-2",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn("w-5 h-5 text-primary", iconClassName)} />
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      </div>
      <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  );

  if (bare) {
    return (
      <Collapsible defaultOpen={false} className={cn("rounded-xl", className)}>
        {Header}
        <CollapsibleContent>
          <div className="mt-3">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <GlassCard className={cn("p-6", className)}>
      <Collapsible defaultOpen={false}>
        {Header}
        <CollapsibleContent>
          <div className="pt-4 space-y-4">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    </GlassCard>
  );
};
