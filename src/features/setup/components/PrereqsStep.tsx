import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, CheckCircle2, ChevronRight, Copy, Download, Info, Link2, Loader2, RotateCcw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  installPrereqItem,
  requiredPrereqsMet,
  runPrereqScan,
  type PrereqItem,
} from "@/features/setup/prereqScan";
import type { AgentProbe } from "@/features/setup/types";
import { HermesProbeSummary } from "@/features/setup/components/HermesProbeSummary";

type Props = {
  entryProbePending: boolean;
  cachedProbe: AgentProbe | null;
  onContinue: () => void;
  onConnectExisting: () => Promise<void>;
  onRequestSudo: (reason: string) => Promise<string | null>;
};

export function PrereqsStep({ entryProbePending, cachedProbe, onContinue, onConnectExisting, onRequestSudo }: Props) {
  const [items, setItems] = useState<PrereqItem[]>([]);
  const [scanning, setScanning] = useState(true);
  const [agentReady, setAgentReady] = useState(false);
  const [cliOnly, setCliOnly] = useState(false);
  const [agentVersion, setAgentVersion] = useState<string>();
  const [probe, setProbe] = useState<AgentProbe | null>(cachedProbe);
  const [connectBusy, setConnectBusy] = useState(false);

  const scan = async () => {
    setScanning(true);
    const result = await runPrereqScan({
      cachedProbe: entryProbePending ? null : cachedProbe,
    });
    setAgentReady(result.agentReady);
    setCliOnly(result.cliOnly);
    setAgentVersion(result.agentVersion);
    setItems(result.items);
    if (result.probe) setProbe(result.probe);
    setScanning(false);
  };

  useEffect(() => {
    if (entryProbePending) return;
    void scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryProbePending, cachedProbe]);

  useEffect(() => {
    if (!entryProbePending && cachedProbe) setProbe(cachedProbe);
  }, [entryProbePending, cachedProbe]);

  const installOne = async (id: string) => {
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, status: "installing" } : p)));
    const patch = await installPrereqItem(id, onRequestSudo);
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  if (entryProbePending) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" />
        Checking for an existing Hermes install under ~/.hermes…
      </div>
    );
  }

  if (agentReady) {
    return (
      <div className="space-y-4">
        <motion.div className="glass-subtle rounded-lg p-4 border border-success/20 flex gap-3">
          <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2 min-w-0">
            <p className="text-sm font-medium">
              Hermes is already installed{agentVersion ? ` (${agentVersion})` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              Connect to open the dashboard, or continue to reinstall.
            </p>
            {probe?.installState && <HermesProbeSummary state={probe.installState} />}
          </motion.div>
        </motion.div>
        <Button
          className="w-full gradient-primary text-primary-foreground"
          disabled={connectBusy}
          onClick={async () => {
            setConnectBusy(true);
            try {
              await onConnectExisting();
            } finally {
              setConnectBusy(false);
            }
          }}
        >
          {connectBusy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Link2 className="w-4 h-4 mr-2" />}
          Connect to this agent
        </Button>
        <Button variant="outline" className="w-full" onClick={onContinue}>
          Continue to install anyway <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    );
  }

  const canContinue = requiredPrereqsMet(items) && !scanning;

  return (
    <div className="space-y-4">
      {cliOnly && probe?.installState && (
        <div className="glass-subtle rounded-lg p-4 border border-warning/20 flex gap-3">
          <AlertCircle className="w-5 h-5 text-warning shrink-0" />
          <div className="space-y-2 min-w-0">
            <p className="text-sm font-medium">Hermes CLI on PATH, no Ronbot workspace</p>
            <p className="text-xs text-muted-foreground">
              A <code className="text-foreground">hermes</code> command exists, but Ronbot needs a workspace at{" "}
              <code className="text-foreground">~/.hermes</code>. Continue below to install.
            </p>
            <HermesProbeSummary state={probe.installState} />
          </div>
        </div>
      )}

      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Required dependencies for Hermes</p>
        <Button variant="ghost" size="sm" onClick={() => void scan()} disabled={scanning}>
          <RotateCcw className={cn("w-4 h-4", scanning && "animate-spin")} />
        </Button>
      </div>

      {scanning && items.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Scanning dependencies…
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((p) => (
            <PrereqRow key={p.id} item={p} onInstall={() => void installOne(p.id)} />
          ))}
        </ul>
      )}

      {!scanning && items.length === 0 && !cliOnly && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Info className="w-3 h-3" /> No dependency issues detected.
        </p>
      )}

      <Button className="w-full" disabled={!canContinue} onClick={onContinue}>
        Continue <ChevronRight className="w-4 h-4 ml-1" />
      </Button>
    </div>
  );
}

function PrereqRow({ item, onInstall }: { item: PrereqItem; onInstall: () => void }) {
  const missing = item.status === "missing" || item.status === "error";
  const canAutoInstall = !!item.autoInstallId;
  const Icon =
    item.status === "found" || item.status === "installed"
      ? CheckCircle2
      : item.status === "installing" || item.status === "checking"
        ? Loader2
        : XCircle;

  return (
    <li className="glass-subtle rounded-lg px-3 py-2 text-sm space-y-2">
      <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <Icon
          className={cn(
            "w-4 h-4 shrink-0",
            item.status === "found" || item.status === "installed"
              ? "text-success"
              : item.status === "checking" || item.status === "installing"
                ? "animate-spin text-muted-foreground"
                : "text-destructive",
          )}
        />
        <span className="truncate">{item.name}</span>
        {item.version && <span className="text-xs text-muted-foreground">{item.version}</span>}
      </div>
      {missing && item.blocker && canAutoInstall && (
        <Button size="sm" variant="outline" onClick={onInstall} disabled={item.status === "installing"}>
          <Download className="w-3 h-3 mr-1" /> Auto-fix
        </Button>
      )}
      </div>
      <p className="text-xs text-muted-foreground">{item.description}</p>
      {missing && item.manualCommand && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => void navigator.clipboard.writeText(item.manualCommand ?? "")}
        >
          <Copy className="w-3 h-3 mr-1" />
          Copy manual command
        </Button>
      )}
    </li>
  );
}
