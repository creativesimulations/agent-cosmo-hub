/**
 * Slash command palette for the chat composer.
 *
 * Opens when the user types "/" at the start of the chat input. Surfaces
 * the live agent capability registry as a fuzzy-filterable list. Selecting
 * an entry replaces the input with that capability's `setupPrompt` so the
 * user doesn't have to remember the exact wording — the agent then drives
 * the rest via the intent protocol.
 *
 * The list is **not** hard-coded — it's derived from
 * `useCapabilities().discovered`, so new channels/tools/skills the agent
 * supports show up automatically.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import * as Icons from "lucide-react";
import { useCapabilities } from "@/contexts/CapabilitiesContext";
import type { DiscoveredCapability } from "@/lib/capabilities/types";
import { cn } from "@/lib/utils";

interface SlashCommandPaletteProps {
  /** The current chat input value. The palette opens iff this starts with "/". */
  value: string;
  /** Replace the chat input with the chosen prompt. */
  onPick: (prompt: string) => void;
  /** Hide the palette (e.g. on Escape or blur). */
  onDismiss: () => void;
}

const resolveIcon = (name?: string): React.ComponentType<{ className?: string }> => {
  if (!name) return Icons.Sparkles;
  const lib = Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>;
  return lib[name] ?? Icons.Sparkles;
};

/**
 * Built-in agent meta-commands. These are not "capabilities" the agent
 * provides via discovery — they're directives the user gives the agent
 * (switch to voice mode, run in background, show usage analytics). The
 * agent owns the actual behavior; the palette just seeds the prompt.
 */
const BUILTIN_COMMANDS: DiscoveredCapability[] = [
  {
    id: "voice",
    kind: "tool",
    name: "Voice mode",
    oneLiner: "Talk to the agent out loud — speech in and speech out.",
    icon: "Mic",
    category: "media",
    requiresSetup: false,
    requiredSecrets: [],
    optionalSecrets: [],
    setupPrompt: "Switch to voice mode — I want to talk to you out loud.",
    source: "seed",
  },
  {
    id: "background",
    kind: "tool",
    name: "Background session",
    oneLiner: "Run a long task while I close the app.",
    icon: "Moon",
    category: "computer",
    requiresSetup: false,
    requiredSecrets: [],
    optionalSecrets: [],
    setupPrompt: "Run this in the background so I can close the app and you keep working.",
    source: "seed",
  },
  {
    id: "insights",
    kind: "tool",
    name: "Insights",
    oneLiner: "Show me what you've been doing — usage, sessions, channels.",
    icon: "BarChart3",
    category: "knowledge",
    requiresSetup: false,
    requiredSecrets: [],
    optionalSecrets: [],
    setupPrompt: "Give me a summary of what you've been doing — recent activity, busiest channels, anything I should know about.",
    source: "seed",
  },
];

const matches = (entry: DiscoveredCapability, query: string): boolean => {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    entry.id.toLowerCase().includes(q) ||
    entry.name.toLowerCase().includes(q) ||
    entry.oneLiner.toLowerCase().includes(q)
  );
};

const SlashCommandPalette = ({ value, onPick, onDismiss }: SlashCommandPaletteProps) => {
  const { discovered } = useCapabilities();
  const open = value.startsWith("/");
  const query = open ? value.slice(1).trim() : "";
  const filtered = useMemo(() => {
    // Merge built-ins first (so /voice, /background, /insights show even
    // before discovery runs). Discovered entries override any built-in
    // with the same id.
    const merged: Record<string, DiscoveredCapability> = {};
    for (const c of BUILTIN_COMMANDS) merged[c.id] = c;
    for (const [id, c] of Object.entries(discovered)) merged[id] = c;
    return Object.values(merged)
      .filter((e) => matches(e, query))
      .sort((a, b) => {
        // Built-ins float to the top when query is empty so they're discoverable.
        const aBuiltin = BUILTIN_COMMANDS.some((b) => b.id === a.id) ? 0 : 1;
        const bBuiltin = BUILTIN_COMMANDS.some((b) => b.id === b.id && b.id === a.id) ? 0 : 1;
        if (!query && aBuiltin !== bBuiltin) return aBuiltin - bBuiltin;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 10);
  }, [query, discovered]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActive(0);
  }, [query, filtered.length]);

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
