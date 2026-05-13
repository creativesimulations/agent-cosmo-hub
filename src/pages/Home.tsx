// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import RightInfoPanel from "@/components/companion/RightInfoPanel";
import AgentChat from "./AgentChat";

const SIDEBAR_COLLAPSED_KEY = "ronbot.home.rightSidebarCollapsed";

/**
 * Home — the primary "companion" view. Two columns:
 *   • main:  the existing AgentChat experience (chat is the primary UI)
 *   • right: live activity panel showing identity, health, sub-agents,
 *           cron jobs, and recurring schedules.
 *
 * On `xl` viewports the right panel can be collapsed to full-width chat; on
 * narrow viewports the panel stacks below the chat.
 */
const Home = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SIDEBAR_COLLAPSED_KEY && e.newValue !== null) {
        setSidebarCollapsed(e.newValue === "true");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <div className="relative flex flex-col xl:flex-row h-screen w-full">
      <div className="flex-1 min-w-0">
        <AgentChat />
      </div>

      {/* Expand control when sidebar is hidden on wide screens */}
      {sidebarCollapsed && (
        <button
          type="button"
          onClick={toggleSidebar}
          className={cn(
            "hidden xl:flex items-center justify-center absolute right-0 top-1/2 -translate-y-1/2 z-20",
            "h-24 w-7 rounded-l-md border border-white/10 border-r-0 bg-card/90 text-muted-foreground",
            "hover:text-foreground hover:bg-card shadow-lg backdrop-blur-sm transition-colors",
          )}
          aria-label="Show activity panel"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      )}

      {!sidebarCollapsed && (
        <aside className="xl:w-[300px] xl:shrink-0 xl:border-l xl:border-white/5 xl:h-screen xl:overflow-hidden p-4 xl:p-3 relative">
          <button
            type="button"
            onClick={toggleSidebar}
            className="hidden xl:flex absolute top-3 right-2 z-10 h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
            aria-label="Hide activity panel"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <RightInfoPanel />
        </aside>
      )}
    </div>
  );
};

export default Home;
