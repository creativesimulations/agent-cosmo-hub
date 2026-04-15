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
  Zap,
  Home,
} from "lucide-react";

const navItems = [
  { path: "/", icon: Home, label: "Welcome" },
  { path: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { path: "/agents", icon: Network, label: "Sub-Agents" },
  { path: "/models", icon: Cpu, label: "LLM Config" },
  { path: "/keys", icon: KeyRound, label: "API Keys" },
  { path: "/skills", icon: Puzzle, label: "Skills" },
  { path: "/settings", icon: Settings, label: "Settings" },
  { path: "/terminal", icon: Terminal, label: "Terminal" },
];

const AppSidebar = () => {
  const location = useLocation();

  return (
    <aside className="w-[220px] min-h-screen glass-strong flex flex-col border-r border-white/10">
      {/* Logo */}
      <div className="p-5 border-b border-white/5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center glow-primary">
            <Zap className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-foreground tracking-tight">Hermes</h1>
            <p className="text-[10px] text-muted-foreground">Agent Control Panel</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-0.5">
        {navItems.map((item) => {
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
