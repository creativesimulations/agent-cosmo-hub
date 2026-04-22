import { ShieldAlert, ShieldCheck, ShieldQuestion, Zap, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { usePermissions, useRespondToPending } from "@/contexts/PermissionsContext";
import { PERMISSION_LABELS } from "@/lib/permissions";
import { cn } from "@/lib/utils";

/**
 * Glass modal that asks the user to approve / deny an agent action.
 * Mounted once at the top of AppLayout so it can appear from any page.
 */
const ApprovalDialog = () => {
  const { pending } = usePermissions();
  const respond = useRespondToPending();

  if (!pending) return null;

  const riskClass =
    pending.risk === "high"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : pending.risk === "medium"
        ? "border-warning/40 bg-warning/10 text-warning"
        : "border-success/40 bg-success/10 text-success";

  const riskLabel = pending.risk === "high" ? "High risk" : pending.risk === "medium" ? "Medium risk" : "Low risk";

  return (
    <Dialog open={!!pending} onOpenChange={(open) => { if (!open) respond("deny"); }}>
      <DialogContent className="glass-strong border-white/10 max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <ShieldQuestion className="w-5 h-5 text-primary" />
            Agent is requesting permission
          </DialogTitle>
          <DialogDescription>
            Your agent wants to perform an action that needs your approval.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="flex items-center gap-2">
            <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border", riskClass)}>
              <Zap className="w-3 h-3" />
              {riskLabel}
            </span>
            <span className="text-xs text-muted-foreground">
              {PERMISSION_LABELS[pending.action] ?? pending.action}
            </span>
          </div>

          <div className="rounded-lg border border-white/10 bg-background/40 p-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">What</p>
            <p className="text-sm text-foreground font-mono break-all whitespace-pre-wrap">
              {pending.target}
            </p>
          </div>

          {pending.reason && (
            <div className="rounded-lg border border-white/10 bg-background/40 p-3">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Why</p>
              <p className="text-sm text-foreground/80 whitespace-pre-wrap">{pending.reason}</p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => respond("deny")}
          >
            <X className="w-4 h-4 mr-1.5" />
            Deny
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => respond("once")}
          >
            <ShieldCheck className="w-4 h-4 mr-1.5" />
            Once
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => respond("session")}
          >
            <ShieldCheck className="w-4 h-4 mr-1.5" />
            Session
          </Button>
          <Button
            className="flex-1 gradient-primary text-primary-foreground"
            onClick={() => respond("always")}
          >
            <ShieldAlert className="w-4 h-4 mr-1.5" />
            Always
          </Button>
        </DialogFooter>
        <p className="text-[11px] text-muted-foreground/70 mt-1 text-center">
          "Always" updates your defaults in Settings → Permissions.
        </p>
      </DialogContent>
    </Dialog>
  );
};

export default ApprovalDialog;
