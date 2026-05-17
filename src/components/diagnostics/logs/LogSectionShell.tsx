import type { ReactNode } from 'react';
import GlassCard from '@/components/ui/GlassCard';

type Props = {
  title: string;
  description?: string;
  toolbar?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function LogSectionShell({ title, description, toolbar, children, className }: Props) {
  return (
    <section className={className}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
        {toolbar}
      </div>
      <GlassCard className="p-3">{children}</GlassCard>
    </section>
  );
}
