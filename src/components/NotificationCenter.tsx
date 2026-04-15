import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, X, AlertTriangle, CheckCircle2, Info, XCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
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

const initialNotifications: Notification[] = [
  { id: "1", type: "error", title: "Sub-Agent Failed", message: "data-parser crashed: out of memory", time: "2m ago", read: false },
  { id: "2", type: "warning", title: "Rate Limit Warning", message: "OpenAI API at 80% quota", time: "15m ago", read: false },
  { id: "3", type: "success", title: "Update Available", message: "Hermes v0.2.0 is ready to install", time: "1h ago", read: false },
  { id: "4", type: "info", title: "Backup Complete", message: "Auto-backup saved successfully", time: "3h ago", read: true },
];

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
  const [notifications, setNotifications] = useState(initialNotifications);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const dismiss = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  return (
    <div className="relative">
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
            className="absolute right-0 top-10 w-80 glass-strong rounded-xl border border-white/10 shadow-2xl z-50 overflow-hidden"
          >
            <div className="p-3 border-b border-white/5 flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Notifications</span>
              <button onClick={markAllRead} className="text-xs text-primary hover:underline">
                Mark all read
              </button>
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
