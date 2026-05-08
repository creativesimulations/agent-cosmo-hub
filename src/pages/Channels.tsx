import { useCallback, useEffect, useMemo, useState } from "react";
import { Radio, Sparkles } from "lucide-react";
import ChannelCard, { ChannelStatus } from "@/components/channels/ChannelCard";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { systemAPI } from "@/lib/systemAPI";
import { useNavigate } from "react-router-dom";
import { useChat } from "@/contexts/ChatContext";
import { useCapabilities } from "@/contexts/CapabilitiesContext";
import { filterByKind } from "@/lib/capabilities/discovery";
import type { DiscoveredCapability } from "@/lib/capabilities/types";

/**
 * Channels page — purely a directory of channels the agent supports.
 *
 * Setup is fully agent-driven via chat: clicking "Set up" seeds the
 * capability's setup prompt into the chat composer; the agent owns
 * credential collection, OAuth, QR pairing, gateway lifecycle, and
 * runtime repair via the intent protocol. The renderer never shells
 * out to Hermes for any setup-style action.
 */

const GOOGLE_WORKSPACE_PROMPT =
  "Please set up Google Workspace for me (Gmail, Calendar, Drive, Docs, Sheets). " +
  "Walk me through any login or permission steps and ask for anything you need.";

const ChannelsPage = () => {
  const navigate = useNavigate();
  const { setDraft } = useChat();
  const { discovered, discoveryFromHermes } = useCapabilities();

  const channels = useMemo<DiscoveredCapability[]>(
    () => filterByKind(discovered, ["channel"]).sort((a, b) => a.name.localeCompare(b.name)),
    [discovered],
  );

  const [statuses, setStatuses] = useState<Record<string, ChannelStatus>>({});

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
      const enabledKey = `${channel.id.toUpperCase().replace(/-/g, "_")}_ENABLED`;
      return (env[enabledKey] || "").trim().toLowerCase() === "true";
    }
    return required.every((k) => !!env[k] && env[k].trim().length > 0);
  };

  const refresh = useCallback(async () => {
    const env = await systemAPI.readEnvFile();
    const ids = channels.map((c) => c.id);
    const running = await getRunningChannels(ids);

    const next: Record<string, ChannelStatus> = {};
    for (const channel of channels) {
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

  const delegateToAgent = (prompt: string) => {
    setDraft(prompt);
    navigate("/");
  };

  const handleSetUp = (channel: DiscoveredCapability) => {
    delegateToAgent(channel.setupPrompt);
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

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/70">
          Available Channels
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {channels.map((c) => (
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
          <GlassCard className="p-5 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-foreground">Google Workspace</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Gmail, Calendar, Drive, Docs, and Sheets integration.
              </p>
              <p className="text-[11px] text-muted-foreground/70">
                Your agent will guide you through login in chat.
              </p>
            </div>
            <div className="flex flex-col gap-2 mt-auto">
              <Button
                size="sm"
                onClick={() => delegateToAgent(GOOGLE_WORKSPACE_PROMPT)}
                className="gradient-primary text-primary-foreground w-full"
              >
                Set up
              </Button>
            </div>
          </GlassCard>
        </div>
      </section>
    </div>
  );
};

export default ChannelsPage;
