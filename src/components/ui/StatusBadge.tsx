import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: "online" | "offline" | "warning" | "busy";
  label?: string;
  className?: string;
}

const statusConfig = {
  online: { color: "bg-success", ring: "ring-success/30", text: "text-success", label: "Online" },
  offline: { color: "bg-muted-foreground", ring: "ring-muted-foreground/30", text: "text-muted-foreground", label: "Offline" },
  warning: { color: "bg-warning", ring: "ring-warning/30", text: "text-warning", label: "Warning" },
  busy: { color: "bg-primary", ring: "ring-primary/30", text: "text-primary", label: "Busy" },
};

const StatusBadge = ({ status, label, className }: StatusBadgeProps) => {
  const config = statusConfig[status];
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className={cn("w-2 h-2 rounded-full ring-2", config.color, config.ring)} />
      <span className={cn("text-xs font-medium", config.text)}>{label || config.label}</span>
    </div>
  );
};

export default StatusBadge;
