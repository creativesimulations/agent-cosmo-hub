import RightInfoPanel from "@/components/companion/RightInfoPanel";
import AgentChat from "./AgentChat";

/**
 * Home — the primary "companion" view. Two columns:
 *   • main:  the existing AgentChat experience (chat is the primary UI)
 *   • right: live activity panel showing identity, health, sub-agents,
 *           cron jobs, and heartbeat tasks.
 *
 * On narrow viewports the right panel collapses underneath the chat so
 * the chat itself never gets squeezed.
 */
const Home = () => {
  return (
    <div className="flex flex-col xl:flex-row h-screen w-full">
      {/* Chat (primary). AgentChat already handles its own padding + scroll. */}
      <div className="flex-1 min-w-0">
        <AgentChat />
      </div>

      {/* Right info panel — fixed-width sidebar on wide screens, full-width
          stacked card below on narrower ones. */}
      <aside className="xl:w-[300px] xl:shrink-0 xl:border-l xl:border-white/5 xl:h-screen xl:overflow-hidden p-4 xl:p-3">
        <RightInfoPanel />
      </aside>
    </div>
  );
};

export default Home;
