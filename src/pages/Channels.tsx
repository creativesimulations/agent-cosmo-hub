import { useCallback, useEffect, useRef, useState } from "react";
import { Radio, Sparkles, Loader2 } from "lucide-react";
import ChannelCard, { ChannelStatus } from "@/components/channels/ChannelCard";
import ChannelWizard from "@/components/channels/ChannelWizard";
import UpgradeCard from "@/components/channels/UpgradeCard";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CHANNELS, Channel } from "@/lib/channels";
import { UPGRADES, getUpgrade, isUpgradeUnlocked } from "@/lib/licenses";
import { systemAPI } from "@/lib/systemAPI";
import { toast } from "sonner";
import { useCapabilities } from "@/contexts/CapabilitiesContext";
import { invalidateCapabilityProbeCache } from "@/lib/capabilityProbe";

const ChannelsPage = () => {
  const { refreshProbes } = useCapabilities();
  const [statuses, setStatuses] = useState<Record<string, ChannelStatus>>(() =>
    Object.fromEntries(CHANNELS.map((c) => [c.id, { state: "loading" } as ChannelStatus])),
  );
  const [unlocks, setUnlocks] = useState<Record<string, boolean>>({});
  const [unlocksLoading, setUnlocksLoading] = useState(true);
  const [activeWizard, setActiveWizard] = useState<Channel | null>(null);
  const [whatsappResetOpen, setWhatsappResetOpen] = useState(false);
  const [whatsappResetBusy, setWhatsappResetBusy] = useState(false);
  const [gatewayRestartBusy, setGatewayRestartBusy] = useState(false);
  const [googleWorkspaceBusy, setGoogleWorkspaceBusy] = useState(false);
  const channelsDebugRunRef = useRef("");
  // Tracks channels in a brief post-wizard "starting" grace window so the
  // card shows "Starting…" only while the bridge is given a chance to come
  // up, and switches to "Attention" instead of spinning forever.
  const pollStartRef = useRef<Map<string, number>>(new Map());

  const emitChannelsDebugLog = useCallback((hypothesisId: string, location: string, message: string, data: Record<string, unknown>) => {
    // #region agent log
    fetch("http://127.0.0.1:7544/ingest/13d5d95c-e042-47dd-9c7b-02723faafae2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "8f17d1",
      },
      body: JSON.stringify({
        sessionId: "8f17d1",
        runId: channelsDebugRunRef.current || "channels-unset",
        hypothesisId,
        location,
        message,
        data,
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }, [channelsDebugRunRef]);

  const getRunningChannels = async (): Promise<string[]> => {
    try {
      const status = await systemAPI.hermesStatus();
      const out = `${status.stdout || ""}\n${status.stderr || ""}`.toLowerCase();
      return CHANNELS.filter((c) => out.includes(`${c.id}`) && out.includes("running")).map((c) => c.id);
    } catch {
      return [];
    }
  };

  const isWhatsAppAccessConfigured = (env: Record<string, string>): boolean => {
    const allowlist = (env.WHATSAPP_ALLOWED_USERS || "").trim();
    const allowAll = (env.WHATSAPP_ALLOW_ALL_USERS || "").trim().toLowerCase() === "true";
    return allowlist.length > 0 || allowAll;
  };

  const isChannelConfigured = (
    channel: Channel,
    env: Record<string, string>,
    /** Session file present and/or live Baileys bridge (Hermes runtime). */
    whatsappSessionReady: boolean,
  ): boolean => {
    switch (channel.id) {
      case "slack":
        return (
          (env.SLACK_BOT_TOKEN || "").trim().startsWith("xoxb-") &&
          (env.SLACK_APP_TOKEN || "").trim().startsWith("xapp-") &&
          (env.SLACK_ALLOWED_USERS || "").trim().length > 0
        );
      case "whatsapp":
        return (
          (env.WHATSAPP_ENABLED || "").trim().toLowerCase() === "true" &&
          ["self-chat", "bot"].includes((env.WHATSAPP_MODE || "").trim()) &&
          isWhatsAppAccessConfigured(env) &&
          whatsappSessionReady
        );
      default: {
        const required = channel.credentials.filter((c) => !c.optional);
        return required.every((c) => !!env[c.envVar] && env[c.envVar].trim().length > 0);
      }
    }
  };

  const bumpCapabilityProbes = useCallback(() => {
    invalidateCapabilityProbeCache();
    void refreshProbes();
  }, [refreshProbes]);

  const refresh = useCallback(async () => {
    channelsDebugRunRef.current = `channels-${Date.now()}`;
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
    const waPairState = await systemAPI.isWhatsAppPaired();
    const filePaired = !!(waPairState.success && waPairState.paired);
    let bridgeLive = false;
    if (
      (env.WHATSAPP_ENABLED || "").trim().toLowerCase() === "true" &&
      ["self-chat", "bot"].includes((env.WHATSAPP_MODE || "").trim()) &&
      isWhatsAppAccessConfigured(env)
    ) {
      const br = await systemAPI.getWhatsAppBridgeStatus();
      bridgeLive = !!(br.success && br.running && br.whatsappActive);
    }
    const whatsappSessionReady = filePaired || bridgeLive;
    // #region agent log
    emitChannelsDebugLog("C1", "Channels.tsx:refresh:env", "env-derived channel config keys", {
      hasWhatsappEnabled: !!(env.WHATSAPP_ENABLED && env.WHATSAPP_ENABLED.trim().length > 0),
      hasWhatsappAllowedUsers: !!(env.WHATSAPP_ALLOWED_USERS && env.WHATSAPP_ALLOWED_USERS.trim().length > 0),
      hasWhatsappAllowAllUsers: (env.WHATSAPP_ALLOW_ALL_USERS || "").trim().toLowerCase() === "true",
      whatsappMode: (env.WHATSAPP_MODE || "").trim(),
      envKeyCount: Object.keys(env).length,
    });
    // #endregion

    let runningChannels = await getRunningChannels();

    const configuredChannels = CHANNELS.filter((channel) => {
      if (channel.tier === "paid" && !unlockMap[channel.upgradeId!]) return false;
      return isChannelConfigured(channel, env, whatsappSessionReady);
    }).map((c) => c.id);
    // #region agent log
    emitChannelsDebugLog("C2", "Channels.tsx:refresh:configuredChannels", "configured channels derived from env", {
      configuredChannels,
      unlockMap,
    });
    // #endregion

    // Configured channels should be always-on: ensure gateway is started automatically.
    if (configuredChannels.length > 0) {
      const startResult = await systemAPI.startGateway();
      // #region agent log
      emitChannelsDebugLog("C3", "Channels.tsx:refresh:autoStartGateway", "auto start gateway result", {
        success: startResult.success,
        stderrFirstLine: startResult.stderr?.split("\n")[0] || "",
        stdoutFirstLine: startResult.stdout?.split("\n")[0] || "",
      });
      // #endregion
      if (!startResult.success) {
        const detail = startResult.stderr?.split("\n")[0] || startResult.stdout?.split("\n")[0] || "Check Logs for details.";
        toast.error("Could not start configured channels automatically", { description: detail });
      }
      runningChannels = await getRunningChannels();
    }

    // Hermes gateway status output can be inconsistent across versions.
    // For WhatsApp specifically, use dedicated health checks so we only
    // report "running" when the bridge is truly connected.
    let waAttention: string | undefined;
    if (configuredChannels.includes("whatsapp")) {
      const waHealth = await systemAPI.getWhatsAppGatewayHealth();
      emitChannelsDebugLog("C5", "Channels.tsx:refresh:waHealth", "whatsapp bridge health", {
        success: waHealth.success,
        running: waHealth.running,
        whatsappActive: waHealth.whatsappActive,
        source: waHealth.source,
      });
      const waRunning = !!(waHealth.success && waHealth.running && waHealth.whatsappActive);
      if (waRunning && !runningChannels.includes("whatsapp")) {
        runningChannels = [...runningChannels, "whatsapp"];
      }
      if (!waRunning && runningChannels.includes("whatsapp")) {
        runningChannels = runningChannels.filter((id) => id !== "whatsapp");
      }
      if (!waRunning) {
        const tail = (waHealth.bridgeLogTail || waHealth.statusOutput || "").split("\n").slice(-4).join("\n").trim();
        waAttention = waHealth.running
          ? `Gateway is running but the WhatsApp bridge isn't connected (source=${waHealth.source}). ${tail ? "Last log: " + tail : "Reconfigure to re-pair."}`
          : "Messaging gateway isn't running. Open the wizard to restart it.";
      }
    }

    const next: Record<string, ChannelStatus> = {};
    for (const channel of CHANNELS) {
      if (channel.tier === "paid" && !unlockMap[channel.upgradeId!]) {
        next[channel.id] = { state: "locked" };
        continue;
      }
      const configured = isChannelConfigured(channel, env, whatsappSessionReady);
      if (!configured) {
        pollStartRef.current.delete(channel.id);
        next[channel.id] = { state: "not-configured" };
      } else {
        const running = runningChannels.includes(channel.id);
        const startedAt = pollStartRef.current.get(channel.id);
        const withinGrace = !!startedAt && Date.now() - startedAt < 30000;
        if (running || !withinGrace) {
          pollStartRef.current.delete(channel.id);
        }
        const starting = !running && withinGrace;
        const attentionReason = channel.id === "whatsapp" ? waAttention : undefined;
        next[channel.id] = { state: "configured", running, starting, attentionReason };
      }
    }
    // #region agent log
    emitChannelsDebugLog("C4", "Channels.tsx:refresh:statuses", "final statuses computed", {
      statuses: next,
      runningChannels,
    });
    // #endregion
    setStatuses(next);
  }, [emitChannelsDebugLog]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-poll while any channel is in its post-setup grace window so the card
  // converges from "Starting…" → "Active" without waiting for a manual reload.
  useEffect(() => {
    const anyStarting = Object.values(statuses).some(
      (s) => s.state === "configured" && s.starting,
    );
    if (!anyStarting) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [statuses, refresh]);

  const handleWizardComplete = useCallback(
    (channelId: string) => {
      bumpCapabilityProbes();
      pollStartRef.current.set(channelId, Date.now());
      void refresh();
    },
    [refresh, bumpCapabilityProbes],
  );

  const handleRestartGateway = useCallback(async () => {
    setGatewayRestartBusy(true);
    try {
      await systemAPI.materializeEnv().catch(() => undefined);
      await systemAPI.stopGateway().catch(() => undefined);
      await systemAPI.materializeEnv().catch(() => undefined);
      await systemAPI.refreshGatewayInstall().catch(() => undefined);
      const r = await systemAPI.startGateway();
      if (!r.success) {
        toast.error("Could not restart messaging gateway", {
          description: r.stderr?.split("\n")[0] || r.stdout?.split("\n")[0] || "Check Logs and try again.",
        });
        return;
      }
      bumpCapabilityProbes();
      toast.success("Messaging gateway restarted");
    } finally {
      setGatewayRestartBusy(false);
      void refresh();
    }
  }, [refresh, bumpCapabilityProbes]);

  const confirmWhatsAppReset = async () => {
    setWhatsappResetBusy(true);
    try {
      const r = await systemAPI.resetWhatsAppChannel();
      if (!r.success) {
        toast.error("Could not reset WhatsApp", { description: r.error || "Try again." });
        return;
      }
      bumpCapabilityProbes();
      toast.success("WhatsApp reset", { description: "You can run Set up again whenever you are ready." });
      setWhatsappResetOpen(false);
      void refresh();
    } finally {
      setWhatsappResetBusy(false);
    }
  };

  const handleSetUp = (channel: Channel) => {
    if (channel.tier === "paid" && !unlocks[channel.upgradeId!]) {
      toast.info(`${channel.name} requires the ${channel.name} upgrade`, {
        description: "Scroll down to the Premium upgrades section to unlock it.",
      });
      return;
    }
    if (channel.id === "whatsapp" && statuses[channel.id]?.state === "configured") {
      setWhatsappResetOpen(true);
      return;
    }
    setActiveWizard(channel);
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
              whatsappResetOnly={c.id === "whatsapp" && statuses[c.id]?.state === "configured"}
              onResetWhatsApp={() => setWhatsappResetOpen(true)}
              onRestartGateway={() => void handleRestartGateway()}
              gatewayRestartBusy={c.id === "whatsapp" ? gatewayRestartBusy : false}
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
                whatsappResetOnly={c.id === "whatsapp" && statuses[c.id]?.state === "configured"}
                onResetWhatsApp={() => setWhatsappResetOpen(true)}
                onRestartGateway={() => void handleRestartGateway()}
                gatewayRestartBusy={c.id === "whatsapp" ? gatewayRestartBusy : false}
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
          onComplete={() => handleWizardComplete(activeWizard.id)}
        />
      )}

      <AlertDialog open={whatsappResetOpen} onOpenChange={(v) => !whatsappResetBusy && setWhatsappResetOpen(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset WhatsApp?</AlertDialogTitle>
            <AlertDialogDescription>
              This stops the messaging gateway, removes WhatsApp keys from your Ronbot secrets and{" "}
              <code className="text-xs font-mono">~/.hermes/.env</code>, and wipes the local WhatsApp session so the next
              setup starts with a fresh QR code.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={whatsappResetBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={whatsappResetBusy}
              onClick={(e) => {
                e.preventDefault();
                void confirmWhatsAppReset();
              }}
            >
              {whatsappResetBusy ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 inline animate-spin" /> Resetting…
                </>
              ) : (
                "Reset WhatsApp"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ChannelsPage;
