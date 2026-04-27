import { ShieldAlert, ShieldCheck, X, Wrench, KeyRound, Puzzle, Globe, ExternalLink, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCapabilities } from "@/contexts/CapabilitiesContext";
import { cn } from "@/lib/utils";

/**
 * Capability-aware approval / fix dialog. Mounted once in AppLayout and
 * driven by `CapabilitiesContext.pendingDecision`. Whenever the chat path
 * (or a manual probe) wants the user to make a decision about a tool, it
 * sets `pendingDecision`; this dialog renders the precise checklist from
 * the probe and the four standard actions: Always allow / Allow this
 * session / Always deny / Dismiss.
 */
const CapabilityApprovalDialog = () => {
  const {
    pendingDecision,
    closePendingDecision,
    setPolicy,
    grantSession,
    registry,
  } = useCapabilities();

  if (!pendingDecision) return null;
  const { capabilityId, probe, context } = pendingDecision;
  const cap = registry[capabilityId];
  const label = cap?.label ?? capabilityId;

  const handle = (choice: "allow" | "session" | "deny" | "dismiss") => {
    if (choice === "allow") setPolicy(capabilityId, "allow");
    else if (choice === "deny") setPolicy(capabilityId, "deny");
    else if (choice === "session") grantSession(capabilityId);
    closePendingDecision();
  };

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) closePendingDecision(); }}>
      <DialogContent className="glass-strong border-white/10 max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Wrench className="w-5 h-5 text-warning" />
            {probe.ready
              ? `${label} needs a decision`
              : `${label} isn't ready`}
          </DialogTitle>
          <DialogDescription>
            {context || (probe.ready
              ? "Ron wants to use this capability. Choose how to handle it from now on."
              : "Ron tried to use this and it didn't work. Here's what's missing.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className={cn(
            "rounded-lg border p-3 text-sm",
            probe.ready
              ? "border-primary/20 bg-primary/5 text-foreground"
              : "border-warning/30 bg-warning/10 text-foreground",
          )}>
            <div className="flex items-start gap-2">
              {probe.ready ? (
                <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              )}
              <p className="flex-1">{probe.message}</p>
            </div>
            {probe.installHint && (
              <pre className="mt-2 p-2 rounded bg-background/40 border border-white/5 font-mono text-[11px] whitespace-pre-wrap">
                {probe.installHint}
              </pre>
            )}
          </div>

          {/* Quick fix buttons based on probe reason */}
          <div className="flex flex-wrap gap-2">
            {probe.reason === "noKey" && probe.candidateSecrets[0] && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  closePendingDecision();
                  window.location.hash = `#/secrets?addKey=${probe.candidateSecrets[0]}`;
                }}
              >
                <KeyRound className="w-3.5 h-3.5 mr-1.5" />
                Add {probe.candidateSecrets[0]}
              </Button>
            )}
            {probe.reason === "noSkill" && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  closePendingDecision();
                  window.location.hash = `#/skills?focus=${capabilityId}`;
                }}
              >
                <Puzzle className="w-3.5 h-3.5 mr-1.5" />
                Open Skills
              </Button>
            )}
            {probe.reason === "permissionDenied" && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  closePendingDecision();
                  window.location.hash = "#/settings";
                }}
              >
                <Globe className="w-3.5 h-3.5 mr-1.5" />
                Open Permissions
              </Button>
            )}
            {probe.ready && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  closePendingDecision();
                  window.location.hash = "#/logs";
                }}
              >
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                Open agent log
              </Button>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => handle("dismiss")}
          >
            <X className="w-4 h-4 mr-1.5" />
            Dismiss
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => handle("deny")}
          >
            Always deny
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => handle("session")}
          >
            <ShieldCheck className="w-4 h-4 mr-1.5" />
            This session
          </Button>
          <Button
            className="flex-1 gradient-primary text-primary-foreground"
            onClick={() => handle("allow")}
          >
            <ShieldAlert className="w-4 h-4 mr-1.5" />
            Always allow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CapabilityApprovalDialog;
