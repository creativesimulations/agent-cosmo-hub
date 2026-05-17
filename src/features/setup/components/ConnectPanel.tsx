import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Globe, Loader2, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import GlassCard from "@/components/ui/GlassCard";

type Props = {
  connecting: boolean;
  onBack: () => void;
  onConnect: () => void;
};

export function ConnectPanel({ connecting, onBack, onConnect }: Props) {
  return (
    <div className="max-w-md w-full space-y-6">
      <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back
      </Button>
      <GlassCard className="space-y-6">
        <motion.div className="space-y-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Server className="w-5 h-5 text-primary" />
            Connect to Local Agent
          </h2>
          <p className="text-sm text-muted-foreground">
            Ronbot looks for Hermes at <code className="text-foreground">~/.hermes</code> with a working CLI (WSL on Windows).
          </p>
        </motion.div>
        <motion.div className="glass-subtle rounded-lg p-3 flex gap-2">
          <Globe className="w-4 h-4 text-accent mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            If Hermes works in your terminal but not here, ensure the same PATH is available to GUI apps.
          </p>
        </motion.div>
        <Button onClick={onConnect} disabled={connecting} className="w-full gradient-primary text-primary-foreground">
          {connecting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Detecting…
            </>
          ) : (
            <>
              <ArrowRight className="w-4 h-4 mr-2" /> Detect &amp; Connect
            </>
          )}
        </Button>
      </GlassCard>
    </div>
  );
}

