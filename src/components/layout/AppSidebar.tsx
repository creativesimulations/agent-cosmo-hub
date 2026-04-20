import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Network,
  Cpu,
  KeyRound,
  Puzzle,
  Settings,
  Terminal,
  Home,
  MessageSquare,
  FileText,
  FileCode,
  RefreshCw,
  Archive,
  Activity,
} from "lucide-react";
import NotificationCenter from "@/components/NotificationCenter";
import ronbotLogo from "@/assets/ronbot-logo.png";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import { useChat } from "@/contexts/ChatContext";

const navGroups = [
  {
    label: "Monitor",
    items: [
      { path: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
      { path: "/agents", icon: Network, label: "Sub-Agents" },
      { path: "/logs", icon: FileText, label: "Logs" },
      { path: "/chat", icon: MessageSquare, label: "Agent Chat", showChatBadge: true },
    ],
  },
  {
    label: "Configure",
    items: [
      { path: "/models", icon: Cpu, label: "LLM Config" },
      { path: "/secrets", icon: KeyRound, label: "Secrets" },
      { path: "/skills", icon: Puzzle, label: "Skills" },
      { path: "/config", icon: FileCode, label: "Config Editor" },
    ],
  },
  {
    label: "Manage",
    items: [
      { path: "/updates", icon: RefreshCw, label: "Updates" },
      { path: "/backups", icon: Archive, label: "Backups" },
      { path: "/diagnostics", icon: Activity, label: "Diagnostics" },
      { path: "/settings", icon: Settings, label: "Settings" },
      { path: "/terminal", icon: Terminal, label: "Terminal" },
    ],
  },
];

const AppSidebar = () => {
  const location = useLocation();
  const { connected, status } = useAgentConnection();
  const { unreadCount, isStreaming } = useChat();

  return (
    <aside className="w-[220px] min-h-screen glass-strong flex flex-col border-r border-white/10">
      {/* Logo */}
      <div className="p-5 border-b border-white/5 flex items-center justify-between">
        <NavLink to="/" className="flex items-center gap-2.5">
          <img src={ronbotLogo} alt="Ronbot" className="w-8 h-8" />
          <div>
            <h1 className="text-sm font-semibold text-foreground tracking-tight">Ronbot</h1>
            <p className="text-[10px] text-muted-foreground">Agent Control Panel</p>
          </div>
        </NavLink>
        <NotificationCenter />
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-4 overflow-y-auto">
        {navGroups.map((group) => (
          <div key={group.label} className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50 px-3 mb-1">
              {group.label}
            </p>
            {group.items.map((item) => {
              const isActive = location.pathname === item.path;
              const isChatLink = item.path === "/chat";
              const showUnread = isChatLink && unreadCount > 0 && !isActive;
              const showWaiting = isChatLink && isStreaming && !showUnread;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-200",
                    isActive
                      ? "bg-primary/15 text-primary border border-primary/20 shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                  )}
                >
                  <item.icon className={cn("w-4 h-4", isActive && "text-primary")} />
                  <span className="font-medium">{item.label}</span>
                  {showUnread && (
                    <span
                      className="ml-auto flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-[10px] font-semibold text-primary-foreground shadow-[0_0_8px_hsl(var(--primary)/0.6)]"
                      aria-label={`${unreadCount} unread message${unreadCount === 1 ? "" : "s"}`}
                    >
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                  {showWaiting && (
                    <span
                      className="ml-auto w-2 h-2 rounded-full bg-warning animate-pulse"
                      aria-label="Agent is responding"
                    />
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Status */}
      <div className="p-4 border-t border-white/5">
        <div className="flex items-center gap-2 text-xs">
          <div
            className={cn(
              "w-2 h-2 rounded-full animate-pulse-glow",
              connected ? "bg-success" : status === "checking" ? "bg-warning" : "bg-muted-foreground"
            )}
          />
          <span className={cn(connected ? "text-success" : "text-muted-foreground")}>
            {connected ? "Connected" : status === "checking" ? "Checking…" : "Not connected"}
          </span>
        </div>
      </div>
    </aside>
  );
};

export default AppSidebar;
