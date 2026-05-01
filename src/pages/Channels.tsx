import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Radio, Sparkles, Loader2 } from "lucide-react";
import ChannelCard, { ChannelStatus } from "@/components/channels/ChannelCard";
import UpgradeCard from "@/components/channels/UpgradeCard";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { UPGRADES, getUpgrade, isUpgradeUnlocked } from "@/lib/licenses";
import { systemAPI } from "@/lib/systemAPI";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useChat } from "@/contexts/ChatContext";
import { useCapabilities } from "@/contexts/CapabilitiesContext";
import { filterByKind } from "@/lib/capabilities/discovery";
import type { DiscoveredCapability } from "@/lib/capabilities/types";

/**
 * Channels page — purely a directory of channels the agent supports.
 *
 * The list itself is **not** hard-coded: it is derived from the runtime
 * capability registry (`useCapabilities().discovered`), which is fed by
 * `hermes capabilities --json` + installed skills + a small seed
 * fallback. New Hermes channels appear here automatically.
 *
 * Setup is fully agent-driven via chat: clicking "Set up" seeds the
 * capability's setup prompt into the chat composer; the agent owns
 * credential collection, QR pairing, gateway lifecycle, and runtime
 * repair via the intent protocol.
 */

/** Premium channels (gated by a license upgrade). Keyed by capability id. */
const PAID_CHANNELS: Record<string, { upgradeId: string }> = {
  // No paid channels at present — kept here as the extension point.
};

const ChannelsPage = () => {
  const navigate = useNavigate();
  const { setDraft } = useChat();
  const { discovered, discoveryFromHermes } = useCapabilities();

  const channels = useMemo<DiscoveredCapability[]>(
    () => filterByKind(discovered, ["channel"]).sort((a, b) => a.name.localeCompare(b.name)),
    [discovered],
  );

  const [statuses, setStatuses] = useState<Record<string, ChannelStatus>>({});
  const [unlocks, setUnlocks] = useState<Record<string, boolean>>({});
  const [unlocksLoading, setUnlocksLoading] = useState(true);
  const [googleWorkspaceBusy, setGoogleWorkspaceBusy] = useState(false);
  const googleSetupInFlightRef = useRef(false);

  const getRunningChannels = async (ids: string[]): Promise<string[]> => {
    try {
      const status = await systemAPI.hermesStatus();
      const out = `${status.stdout || ""}\n${status.stderr || ""}`.toLowerCase();
      return ids.filter((id) => out.includes(id) && out.includes("running"));
    } catch {
      return [];
    }
  };

  const isChannelConfigured = (channel: DiscoveredCapability, env: Record<string, string>): boolean => {
    const required = channel.requiredSecrets;
    if (required.length === 0) {
      // QR-based / no-key channels (e.g. WhatsApp): ENABLED flag is the signal.
      const enabledKey = `${channel.id.toUpperCase().replace(/-/g, "_")}_ENABLED`;
      return (env[enabledKey] || "").trim().toLowerCase() === "true";
    }
    return required.every((k) => !!env[k] && env[k].trim().length > 0);
  };

  const refresh = useCallback(async () => {
    const unlockMap: Record<string, boolean> = {};
    for (const u of UPGRADES) {
      unlockMap[u.id] = await isUpgradeUnlocked(u.id);
    }
    setUnlocks(unlockMap);
    setUnlocksLoading(false);

    const env = await systemAPI.readEnvFile();
    const ids = channels.map((c) => c.id);
    const running = await getRunningChannels(ids);

    const next: Record<string, ChannelStatus> = {};
    for (const channel of channels) {
      const paid = PAID_CHANNELS[channel.id];
      if (paid && !unlockMap[paid.upgradeId]) {
        next[channel.id] = { state: "locked" };
        continue;
      }
      const configured = isChannelConfigured(channel, env);
      if (!configured) {
        next[channel.id] = { state: "not-configured" };
      } else {
        next[channel.id] = { state: "configured", running: running.includes(channel.id) };
      }
    }
    setStatuses(next);
  }, [channels]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSetUp = (channel: DiscoveredCapability) => {
    const paid = PAID_CHANNELS[channel.id];
    if (paid && !unlocks[paid.upgradeId]) {
      toast.info(`${channel.name} requires an upgrade`, {
        description: "Scroll down to the Premium upgrades section to unlock it.",
      });
      return;
    }
    setDraft(channel.setupPrompt);
    navigate("/chat");
  };

  const free = channels.filter((c) => !PAID_CHANNELS[c.id]);
  const paid = channels.filter((c) => PAID_CHANNELS[c.id]);
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
        {!discoveryFromHermes && (
          <p className="text-[11px] text-muted-foreground/70 mt-1">
            Showing well-known channels. Connect your agent to see the full live list.
          </p>
        )}
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
              id={c.id}
              name={c.name}
              tagline={c.oneLiner}
              icon={c.icon}
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
                id={c.id}
                name={c.name}
                tagline={c.oneLiner}
                icon={c.icon}
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
