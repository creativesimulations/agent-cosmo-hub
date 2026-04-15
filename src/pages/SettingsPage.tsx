import { useState } from "react";
import { Settings as SettingsIcon, Save, MessageSquare, Send } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import StatusBadge from "@/components/ui/StatusBadge";
import { cn } from "@/lib/utils";

interface Platform {
  name: string;
  label: string;
  enabled: boolean;
  configured: boolean;
  tokenField?: string;
  webhookField?: string;
}

const initialPlatforms: Platform[] = [
  { name: "rest_api", label: "REST API", enabled: true, configured: true },
  { name: "telegram", label: "Telegram Bot", enabled: false, configured: false, tokenField: "Bot Token", webhookField: "Webhook URL" },
  { name: "discord", label: "Discord Bot", enabled: false, configured: false, tokenField: "Bot Token" },
  { name: "websocket", label: "WebSocket", enabled: true, configured: true },
];

const SettingsPage = () => {
  const [platforms, setPlatforms] = useState(initialPlatforms);
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);

  const togglePlatform = (name: string) => {
    setPlatforms((prev) =>
      prev.map((p) => (p.name === name ? { ...p, enabled: !p.enabled } : p))
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <SettingsIcon className="w-6 h-6 text-primary" />
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">Agent configuration, platforms, and preferences</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <GlassCard className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Agent Configuration</h3>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Agent Name</label>
              <Input defaultValue="Ron" className="bg-background/50 border-white/10" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Gateway Port</label>
              <Input defaultValue="8000" className="bg-background/50 border-white/10" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Max Sub-Agents</label>
              <Input defaultValue="10" className="bg-background/50 border-white/10" />
            </div>
          </div>
        </GlassCard>

        {/* Gateway Platform Manager */}
        <GlassCard className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Send className="w-4 h-4 text-accent" />
            Gateway Platforms
          </h3>
          <div className="space-y-2">
            {platforms.map((platform) => (
              <div key={platform.name}>
                <div
                  className={cn(
                    "glass-subtle rounded-lg p-3 transition-all",
                    platform.tokenField && "cursor-pointer hover:bg-white/[0.04]"
                  )}
                  onClick={() =>
                    platform.tokenField &&
                    setExpandedPlatform(expandedPlatform === platform.name ? null : platform.name)
                  }
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={platform.configured ? (platform.enabled ? "online" : "offline") : "warning"} />
                      <span className="text-sm text-foreground">{platform.label}</span>
                      {!platform.configured && platform.tokenField && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/10 text-warning">
                          Not configured
                        </span>
                      )}
                    </div>
                    <Switch
                      checked={platform.enabled}
                      onCheckedChange={() => togglePlatform(platform.name)}
                    />
                  </div>
                </div>
                {expandedPlatform === platform.name && platform.tokenField && (
                  <div className="mt-1 ml-4 glass-subtle rounded-lg p-3 space-y-2">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">{platform.tokenField}</label>
                      <Input placeholder="Enter token..." className="bg-background/50 border-white/10 text-sm" />
                    </div>
                    {platform.webhookField && (
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">{platform.webhookField}</label>
                        <Input placeholder="https://..." className="bg-background/50 border-white/10 text-sm" />
                      </div>
                    )}
                    <Button size="sm" className="gradient-primary text-primary-foreground text-xs">
                      Save & Test Connection
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Behavior</h3>
          <div className="space-y-3">
            {[
              { label: "Auto-restart on crash", checked: true },
              { label: "Log to file", checked: true },
              { label: "Verbose logging", checked: false },
              { label: "Allow sub-agent spawning", checked: true },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between">
                <span className="text-sm text-foreground">{item.label}</span>
                <Switch defaultChecked={item.checked} />
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Notification Preferences</h3>
          <div className="space-y-3">
            {[
              { label: "Agent errors & crashes", checked: true },
              { label: "Sub-agent failures", checked: true },
              { label: "Resource usage spikes", checked: true },
              { label: "Update available", checked: true },
              { label: "Task completions", checked: false },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between">
                <span className="text-sm text-foreground">{item.label}</span>
                <Switch defaultChecked={item.checked} />
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="col-span-2 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Scheduler / Cron Jobs</h3>
          <div className="grid grid-cols-3 gap-2">
            {[
              { name: "Health Check", cron: "*/5 * * * *", enabled: true },
              { name: "Log Rotation", cron: "0 0 * * *", enabled: true },
              { name: "Model Sync", cron: "0 */6 * * *", enabled: false },
              { name: "Auto Backup", cron: "0 2 * * *", enabled: true },
              { name: "Token Usage Report", cron: "0 0 * * 1", enabled: false },
            ].map((job) => (
              <div key={job.name} className="glass-subtle rounded-lg p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm text-foreground">{job.name}</p>
                  <p className="text-xs font-mono text-muted-foreground">{job.cron}</p>
                </div>
                <Switch defaultChecked={job.enabled} />
              </div>
            ))}
          </div>
        </GlassCard>
      </div>

      <div className="flex justify-end">
        <Button className="gradient-primary text-primary-foreground">
          <Save className="w-4 h-4 mr-1" /> Save Configuration
        </Button>
      </div>
    </div>
  );
};

export default SettingsPage;
