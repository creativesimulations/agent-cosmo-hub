import { cn } from '@/lib/utils';

type Props = {
  text: string;
  emptyMessage?: string;
  className?: string;
  maxHeight?: string;
};

export function LogTextPanel({
  text,
  emptyMessage = 'No log output yet.',
  className,
  maxHeight = 'max-h-72',
}: Props) {
  if (!text.trim()) {
    return (
      <p className={cn('text-xs text-muted-foreground py-6 text-center', className)}>
        {emptyMessage}
      </p>
    );
  }

  return (
    <pre
      className={cn(
        'p-3 rounded-md border border-border/60 bg-background/50',
        'text-[11px] font-mono whitespace-pre-wrap break-words',
        'overflow-auto select-text',
        maxHeight,
        className,
      )}
    >
      {text}
    </pre>
  );
}
