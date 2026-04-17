import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, CheckCircle2, XCircle, ArrowRight } from "lucide-react";
import { useInstall } from "@/contexts/InstallContext";
import { cn } from "@/lib/utils";

/**
 * Floating pill shown on every page when an install is running OR finished
 * with output the user hasn't returned to. Clicking it jumps back to the
 * install wizard so progress is never lost on navigation.
 */
const InstallStatusPill = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { mode, installing, installComplete, installProgress, installOutput, setMode } = useInstall();

  // Only render if we're actually in install flow with activity
  const inInstallFlow = mode === "install";
  const hasOutput = installOutput.length > 0;
  const lastLine = installOutput[installOutput.length - 1] ?? "";
  const failed = !installing && hasOutput && lastLine.startsWith("✗");

  // Hide on the home route (where wizard already shows)
  const onHome = location.pathname === "/";

  const visible = inInstallFlow && hasOutput && !onHome;

  const handleReturn = () => {
    setMode("install");
    navigate("/");
  };

  // Once the install is complete we don't want a "return to wizard" CTA —
  // just a static confirmation pill. Failed/in-progress states stay clickable.
  const isStaticComplete = installComplete && !installing && !failed;

  const Icon = installing ? Loader2 : installComplete ? CheckCircle2 : failed ? XCircle : Loader2;
  const label = installing
    ? `Installing… ${installProgress}%`
    : installComplete
    ? "Installation is complete"
    : failed
    ? "Install failed"
    : "Install paused";

  const colorClass = installing
    ? "border-primary/30 text-primary"
    : installComplete
    ? "border-success/30 text-success"
    : failed
    ? "border-destructive/30 text-destructive"
    : "border-warning/30 text-warning";

  return (
    <AnimatePresence>
      {visible && (
        isStaticComplete ? (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className={cn(
              "fixed bottom-6 right-6 z-50 glass-strong rounded-full pl-3 pr-4 py-2",
              "flex items-center gap-2 border shadow-2xl",
              colorClass
            )}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="text-xs font-medium whitespace-nowrap">{label}</span>
          </motion.div>
        ) : (
          <motion.button
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            onClick={handleReturn}
            className={cn(
              "fixed bottom-6 right-6 z-50 glass-strong rounded-full pl-3 pr-4 py-2",
              "flex items-center gap-2 border shadow-2xl hover:scale-105 transition-transform",
              colorClass
            )}
          >
            <Icon className={cn("w-4 h-4 shrink-0", installing && "animate-spin")} />
            <span className="text-xs font-medium whitespace-nowrap">{label}</span>
            <span className="text-xs text-muted-foreground hidden sm:inline">· Return to wizard</span>
            <ArrowRight className="w-3 h-3" />
          </motion.button>
        )
      )}
    </AnimatePresence>
  );
};

export default InstallStatusPill;
