import { useCallback, useEffect, useMemo, useState } from "react";
import { Radio } from "lucide-react";
import ChannelCard, { ChannelStatus } from "@/components/channels/ChannelCard";
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
 * runtime repair via chat. The renderer never shells
 * out to Hermes for any setup-style action.
 */

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
        </div>
      </section>
    </div>
  );
};

export default ChannelsPage;
