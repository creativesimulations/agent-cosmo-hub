import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, X, AlertTriangle, CheckCircle2, Info, XCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

type NotifType = "info" | "success" | "warning" | "error";

interface Notification {
  id: string;
  type: NotifType;
  title: string;
  message: string;
  time: string;
  read: boolean;
}

const typeIcons: Record<NotifType, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

const typeColors: Record<NotifType, string> = {
  info: "text-primary",
  success: "text-success",
  warning: "text-warning",
  error: "text-destructive",
};

const NotificationCenter = () => {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const dismiss = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen(!open)}
        className="relative w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors"
      >
        <Bell className="w-4 h-4 text-muted-foreground" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-destructive text-[10px] font-bold text-white flex items-center justify-center">
            {unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className="absolute left-0 top-10 w-80 glass-strong rounded-xl border border-white/10 shadow-2xl z-[100] overflow-hidden"
          >
            <div className="p-3 border-b border-white/5 flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Notifications</span>
              {notifications.length > 0 && (
                <button onClick={markAllRead} className="text-xs text-primary hover:underline">
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">No notifications</div>
              ) : (
                notifications.map((notif) => {
                  const Icon = typeIcons[notif.type];
                  return (
                    <div
                      key={notif.id}
                      className={cn(
                        "px-3 py-2.5 border-b border-white/[0.03] flex gap-2.5 hover:bg-white/[0.02] transition-colors",
                        !notif.read && "bg-white/[0.02]"
                      )}
                    >
                      <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", typeColors[notif.type])} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground">{notif.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{notif.message}</p>
                        <p className="text-[10px] text-muted-foreground/60 mt-0.5 flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" /> {notif.time}
                        </p>
                      </div>
                      <button onClick={() => dismiss(notif.id)} className="shrink-0 mt-0.5">
                        <X className="w-3 h-3 text-muted-foreground/40 hover:text-foreground" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default NotificationCenter;
