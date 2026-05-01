import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import * as Icons from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { useChat } from "@/contexts/ChatContext";
import { useCapabilities } from "@/contexts/CapabilitiesContext";
import { groupByCategory } from "@/lib/capabilities/discovery";
import type { DiscoveredCapability, DiscoveredCategory } from "@/lib/capabilities/types";
import { cn } from "@/lib/utils";

interface CapabilityGalleryProps {
  /** Compact mode renders smaller tiles for embedding in dashboards. */
  compact?: boolean;
  /** Optional heading override. */
  heading?: string;
  /** Optional subheading override. */
  subheading?: string;
}

const CATEGORY_LABELS: Record<DiscoveredCategory, { label: string; description: string }> = {
  communication: { label: "Communication", description: "Talk to your agent through the apps you already use" },
  productivity:  { label: "Productivity",  description: "Email, calendar, docs, and task tools" },
  knowledge:     { label: "Knowledge",     description: "Search the web and read content" },
  computer:      { label: "Your computer", description: "Files, terminal, and local automation" },
  media:         { label: "Media",         description: "Images, audio, and video" },
  developer:     { label: "Developer",     description: "Code, repos, and dev tooling" },
  other:         { label: "More",          description: "Skills and tools your agent has installed" },
};

const resolveIcon = (name?: string): React.ComponentType<{ className?: string }> => {
  if (!name) return Icons.Sparkles;
  const lib = Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>;
  return lib[name] ?? Icons.Sparkles;
};

const CapabilityTile = ({ entry, compact }: { entry: DiscoveredCapability; compact?: boolean }) => {
  const navigate = useNavigate();
  const { setDraft } = useChat();
  const Icon = resolveIcon(entry.icon);

  const onSetup = () => {
    setDraft(entry.setupPrompt);
    navigate("/chat");
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      className="h-full"
    >
      <button
        type="button"
        onClick={onSetup}
        className={cn(
          "w-full h-full text-left rounded-xl glass-subtle border border-white/10",
          "hover:border-primary/40 hover:bg-primary/5 transition-all group",
          compact ? "p-3" : "p-4",
        )}
      >
        <div className="flex items-start gap-3">
          <div className={cn(
            "rounded-lg bg-primary/10 group-hover:bg-primary/20 flex items-center justify-center shrink-0 transition-colors",
            compact ? "w-9 h-9" : "w-10 h-10",
          )}>
            <Icon className={cn(compact ? "w-4 h-4" : "w-5 h-5", "text-primary")} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-foreground truncate">{entry.name}</h4>
              {entry.requiresSetup && (
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 px-1.5 py-0.5 rounded bg-background/40 border border-white/5">
                  Setup
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{entry.oneLiner}</p>
          </div>
        </div>
      </button>
    </motion.div>
  );
};

const CapabilityGallery = ({ compact, heading, subheading }: CapabilityGalleryProps) => {
  const { discovered, discoveryFromHermes } = useCapabilities();
  const groups = groupByCategory(Object.values(discovered));

  return (
    <GlassCard className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">
          {heading ?? "What can your agent do?"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {subheading ?? "Click any tile to ask the agent to set it up — it will guide you step by step in chat."}
        </p>
        {!discoveryFromHermes && (
          <p className="text-[11px] text-muted-foreground/70">
            Showing well-known capabilities. Connect your agent to see the full live list.
          </p>
        )}
      </div>

      <div className="space-y-6">
        {groups.map((group) => {
          const label = CATEGORY_LABELS[group.category];
          return (
            <section key={group.category} className="space-y-2">
              <div className="flex items-baseline gap-2">
                <h3 className="text-sm font-semibold text-foreground/90">{label.label}</h3>
                <span className="text-xs text-muted-foreground/70">{label.description}</span>
              </div>
              <div className={cn(
                "grid gap-2",
                compact
                  ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
                  : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
              )}>
                {group.entries.map((entry) => (
                  <CapabilityTile key={entry.id} entry={entry} compact={compact} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <div className="pt-3 border-t border-white/5 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Don't see what you need? Just ask in chat — your agent can install new skills on demand.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { window.location.hash = "#/chat"; }}
          className="text-xs"
        >
          Open chat →
        </Button>
      </div>
    </GlassCard>
  );
};

export default CapabilityGallery;
