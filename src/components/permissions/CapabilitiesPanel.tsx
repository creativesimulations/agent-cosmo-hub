import { useMemo, useState } from "react";
import {
  ShieldCheck,
  Search,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  KeyRound,
  Puzzle,
  Globe,
  Image as ImageIcon,
  Mic,
  Mail,
  MessageCircle,
  Database,
  Calendar,
  Terminal,
  FileText,
  FilePen,
  Code2,
  HelpCircle,
} from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useCapabilities } from "@/contexts/CapabilitiesContext";
import { CHOICE_LABELS, CapabilityChoice, CapabilityDefinition } from "@/lib/capabilities";
import { cn } from "@/lib/utils";

/**
 * Auto-generated Capabilities panel — one row per discovered capability,
 * each with a four-state selector (Ask / Allow / Session / Deny) and a
 * readiness badge that tells the user *why* the capability isn't ready
 * (missing key, missing skill, etc.).
 *
 * The list updates itself when skills are added/removed because it is
 * driven by `useCapabilities().registry`, which is rebuilt on discovery.
 */

const ICONS: Record<string, typeof Globe> = {
  Terminal,
  FileText,
  FilePen,
  Globe,
  Code2,
  Search,
  Image: ImageIcon,
  Mic,
  Mail,
  MessageCircle,
  Database,
  Calendar,
  Puzzle,
  HelpCircle,
};

const CHOICE_ORDER: CapabilityChoice[] = ["ask", "session", "allow", "deny"];

const CHOICE_TONE: Record<CapabilityChoice, string> = {
  ask: "border-warning/40 text-warning bg-warning/10",
  allow: "border-success/40 text-success bg-success/10",
  session: "border-primary/40 text-primary bg-primary/10",
  deny: "border-destructive/40 text-destructive bg-destructive/10",
};

const ChoicePicker = ({
  value,
  onChange,
}: {
  value: CapabilityChoice;
  onChange: (next: CapabilityChoice) => void;
}) => (
  <div className="inline-flex rounded-lg border border-border bg-background/30 p-0.5 text-[11px] font-medium">
    {CHOICE_ORDER.map((c) => (
      <button
        key={c}
        type="button"
        onClick={() => onChange(c)}
        className={cn(
          "px-2.5 py-1 rounded-md transition-colors",
          value === c
            ? CHOICE_TONE[c] + " border"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        {CHOICE_LABELS[c]}
      </button>
    ))}
  </div>
);

const CapabilityRow = ({ cap }: { cap: CapabilityDefinition }) => {
  const { policy, setPolicy, readinessFor } = useCapabilities();
  const choice = (policy[cap.id] as CapabilityChoice) ?? "ask";
  const readiness = readinessFor(cap.id);
  const Icon = ICONS[cap.icon] ?? HelpCircle;

  const riskTone =
    cap.risk === "high"
      ? "text-destructive"
      : cap.risk === "medium"
        ? "text-warning"
        : "text-success";

  return (
    <div className="py-3 border-b border-border/40 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-3 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-lg bg-background/40 border border-border/60 flex items-center justify-center shrink-0">
            <Icon className={cn("w-4 h-4", riskTone)} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Label className="text-sm font-medium text-foreground">{cap.label}</Label>
              <span className={cn("text-[10px] uppercase tracking-wider font-semibold", riskTone)}>
                {cap.risk}
              </span>
              {cap.source !== "builtin" && (
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 px-1.5 py-0.5 rounded bg-background/40 border border-border/40">
                  {cap.source}
                </span>
              )}
              {readiness.ready ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-success">
                  <CheckCircle2 className="w-3 h-3" /> Ready
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] text-warning">
                  <AlertTriangle className="w-3 h-3" /> {readiness.reason}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{cap.description}</p>
            {(readiness.missingSecret || readiness.missingSkill) && (
              <div className="flex flex-wrap gap-2 mt-1.5">
                {readiness.missingSecret && cap.candidateSecrets[0] && (
                  <button
                    type="button"
                    onClick={() => { window.location.hash = `#/secrets?addKey=${cap.candidateSecrets[0]}`; }}
                    className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
                  >
                    <KeyRound className="w-3 h-3" /> Add {cap.candidateSecrets[0]}
                  </button>
                )}
                {readiness.missingSkill && (
                  <button
                    type="button"
                    onClick={() => { window.location.hash = "#/skills"; }}
                    className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
                  >
                    <Puzzle className="w-3 h-3" /> Open Skills
                  </button>
                )}
                {cap.extrasPackage && (
                  <span className="text-[11px] text-muted-foreground">
                    Extras: <code className="font-mono">hermes-agent[{cap.extrasPackage}]</code>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="mt-2 pl-11">
        <ChoicePicker value={choice} onChange={(c) => setPolicy(cap.id, c)} />
      </div>
    </div>
  );
};

const GROUP_LABELS: Record<CapabilityDefinition["group"], string> = {
  system: "System access",
  web: "Web & internet",
  media: "Media generation",
  communication: "Communication",
  data: "Data & memory",
  other: "Skills & other tools",
};

const CapabilitiesPanel = () => {
  const { registry, resetAll, rediscover } = useCapabilities();
  const [query, setQuery] = useState("");

  const grouped = useMemo(() => {
    const all = Object.values(registry);
    const filtered = query
      ? all.filter((c) =>
          c.label.toLowerCase().includes(query.toLowerCase()) ||
          c.id.toLowerCase().includes(query.toLowerCase()) ||
          c.description.toLowerCase().includes(query.toLowerCase()),
        )
      : all;
    const map: Record<string, CapabilityDefinition[]> = {};
    for (const cap of filtered) {
      (map[cap.group] = map[cap.group] || []).push(cap);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => a.label.localeCompare(b.label));
    }
    return map;
  }, [registry, query]);

  return (
    <GlassCard className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Capabilities</h2>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void rediscover()}>
            Rediscover
          </Button>
          <Button variant="outline" size="sm" onClick={resetAll}>
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            Reset all to Ask
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground -mt-2">
        Decide once how the agent should handle every feature, skill, or tool it might use.
        New skills you install appear here automatically. Choose <span className="font-semibold">Ask</span> to
        be prompted each time, <span className="font-semibold">Allow this session</span> to grant until the app
        restarts, <span className="font-semibold">Always allow</span> to never be asked again, or{" "}
        <span className="font-semibold">Always deny</span> to block the agent from even trying.
      </p>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search capabilities…"
          className="pl-9 bg-background/50 border-border"
        />
      </div>

      {Object.keys(grouped).length === 0 ? (
        <p className="text-sm text-muted-foreground italic py-4">No capabilities match your search.</p>
      ) : (
        Object.entries(grouped).map(([group, caps]) => (
          <div key={group} className="space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold pt-2">
              {GROUP_LABELS[group as CapabilityDefinition["group"]] ?? group}
            </p>
            <div>
              {caps.map((cap) => (
                <CapabilityRow key={cap.id} cap={cap} />
              ))}
            </div>
          </div>
        ))
      )}
    </GlassCard>
  );
};

export default CapabilitiesPanel;
