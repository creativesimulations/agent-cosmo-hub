import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, ChevronRight, Download, Loader2, Link2, RotateCcw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  installPrereqItem,
  requiredPrereqsMet,
  runPrereqScan,
  type PrereqItem,
} from "@/features/setup/prereqScan";

type Props = {
  onContinue: () => void;
  onConnectExisting: () => Promise<void>;
};

export function PrereqsStep({ onContinue, onConnectExisting }: Props) {
  const [items, setItems] = useState<PrereqItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [agentReady, setAgentReady] = useState(false);
  const [agentVersion, setAgentVersion] = useState<string>();
  const [connectBusy, setConnectBusy] = useState(false);

  const scan = async () => {
    setScanning(true);
    const result = await runPrereqScan();
    setAgentReady(result.agentReady);
    setAgentVersion(result.agentVersion);
    setItems(result.items);
    setScanning(false);
  };

  useEffect(() => {
    void scan();
  }, []);

  const installOne = async (id: string) => {
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, status: "installing" } : p)));
    const patch = await installPrereqItem(id);
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  if (agentReady) {
    return (
      <div className="space-y-4">
        <div className="glass-subtle rounded-lg p-4 border border-success/20 flex gap-3">
          <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <p className="text-sm font-medium">Hermes is already installed{agentVersion ? ` (${agentVersion})` : ""}</p>
            <p className="text-xs text-muted-foreground mt-1">Connect to open the dashboard, or continue to reinstall.</p>
          </motion.div>
        </div>
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
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Required dependencies for Hermes</p>
        <Button variant="ghost" size="sm" onClick={() => void scan()} disabled={scanning}>
          <RotateCcw className={cn("w-4 h-4", scanning && "animate-spin")} />
        </Button>
      </div>
      <ul className="space-y-2">
        {items.map((p) => (
          <PrereqRow key={p.id} item={p} onInstall={() => void installOne(p.id)} />
        ))}
      </ul>
      <Button className="w-full" disabled={!canContinue} onClick={onContinue}>
        Continue <ChevronRight className="w-4 h-4 ml-1" />
      </Button>
    </div>
  );
}

function PrereqRow({ item, onInstall }: { item: PrereqItem; onInstall: () => void }) {
  const missing = item.status === "missing" || item.status === "error";
  const Icon =
    item.status === "found" || item.status === "installed"
      ? CheckCircle2
      : item.status === "installing" || item.status === "checking"
        ? Loader2
        : XCircle;

  return (
    <li className="glass-subtle rounded-lg px-3 py-2 flex items-center justify-between gap-2 text-sm">
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
      {missing && item.tier === "required" && (
        <Button size="sm" variant="outline" onClick={onInstall}>
          <Download className="w-3 h-3 mr-1" /> Install
        </Button>
      )}
    </li>
  );
}
