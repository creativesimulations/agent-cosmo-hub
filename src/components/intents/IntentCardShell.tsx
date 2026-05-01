import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { ExternalLink } from 'lucide-react';

interface IntentCardShellProps {
  /** Lucide icon component (rendered at w-4 h-4). */
  icon: ReactNode;
  title: string;
  description?: string;
  /** Optional URL rendered as an "Open in browser" link in the header. */
  openUrl?: string;
  /** Card body content. */
  children: ReactNode;
  /** Footer with action buttons. */
  footer?: ReactNode;
  /** Visual style hint — danger uses a destructive border. */
  tone?: 'default' | 'success' | 'danger';
  /** When true, the card is locked (already answered). */
  locked?: boolean;
}

/**
 * Shared chrome for every intent card so they look like one design family
 * inside the chat: subtle glass, primary accent, optional external-link
 * pill in the header, and a footer slot for actions. Inherits the existing
 * Ronbot dark-glass tokens — no new colors.
 */
const IntentCardShell = ({
  icon,
  title,
  description,
  openUrl,
  children,
  footer,
  tone = 'default',
  locked = false,
}: IntentCardShellProps) => {
  const borderTone =
    tone === 'danger'
      ? 'border-destructive/40'
      : tone === 'success'
        ? 'border-success/40'
        : 'border-primary/30';

  return (
    <div
      className={cn(
        'mt-2 rounded-xl border bg-background/40 backdrop-blur-sm overflow-hidden',
        borderTone,
        locked && 'opacity-70',
      )}
    >
      <div className="px-4 py-3 border-b border-white/5 flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-foreground leading-tight">{title}</h4>
          {description && (
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
          )}
        </div>
        {openUrl && (
          <a
            href={openUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline shrink-0"
          >
            Open
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
      <div className="px-4 py-3 space-y-3">{children}</div>
      {footer && (
        <div className="px-4 py-3 border-t border-white/5 bg-white/5 flex items-center justify-end gap-2">
          {footer}
        </div>
      )}
    </div>
  );
};

export default IntentCardShell;
