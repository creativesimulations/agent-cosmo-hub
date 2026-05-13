// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { lazy, Suspense } from "react";

const ChatMessageMarkdownLazy = lazy(() =>
  import("./ChatMessageMarkdown").then((m) => ({ default: m.ChatMessageMarkdown })),
);

type Props = { content: string; className?: string };

const Fallback = () => (
  <p className="text-sm text-muted-foreground/80 animate-pulse" aria-hidden>
    Loading formatter…
  </p>
);

/** Code-splits react-markdown + mermaid until first assistant markdown render. */
export function LazyChatMessageMarkdown({ content, className }: Props) {
  if (!content.trim()) return null;
  return (
    <Suspense fallback={<Fallback />}>
      <ChatMessageMarkdownLazy content={content} className={className} />
    </Suspense>
  );
}
