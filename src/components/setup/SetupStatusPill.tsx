import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, CheckCircle2, XCircle, ArrowRight } from "lucide-react";
import { useSetup } from "@/contexts/SetupContext";
import { cn } from "@/lib/utils";

const DISMISS_MS = 10_000;

export default function SetupStatusPill() {
  const navigate = useNavigate();
  const location = useLocation();
  const { phase, installing, installSucceeded, installProgress, logLines } = useSetup();
  const [dismissed, setDismissed] = useState(false);

  const inWizard = phase === "wizard";
  const hasLog = logLines.length > 0;
  const onInstallRoute = location.pathname === "/install";
  const failed = !installing && hasLog && logLines.at(-1)?.startsWith("✗");

  useEffect(() => {
    if (!installSucceeded || installing) setDismissed(false);
    if (!installSucceeded) return;
    const t = window.setTimeout(() => setDismissed(true), DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [installSucceeded, installing]);

  const visible =
    inWizard && hasLog && !onInstallRoute && !(installSucceeded && dismissed);

  const label = installing
    ? `Installing… ${installProgress}%`
    : installSucceeded
      ? "Installation complete"
      : failed
        ? "Install failed"
        : "Install in progress";

  const color = installing
    ? "border-primary/30 text-primary"
    : installSucceeded
      ? "border-success/30 text-success"
      : failed
        ? "border-destructive/30 text-destructive"
        : "border-warning/30 text-warning";

  const Icon = installing ? Loader2 : installSucceeded ? CheckCircle2 : XCircle;

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          onClick={() => navigate("/install")}
          className={cn(
            "fixed bottom-6 right-6 z-50 glass-strong rounded-full px-4 py-2",
            "flex items-center gap-2 border shadow-2xl hover:scale-105 transition-transform",
            color,
          )}
        >
          <Icon className={cn("w-4 h-4", installing && "animate-spin")} />
          <span className="text-xs font-medium">{label}</span>
          {!installSucceeded && <ArrowRight className="w-3 h-3" />}
        </motion.button>
      )}
    </AnimatePresence>
  );
}
