import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  Cpu,
  KeyRound,
  Settings,
  Terminal,
  MessageSquare,
  FileText,
  RefreshCw,
  Archive,
  Activity,
  Radio,
  Sparkles,
  House,
  ChevronDown,
  Bot,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import NotificationCenter from "@/components/NotificationCenter";
import ronbotLogo from "@/assets/ronbot-logo.png";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import { useChat } from "@/contexts/ChatContext";
import { useCapabilities } from "@/contexts/CapabilitiesContext";

const primaryNavItems = [
  { path: "/", icon: House, label: "Home" },
  { path: "/chat", icon: MessageSquare, label: "Chat", showChatBadge: true },
  { path: "/channels", icon: Radio, label: "Channels" },
  { path: "/settings", icon: Settings, label: "Settings" },
];

const advancedNavItems = [
  { path: "/advanced", icon: Bot, label: "Advanced" },
  { path: "/skills", icon: Sparkles, label: "Skills & Tools" },
  { path: "/models", icon: Cpu, label: "LLM Config" },
  { path: "/secrets", icon: KeyRound, label: "Secrets" },
  { path: "/agents", icon: Bot, label: "Sub-Agents" },
  { path: "/logs", icon: FileText, label: "Agent Logs" },
  { path: "/updates", icon: RefreshCw, label: "Updates" },
  { path: "/backups", icon: Archive, label: "Backups" },
  { path: "/diagnostics", icon: Activity, label: "App Diagnostics" },
  { path: "/terminal", icon: Terminal, label: "Terminal" },
];

const AppSidebar = () => {
  const location = useLocation();
  const { connected, status } = useAgentConnection();
  const { unreadCount, isStreaming } = useChat();
  const { pendingDecisionsCount } = useCapabilities();

  return (
    <aside className="w-[220px] h-screen sticky top-0 glass-strong flex flex-col border-r border-white/10 z-30">
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
        <div className="space-y-0.5">
          {primaryNavItems.map((item) => {
              const isActive = location.pathname === item.path;
              const isChatLink = item.path === "/chat";
              const showUnread = isChatLink && unreadCount > 0 && !isActive;
              const showWaiting = isChatLink && isStreaming && !showUnread;
              const showCapBadge =
                (item as { showCapabilityBadge?: boolean }).showCapabilityBadge &&
                pendingDecisionsCount > 0 &&
                !isActive;
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
                  {showCapBadge && (
                    <span
                      className="ml-auto flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-warning text-[10px] font-semibold text-warning-foreground shadow-[0_0_8px_hsl(var(--warning)/0.6)]"
                      aria-label={`${pendingDecisionsCount} capabilit${pendingDecisionsCount === 1 ? "y needs" : "ies need"} setup`}
                      title={`${pendingDecisionsCount} capabilit${pendingDecisionsCount === 1 ? "y needs" : "ies need"} setup`}
                    >
                      {pendingDecisionsCount > 9 ? "9+" : pendingDecisionsCount}
                    </span>
                  )}
                </NavLink>
              );
            })}
        </div>

        <Collapsible defaultOpen={false} className="pt-2">
          <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors group">
            Advanced
            <ChevronDown className="w-3.5 h-3.5 transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-0.5 mt-1">
            {advancedNavItems.map((item) => {
              const isActive = location.pathname === item.path;
              const showCapBadge =
                (item as { showCapabilityBadge?: boolean }).showCapabilityBadge &&
                pendingDecisionsCount > 0 &&
                !isActive;
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
                  {showCapBadge && (
                    <span
                      className="ml-auto flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-warning text-[10px] font-semibold text-warning-foreground shadow-[0_0_8px_hsl(var(--warning)/0.6)]"
                      aria-label={`${pendingDecisionsCount} capabilit${pendingDecisionsCount === 1 ? "y needs" : "ies need"} setup`}
                    >
                      {pendingDecisionsCount > 9 ? "9+" : pendingDecisionsCount}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </CollapsibleContent>
        </Collapsible>
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
