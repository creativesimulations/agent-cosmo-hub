/**
 * Slash command palette for the chat composer.
 *
 * Opens when the user types "/" at the start of the chat input. Surfaces
 * the capability catalog as a fuzzy-filterable list. Selecting an entry
 * replaces the input with that capability's `setupPrompt` so the user
 * doesn't have to remember the exact wording — the agent then drives
 * the rest via the intent protocol.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import * as Icons from "lucide-react";
import { CAPABILITY_CATALOG, type CapabilityEntry } from "@/lib/capabilities/catalog";
import { cn } from "@/lib/utils";

interface SlashCommandPaletteProps {
  /** The current chat input value. The palette opens iff this starts with "/". */
  value: string;
  /** Replace the chat input with the chosen prompt. */
  onPick: (prompt: string) => void;
  /** Hide the palette (e.g. on Escape or blur). */
  onDismiss: () => void;
}

const resolveIcon = (name: string): React.ComponentType<{ className?: string }> => {
  const lib = Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>;
  return lib[name] ?? Icons.Sparkles;
};

const matches = (entry: CapabilityEntry, query: string): boolean => {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    entry.id.toLowerCase().includes(q) ||
    entry.name.toLowerCase().includes(q) ||
    entry.oneLiner.toLowerCase().includes(q)
  );
};

const SlashCommandPalette = ({ value, onPick, onDismiss }: SlashCommandPaletteProps) => {
  const open = value.startsWith("/");
  const query = open ? value.slice(1).trim() : "";
  const filtered = useMemo(
    () => CAPABILITY_CATALOG.filter((e) => matches(e, query)).slice(0, 8),
    [query],
  );
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset highlight whenever the visible list changes.
  useEffect(() => {
    setActive(0);
  }, [query, filtered.length]);

  // Listen for keyboard nav while the palette is open.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
        return;
      }
      if (filtered.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (i + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const entry = filtered[active];
        if (entry) onPick(entry.setupPrompt);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, filtered, active, onPick, onDismiss]);

  if (!open) return null;

  return (
    <div
      className="absolute left-0 right-0 bottom-full mb-2 mx-4 rounded-xl border border-primary/30 bg-background/95 backdrop-blur-md shadow-lg overflow-hidden z-20"
      role="listbox"
      aria-label="Capability shortcuts"
    >
      <div className="px-3 py-2 border-b border-white/5 text-[11px] uppercase tracking-wider text-muted-foreground/70 flex items-center justify-between">
        <span>Capability shortcuts</span>
        <span className="text-muted-foreground/50">↑↓ navigate · ↵ pick · Esc close</span>
      </div>
      {filtered.length === 0 ? (
        <div className="px-3 py-4 text-xs text-muted-foreground">
          No matching capabilities. Just ask the agent in plain English.
        </div>
      ) : (
        <div ref={listRef} className="max-h-72 overflow-y-auto">
          {filtered.map((entry, i) => {
            const Icon = resolveIcon(entry.icon);
            const isActive = i === active;
            return (
              <button
                key={entry.id}
                type="button"
                role="option"
                aria-selected={isActive}
                onMouseEnter={() => setActive(i)}
                onClick={() => onPick(entry.setupPrompt)}
                className={cn(
                  "w-full text-left px-3 py-2 flex items-start gap-3 transition-colors",
                  isActive ? "bg-primary/10" : "hover:bg-white/5",
                )}
              >
                <div className="w-7 h-7 rounded-md bg-primary/15 text-primary flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">
                    /{entry.id}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">{entry.name}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">{entry.oneLiner}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SlashCommandPalette;
