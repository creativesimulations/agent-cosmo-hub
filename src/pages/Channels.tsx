import { useCallback, useEffect, useState } from "react";
import { Radio, Sparkles, Loader2 } from "lucide-react";
import ChannelCard, { ChannelStatus } from "@/components/channels/ChannelCard";
import ChannelWizard from "@/components/channels/ChannelWizard";
import UpgradeCard from "@/components/channels/UpgradeCard";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import ActionableError from "@/components/ui/ActionableError";
import { CHANNELS, Channel } from "@/lib/channels";
import { UPGRADES, getUpgrade, isUpgradeUnlocked } from "@/lib/licenses";
import { systemAPI } from "@/lib/systemAPI";
import { toast } from "sonner";

const ChannelsPage = () => {
  const [statuses, setStatuses] = useState<Record<string, ChannelStatus>>(() =>
    Object.fromEntries(CHANNELS.map((c) => [c.id, { state: "loading" } as ChannelStatus])),
  );
  const [unlocks, setUnlocks] = useState<Record<string, boolean>>({});
  const [unlocksLoading, setUnlocksLoading] = useState(true);
  const [activeWizard, setActiveWizard] = useState<Channel | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [googleWorkspaceBusy, setGoogleWorkspaceBusy] = useState(false);
  const [toggleError, setToggleError] = useState<string>("");
  const [lastToggleChannelId, setLastToggleChannelId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    // 1. Resolve unlocks for paid channels.
    const unlockMap: Record<string, boolean> = {};
    for (const u of UPGRADES) {
      unlockMap[u.id] = await isUpgradeUnlocked(u.id);
    }
    setUnlocks(unlockMap);
    setUnlocksLoading(false);

    // 2. Resolve per-channel configured / running state by inspecting
    //    ~/.hermes/.env (configured) and `hermes status` (running).
    //    readEnvFile() returns a parsed Record<string, string>.
    const env = await systemAPI.readEnvFile();

    let runningChannels: string[] = [];
    try {
      const status = await systemAPI.hermesStatus();
      const out = `${status.stdout || ""}\n${status.stderr || ""}`.toLowerCase();
      runningChannels = CHANNELS.filter((c) => out.includes(`${c.id}`) && out.includes("running")).map(
        (c) => c.id,
      );
    } catch {
      runningChannels = [];
    }

    const next: Record<string, ChannelStatus> = {};
    for (const channel of CHANNELS) {
      if (channel.tier === "paid" && !unlockMap[channel.upgradeId!]) {
        next[channel.id] = { state: "locked" };
        continue;
      }
      const required = channel.credentials.filter((c) => !c.optional);
      const configured = required.every(
        (c) => !!env[c.envVar] && env[c.envVar].trim().length > 0,
      );
      if (!configured) {
        next[channel.id] = { state: "not-configured" };
      } else {
        next[channel.id] = { state: "configured", running: runningChannels.includes(channel.id) };
      }
    }
    setStatuses(next);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSetUp = (channel: Channel) => {
    if (channel.tier === "paid" && !unlocks[channel.upgradeId!]) {
      toast.info(`${channel.name} requires the ${channel.name} upgrade`, {
        description: "Scroll down to the Premium upgrades section to unlock it.",
      });
      return;
    }
    setActiveWizard(channel);
  };

  const handleToggle = async (channel: Channel) => {
    setToggling(channel.id);
    setToggleError("");
    setLastToggleChannelId(channel.id);
    const status = statuses[channel.id];
    try {
      if (status.state === "configured" && status.running) {
        const r = await systemAPI.stopGateway();
        if (r.success) {
          toast.success(`${channel.name} stopped`);
          await refresh();
        } else {
          const detail = r.stderr?.split("\n")[0] || r.stdout?.split("\n")[0] || "Check Logs for details.";
          setToggleError(detail);
          toast.error(`Failed to stop ${channel.name}`, { description: detail });
        }
      } else {
        const r = await systemAPI.startGateway();
        if (r.success) {
          toast.success(`${channel.name} started`);
          await refresh();
        } else {
          const detail = r.stderr?.split("\n")[0] || r.stdout?.split("\n")[0] || "Check Logs for details.";
          setToggleError(detail);
          toast.error(`Failed to start ${channel.name}`, { description: detail });
        }
      }
    } finally {
      setToggling(null);
    }
  };

  const free = CHANNELS.filter((c) => c.tier === "free");
  const paid = CHANNELS.filter((c) => c.tier === "paid");
  const googleWorkspaceUpgrade = getUpgrade("googleworkspace");
  const googleWorkspaceUnlocked = !!unlocks.googleworkspace;
  const showGoogleWorkspaceInUpgrades = !googleWorkspaceUnlocked;

  const handleGoogleWorkspaceSetup = async () => {
    if (!googleWorkspaceUnlocked) return;
    setGoogleWorkspaceBusy(true);
    try {
      const r = await systemAPI.setupGoogleWorkspace();
      if (r.success) {
        toast.success("Google Workspace is connected", {
          description: "Gmail, Calendar, Drive, Docs, and Sheets are ready.",
        });
      } else {
        toast.error("Google Workspace setup failed", {
          description: r.error || "Check logs and try again.",
        });
      }
    } finally {
      setGoogleWorkspaceBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Radio className="w-6 h-6 text-primary" />
          Channels
        </h1>
        <p className="text-sm text-muted-foreground">
          Let your agent message you through the apps you already use.
        </p>
      </div>

      {toggleError && lastToggleChannelId && (
        <ActionableError
          title="Channel action failed"
          summary={toggleError}
          details={toggleError}
          fixLabel="Try Again"
          onFix={() => {
            const channel = CHANNELS.find((c) => c.id === lastToggleChannelId);
            if (channel) void handleToggle(channel);
          }}
        />
      )}

      {/* Available channels */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/70">
          Available Channels
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {free.map((c) => (
            <ChannelCard
              key={c.id}
              channel={c}
              status={statuses[c.id] ?? { state: "loading" }}
              onSetUp={() => handleSetUp(c)}
              onToggle={() => handleToggle(c)}
              toggling={toggling === c.id}
            />
          ))}
          {googleWorkspaceUnlocked && googleWorkspaceUpgrade && (
            <GlassCard className="p-5 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
                  <Sparkles className="w-5 h-5" />
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] text-success">
                  Unlocked
                </span>
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-foreground">{googleWorkspaceUpgrade.name}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Gmail, Calendar, Drive, Docs, and Sheets integration.
                </p>
                <p className="text-[11px] text-muted-foreground/70">Setup difficulty: Medium</p>
              </div>
              <div className="flex flex-col gap-2 mt-auto">
                <Button
                  size="sm"
                  onClick={() => void handleGoogleWorkspaceSetup()}
                  className="gradient-primary text-primary-foreground w-full"
                  disabled={googleWorkspaceBusy}
                >
                  {googleWorkspaceBusy ? (
                    <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Setting up…</>
                  ) : (
                    "Set up"
                  )}
                </Button>
              </div>
            </GlassCard>
          )}
        </div>
      </section>

      {/* Paid channels (only render if any exist) */}
      {paid.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            Premium channels — one-time, yours forever
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {paid.map((c) => (
              <ChannelCard
                key={c.id}
                channel={c}
                status={statuses[c.id] ?? { state: "loading" }}
                onSetUp={() => handleSetUp(c)}
                onToggle={() => handleToggle(c)}
                toggling={toggling === c.id}
              />
            ))}
          </div>
        </section>
      )}

      {UPGRADES.filter((u) => showGoogleWorkspaceInUpgrades || u.id !== "googleworkspace").length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            Optional upgrades
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {UPGRADES
              .filter((u) => showGoogleWorkspaceInUpgrades || u.id !== "googleworkspace")
              .map((u) => (
              <UpgradeCard
                key={u.id}
                upgrade={u}
                unlocked={!!unlocks[u.id]}
                loading={unlocksLoading}
                onChange={refresh}
              />
              ))}
          </div>
        </section>
      )}

      <GlassCard className="p-4 text-xs text-muted-foreground">
        <strong className="text-foreground">How upgrades work:</strong> buy once on our website, get
        a license key by email, paste it here. It's yours forever — including all future updates,
        on every device you own. No subscriptions, no phone-home checks.
      </GlassCard>

      {activeWizard && (
        <ChannelWizard
          channel={activeWizard}
          open={!!activeWizard}
          onClose={() => setActiveWizard(null)}
          onComplete={refresh}
        />
      )}
    </div>
  );
};

export default ChannelsPage;
