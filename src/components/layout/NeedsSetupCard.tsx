import type { LucideIcon } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

type Props = {
  title: string;
  description: string;
  icon?: LucideIcon;
  actionLabel?: string;
  actionTo?: string;
};

export function NeedsSetupCard({
  title,
  description,
  icon: Icon,
  actionLabel = "Open settings",
  actionTo = "/settings",
}: Props) {
  return (
    <GlassCard className="p-4 border border-warning/25 bg-warning/5">
      <div className="flex gap-3">
        {Icon ? <Icon className="w-5 h-5 text-warning shrink-0 mt-0.5" /> : null}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link to={actionTo}>{actionLabel}</Link>
          </Button>
        </div>
      </div>
    </GlassCard>
  );
}
