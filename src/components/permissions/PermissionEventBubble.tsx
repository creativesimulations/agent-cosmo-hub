import { Shield, ShieldX } from "lucide-react";
import { PermissionEvent, PERMISSION_LABELS } from "@/lib/permissions";
import { cn } from "@/lib/utils";

/**
 * Compact system-message bubble rendered inline in the chat thread (or as a
 * row in the Terminal "Agent activity" feed) to show what permission events
 * the agent hit and how they were resolved.
 */
const PermissionEventBubble = ({ event }: { event: PermissionEvent }) => {
  const denied = event.decision === "denied" || event.decision === "auto-denied";
  const Icon = denied ? ShieldX : Shield;

  const label = (() => {
    switch (event.decision) {
      case "auto-allowed": return "Auto-allowed";
      case "allowed": return "Approved (once)";
      case "session-allowed": return "Approved (session)";
      case "always-allowed": return "Approved (always)";
      case "denied": return "Denied";
      case "auto-denied": return "Auto-denied";
    }
  })();

  return (
    <div
      className={cn(
        "flex items-start gap-2 text-xs rounded-md border px-2.5 py-1.5",
        denied
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : "border-success/30 bg-success/5 text-success",
      )}
    >
      <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="font-medium">{label}:</span>{" "}
        <span className="text-foreground/80">{PERMISSION_LABELS[event.action] ?? event.action}</span>
        <span className="text-foreground/60"> — </span>
        <span className="font-mono text-[11px] break-all">{event.target}</span>
      </div>
      <span className="text-[10px] text-muted-foreground shrink-0">
        {new Date(event.timestamp).toLocaleTimeString()}
      </span>
    </div>
  );
};

export default PermissionEventBubble;
