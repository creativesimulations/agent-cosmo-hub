import { useCallback, useEffect, useRef, useState } from "react";
import { Radio, Sparkles, Loader2 } from "lucide-react";
import ChannelCard, { ChannelStatus } from "@/components/channels/ChannelCard";
import UpgradeCard from "@/components/channels/UpgradeCard";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { CHANNELS, Channel } from "@/lib/channels";
import { UPGRADES, getUpgrade, isUpgradeUnlocked } from "@/lib/licenses";
import { systemAPI } from "@/lib/systemAPI";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useChat } from "@/contexts/ChatContext";
import { CAPABILITY_CATALOG } from "@/lib/capabilities/catalog";

/**
 * Channels page — purely a directory of available channels. Setup is fully
 * agent-driven via chat: clicking "Set up" seeds a capability prompt into
 * the chat composer and the agent owns credential collection, QR pairing,
 * gateway lifecycle, and runtime repair via the intent protocol.
 */
const ChannelsPage = () => {
  const navigate = useNavigate();
  const { setDraft } = useChat();
  const [statuses, setStatuses] = useState<Record<string, ChannelStatus>>(() =>
    Object.fromEntries(CHANNELS.map((c) => [c.id, { state: "loading" } as ChannelStatus])),
  );
  const [unlocks, setUnlocks] = useState<Record<string, boolean>>({});
  const [unlocksLoading, setUnlocksLoading] = useState(true);
  const [googleWorkspaceBusy, setGoogleWorkspaceBusy] = useState(false);
  const googleSetupInFlightRef = useRef(false);

  const getRunningChannels = async (): Promise<string[]> => {
    try {
      const status = await systemAPI.hermesStatus();
      const out = `${status.stdout || ""}\n${status.stderr || ""}`.toLowerCase();
      return CHANNELS.filter((c) => out.includes(`${c.id}`) && out.includes("running")).map((c) => c.id);
    } catch {
      return [];
    }
  };

  const isChannelConfigured = (channel: Channel, env: Record<string, string>): boolean => {
    const required = channel.credentials.filter((c) => !c.optional);
    if (required.length === 0) {
      // Channels with no required env keys (e.g. WhatsApp/QR-based) — let
      // the agent own configured-state. From the app's perspective they
      // start as "not-configured" and become "configured" only once the
      // agent reports the channel is enabled in the gateway.
      const enabledKey = `${channel.id.toUpperCase()}_ENABLED`;
      return (env[enabledKey] || "").trim().toLowerCase() === "true";
    }
    return required.every((c) => !!env[c.envVar] && env[c.envVar].trim().length > 0);
  };

  const refresh = useCallback(async () => {
    const unlockMap: Record<string, boolean> = {};
    for (const u of UPGRADES) {
      unlockMap[u.id] = await isUpgradeUnlocked(u.id);
    }
    setUnlocks(unlockMap);
    setUnlocksLoading(false);

    const env = await systemAPI.readEnvFile();
    const runningChannels = await getRunningChannels();

    const next: Record<string, ChannelStatus> = {};
    for (const channel of CHANNELS) {
      if (channel.tier === "paid" && !unlockMap[channel.upgradeId!]) {
        next[channel.id] = { state: "locked" };
        continue;
      }
      const configured = isChannelConfigured(channel, env);
      if (!configured) {
        next[channel.id] = { state: "not-configured" };
      } else {
        const running = runningChannels.includes(channel.id);
        next[channel.id] = { state: "configured", running };
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
    // All channel setup flows are agent-driven. Hand off to chat with a
    // seeded prompt; the agent emits intent cards (credentials, confirms,
    // QR codes, OAuth) inline.
    const entry = CAPABILITY_CATALOG.find((c) => c.id === channel.id);
    const prompt =
      entry?.setupPrompt ?? `Set up ${channel.name} so I can message you from ${channel.name}.`;
    setDraft(prompt);
    navigate("/chat");
  };

  const free = CHANNELS.filter((c) => c.tier === "free");
  const paid = CHANNELS.filter((c) => c.tier === "paid");
  const googleWorkspaceUpgrade = getUpgrade("googleworkspace");
  const googleWorkspaceUnlocked = !!unlocks.googleworkspace;
  const showGoogleWorkspaceInUpgrades = !googleWorkspaceUnlocked;

  const handleGoogleWorkspaceSetup = async () => {
    if (!googleWorkspaceUnlocked) return;
    if (googleSetupInFlightRef.current) return;
    googleSetupInFlightRef.current = true;
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
      googleSetupInFlightRef.current = false;
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
          Let your agent message you through the apps you already use. Click "Set up" — your agent
          will walk you through it in chat.
        </p>
      </div>

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
    </div>
  );
};

export default ChannelsPage;
