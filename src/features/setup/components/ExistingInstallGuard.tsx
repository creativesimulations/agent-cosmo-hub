import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Link2, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import GlassCard from "@/components/ui/GlassCard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StreamingLogPanel } from "@/components/setup/StreamingLogPanel";

type Props = {
  agentName: string;
  onBack: () => void;
  onConnect: () => Promise<boolean>;
  onRename: (name: string) => Promise<boolean>;
  onReset: (log: (lines: string[]) => void) => Promise<boolean>;
};

export function ExistingInstallGuard({ agentName, onBack, onConnect, onRename, onReset }: Props) {
  const [rename, setRename] = useState(agentName);
  const [busy, setBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetLog, setResetLog] = useState<string[]>([]);

  const run = async (fn: () => Promise<boolean>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div className="max-w-md w-full space-y-6">
      <Button variant="ghost" size="sm" onClick={onBack} disabled={busy}>
        <ArrowLeft className="w-4 h-4 mr-1" /> Back
      </Button>
      <GlassCard className="space-y-4">
        <h2 className="text-xl font-semibold">Existing agent found</h2>
        <p className="text-sm text-muted-foreground">
          <strong>{agentName}</strong> is already at ~/.hermes. Connect, rename, or reset before reinstalling.
        </p>
        <Button className="w-full" disabled={busy} onClick={() => run(onConnect)}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Link2 className="w-4 h-4 mr-2" />}
          Connect
        </Button>
        <div className="space-y-2">
          <Input value={rename} onChange={(e) => setRename(e.target.value)} placeholder="Agent name" />
          <Button variant="secondary" className="w-full" disabled={busy} onClick={() => run(() => onRename(rename))}>
            Rename &amp; connect
          </Button>
        </div>
        <Button variant="destructive" className="w-full" disabled={busy} onClick={() => setResetOpen(true)}>
          <RefreshCw className="w-4 h-4 mr-2" /> Reset &amp; reinstall
        </Button>
        {resetLog.length > 0 && <StreamingLogPanel lines={resetLog} variant="install" />}
      </GlassCard>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Hermes?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes ~/.hermes and reinstalls from scratch. Back up anything you need first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => {
                setResetLog([]);
                void run(async () => onReset((lines) => setResetLog((p) => [...p, ...lines])));
                setResetOpen(false);
              }}
            >
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
