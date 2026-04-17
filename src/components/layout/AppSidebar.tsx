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
} from "lucide-react";
import NotificationCenter from "@/components/NotificationCenter";
import ronbotLogo from "@/assets/ronbot-logo.png";

const navGroups = [
  {
    label: "Monitor",
    items: [
      { path: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
      { path: "/agents", icon: Network, label: "Sub-Agents" },
      { path: "/logs", icon: FileText, label: "Logs" },
      { path: "/chat", icon: MessageSquare, label: "Agent Chat" },
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
      { path: "/settings", icon: Settings, label: "Settings" },
      { path: "/terminal", icon: Terminal, label: "Terminal" },
    ],
  },
];

const AppSidebar = () => {
  const location = useLocation();

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
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Status */}
      <div className="p-4 border-t border-white/5">
        <div className="flex items-center gap-2 text-xs">
          <div className="w-2 h-2 rounded-full bg-muted-foreground animate-pulse-glow" />
          <span className="text-muted-foreground">Not connected</span>
        </div>
      </div>
    </aside>
  );
};

export default AppSidebar;
