import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type Props = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  /** Right-aligned header actions (buttons, etc.) */
  actions?: ReactNode;
  children: ReactNode;
  /** Extra classes on outer wrapper */
  className?: string;
};

/** Standard page header + padded content for dashboard pages. */
export function PageShell({ title, description, icon: Icon, actions, children, className }: Props) {
  return (
    <div className={`p-6 space-y-6 ${className ?? ""}`}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          {Icon ? (
            <div className="p-2 rounded-lg bg-primary/10 border border-primary/20 shrink-0">
              <Icon className="w-5 h-5 text-primary" />
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold text-foreground tracking-tight">{title}</h1>
            {description ? <p className="text-sm text-muted-foreground mt-1">{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex items-center gap-2 shrink-0">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}
