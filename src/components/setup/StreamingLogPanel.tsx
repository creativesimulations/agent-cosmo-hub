import type { RefObject } from "react";
import { cn } from "@/lib/utils";

export type StreamingLogVariant = "install" | "doctor" | "launch";

function lineClassName(line: string, variant: StreamingLogVariant): string {
  if (line.startsWith("✓")) return "text-success";
  if (line.startsWith("✗")) return "text-destructive";
  if (line.startsWith("$")) return "text-muted-foreground";
  return variant === "launch" ? "text-muted-foreground" : "text-foreground/70";
}

type Props = {
  lines: string[];
  variant: StreamingLogVariant;
  scrollRef?: RefObject<HTMLDivElement | null>;
  className?: string;
};

/** Shared install / doctor / launch log styling for the Index wizard. */
export function StreamingLogPanel({ lines, variant, scrollRef, className }: Props) {
  return (
    <div ref={scrollRef} className={cn("font-mono text-xs space-y-1 max-h-40 overflow-y-auto pr-1", className)}>
      {lines.map((line, i) => (
        <p key={i} className={lineClassName(line, variant)}>
          {line}
        </p>
      ))}
    </div>
  );
}
