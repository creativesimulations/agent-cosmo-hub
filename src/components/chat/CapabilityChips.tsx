import { Globe, Search, Image as ImageIcon, Mic, Mail, MessageCircle, Database, Calendar, Terminal, FileText, FilePen, Code2, Puzzle, HelpCircle } from "lucide-react";
import { useCapabilities } from "@/contexts/CapabilitiesContext";
import { cn } from "@/lib/utils";

/**
 * Tiny inline marker shown under an assistant message listing every
 * capability that was used (or attempted) during that turn.
 *
 * The list comes from ChatContext's per-turn observation of tool-call
 * markers in the stream — see `toolUseDetection.ts`.
 */
const ICONS: Record<string, typeof Globe> = {
  Terminal, FileText, FilePen, Globe, Code2, Search,
  Image: ImageIcon, Mic, Mail, MessageCircle, Database, Calendar, Puzzle, HelpCircle,
};

const CapabilityChips = ({ capabilityIds }: { capabilityIds: string[] }) => {
  const { registry } = useCapabilities();
  if (!capabilityIds.length) return null;
  // De-dupe.
  const ids = Array.from(new Set(capabilityIds));
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {ids.map((id) => {
        const cap = registry[id];
        const Icon = (cap && ICONS[cap.icon]) || HelpCircle;
        const label = cap?.label ?? id.replace(/^observed:/, "").replace(/_/g, " ");
        return (
          <span
            key={id}
            className={cn(
              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium",
              "bg-primary/10 border border-primary/20 text-primary/90",
            )}
            title={cap?.description}
          >
            <Icon className="w-3 h-3" />
            {label}
          </span>
        );
      })}
    </div>
  );
};

export default CapabilityChips;
