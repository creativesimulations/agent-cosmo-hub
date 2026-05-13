// Hermes v0.13.0 sync — May 2026 (Ronbot)
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { MermaidDiagram } from "./MermaidDiagram";
import { cn } from "@/lib/utils";

const markdownComponents: Components = {
  h1: ({ children }) => <h1 className="text-lg font-bold mt-3 mb-2 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-base font-semibold mt-3 mb-2 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1 first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ href, children }) => (
    <a href={href} className="text-primary underline underline-offset-2 break-all" target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-primary/40 pl-3 my-2 text-muted-foreground italic">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-white/10" />,
  table: ({ children }) => (
    <div className="overflow-x-auto my-2 rounded-md border border-white/10">
      <table className="w-full text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="bg-muted/30 px-2 py-1.5 text-left font-semibold border-b border-white/10">{children}</th>
  ),
  td: ({ children }) => <td className="px-2 py-1.5 border-b border-white/5 align-top">{children}</td>,
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || "");
    const lang = match?.[1];
    const codeText = String(children).replace(/\n$/, "");
    const isBlock = Boolean(className?.includes("language-"));
    if (isBlock && lang === "mermaid") {
      return <MermaidDiagram definition={codeText} />;
    }
    if (isBlock) {
      return (
        <code
          className={cn(
            "block text-xs font-mono whitespace-pre-wrap rounded-md border border-white/10 bg-background/50 p-2 my-2 overflow-x-auto",
            className,
          )}
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <code className="font-mono text-[0.85em] bg-background/50 px-1 py-0.5 rounded border border-white/10" {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => <div className="my-1">{children}</div>,
};

type Props = {
  content: string;
  className?: string;
};

/**
 * Markdown for chat bubbles. No raw HTML (react-markdown default). Mermaid
 * renders fenced ```mermaid blocks lazily.
 */
export function ChatMessageMarkdown({ content, className }: Props) {
  if (!content.trim()) return null;
  return (
    <div className={cn("text-sm text-foreground [&_strong]:font-semibold", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
