import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";

export type StatItem = {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  hint?: string;
  /** Extra classes on the value line (e.g. text-warning) */
  valueClassName?: string;
};

type Props = {
  stats: StatItem[];
  className?: string;
};

export function StatGrid({ stats, className }: Props) {
  return (
    <div className={`grid gap-3 sm:grid-cols-2 lg:grid-cols-3 ${className ?? ""}`}>
      {stats.map((s) => (
        <GlassCard key={s.label} className="p-4">
          <div className="flex items-center gap-3">
            {s.icon ? (
              <div className="p-2 rounded-md bg-muted/40 border border-white/5">
                <s.icon className="w-4 h-4 text-muted-foreground" />
              </div>
            ) : null}
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">{s.label}</p>
              <p className={`text-lg font-semibold truncate ${s.valueClassName ?? "text-foreground"}`}>
                {s.value}
              </p>
              {s.hint ? <p className="text-xs text-muted-foreground mt-0.5">{s.hint}</p> : null}
            </div>
          </div>
        </GlassCard>
      ))}
    </div>
  );
}
