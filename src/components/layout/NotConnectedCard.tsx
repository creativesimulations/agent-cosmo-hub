import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

type Props = {
  title: string;
  description: string;
  ctaLabel?: string;
  ctaTo?: string;
};

export function NotConnectedCard({ title, description, ctaLabel = "Go to Install", ctaTo = "/install" }: Props) {
  return (
    <GlassCard className="p-6 border border-white/10">
      <h3 className="text-sm font-medium text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground mb-4">{description}</p>
      <Button asChild variant="secondary" size="sm">
        <Link to={ctaTo}>{ctaLabel}</Link>
      </Button>
    </GlassCard>
  );
}
