// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

let mermaidReady = false;

function ensureMermaidTheme() {
  if (mermaidReady) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "dark",
    fontFamily: "Inter, JetBrains Mono, system-ui, sans-serif",
  });
  mermaidReady = true;
}

export function MermaidDiagram({ definition }: { definition: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(`ronbot-mmd-${Math.random().toString(36).slice(2, 11)}`);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setError(null);
      ensureMermaidTheme();
      const id = idRef.current;
      try {
        const { svg, bindFunctions } = await mermaid.render(id, definition);
        if (cancelled || !hostRef.current) return;
        hostRef.current.innerHTML = svg;
        bindFunctions?.(hostRef.current);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Invalid Mermaid diagram");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [definition]);

  if (error) {
    return (
      <pre className="text-xs text-destructive/90 whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/10 p-2 my-2">
        {error}
      </pre>
    );
  }

  return (
    <div
      ref={hostRef}
      className="my-2 overflow-x-auto rounded-md border border-white/10 bg-background/30 p-2 [&_svg]:max-w-full"
    />
  );
}
