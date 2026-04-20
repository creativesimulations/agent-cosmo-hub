import { useEffect, useState } from "react";
import { Settings as SettingsIcon, AlertCircle, Save, Loader2, User } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import { systemAPI } from "@/lib/systemAPI";
import { toast } from "sonner";

const SettingsPage = () => {
  const { connected: agentConnected } = useAgentConnection();
  const [name, setName] = useState("");
  const [originalName, setOriginalName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!agentConnected) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const current = await systemAPI.getAgentName();
      if (cancelled) return;
      const value = current ?? "";
      setName(value);
      setOriginalName(value);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [agentConnected]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Agent name cannot be empty");
      return;
    }
    setSaving(true);
    const result = await systemAPI.setAgentName(trimmed);
    setSaving(false);
    if (result.success) {
      setOriginalName(trimmed);
      toast.success(`Agent name saved`, {
        description: `Your agent will introduce itself as ${trimmed} in new conversations.`,
      });
    } else {
      toast.error("Failed to save agent name");
    }
  };

  const dirty = name.trim() !== originalName.trim() && name.trim().length > 0;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <SettingsIcon className="w-6 h-6 text-primary" />
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">Agent configuration, platforms, and preferences</p>
      </div>

      {!agentConnected ? (
        <GlassCard className="flex items-center justify-center py-16">
          <div className="text-center space-y-3">
            <AlertCircle className="w-10 h-10 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">No agent connected</p>
            <p className="text-xs text-muted-foreground/60">Install and start an agent to configure settings</p>
          </div>
        </GlassCard>
      ) : (
        <GlassCard className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Agent Identity</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Give your agent a name. It will introduce itself with this name and answer to it
            in every conversation. Stored in <code className="text-xs">~/.hermes/SOUL.md</code>.
          </p>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading current name…
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Ron"
                  className="bg-background/50 border-white/10"
                  disabled={saving}
                />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {originalName
                    ? <>Currently: <span className="text-primary font-semibold">{originalName}</span></>
                    : <>No name set yet — your agent will respond as "Hermes" by default.</>}
                </p>
                <Button
                  onClick={handleSave}
                  disabled={!dirty || saving}
                  className="gradient-primary text-primary-foreground"
                >
                  {saving ? (
                    <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Saving…</>
                  ) : (
                    <><Save className="w-4 h-4 mr-1" /> Save name</>
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground/70">
                Tip: start a fresh chat (Clear all) after changing the name so the agent loads
                the new identity from scratch.
              </p>
            </div>
          )}
        </GlassCard>
      )}
    </div>
  );
};

export default SettingsPage;
