import { Settings as SettingsIcon, Save } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

const SettingsPage = () => {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <SettingsIcon className="w-6 h-6 text-primary" />
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">Agent configuration and preferences</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <GlassCard className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Agent Configuration</h3>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Agent Name</label>
              <Input defaultValue="my-hermes-agent" className="bg-background/50 border-white/10" />
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

        <GlassCard className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Gateway Platforms</h3>
          <div className="space-y-3">
            {["Telegram Bot", "Discord Bot", "REST API", "WebSocket"].map((platform) => (
              <div key={platform} className="flex items-center justify-between">
                <span className="text-sm text-foreground">{platform}</span>
                <Switch defaultChecked={platform === "REST API"} />
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
          <h3 className="text-sm font-semibold text-foreground">Scheduler / Cron Jobs</h3>
          <div className="space-y-2">
            {[
              { name: "Health Check", cron: "*/5 * * * *", enabled: true },
              { name: "Log Rotation", cron: "0 0 * * *", enabled: true },
              { name: "Model Sync", cron: "0 */6 * * *", enabled: false },
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
