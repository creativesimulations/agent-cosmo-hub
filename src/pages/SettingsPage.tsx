import { useEffect, useState } from "react";
import {
  Settings as SettingsIcon,
  AlertCircle,
  Save,
  Loader2,
  User,
  Sun,
  Moon,
  Monitor,
  Bell,
  Volume2,
  RefreshCw,
  Database,
  AlertTriangle,
  Trash2,
  Power,
  Play,
  History,
  Network,
  ChevronDown,
  Box,
  Users,
  Keyboard,
  ExternalLink,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import GlassCard from "@/components/ui/GlassCard";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import { useSettings, ThemeMode } from "@/contexts/SettingsContext";
import { useChat } from "@/contexts/ChatContext";
import { systemAPI } from "@/lib/systemAPI";
import {
  ensureNotificationPermission,
  playReplyChime,
  unlockChime,
  showDesktopNotification,
} from "@/lib/notify";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import ActionableError from "@/components/ui/ActionableError";

/** A labelled toggle row — keeps the page readable when there are 8+ settings. */
const ToggleRow = ({
  title,
  description,
  checked,
  onCheckedChange,
  disabled,
  trailing,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  trailing?: React.ReactNode;
}) => (
  <div className="flex items-start justify-between gap-4 py-3 border-b border-border/40 last:border-b-0">
    <div className="space-y-0.5 min-w-0 flex-1">
      <Label className="text-sm font-medium text-foreground cursor-pointer">{title}</Label>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
    <div className="flex items-center gap-2 shrink-0">
      {trailing}
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  </div>
);

const ThemeOption = ({
  mode,
  current,
  onSelect,
  icon: Icon,
  label,
}: {
  mode: ThemeMode;
  current: ThemeMode;
  onSelect: (m: ThemeMode) => void;
  icon: typeof Sun;
  label: string;
}) => {
  const active = mode === current;
  return (
    <button
      type="button"
      onClick={() => onSelect(mode)}
      className={cn(
        "flex flex-col items-center gap-2 px-4 py-3 rounded-lg border transition-all",
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border bg-background/30 text-muted-foreground hover:text-foreground hover:border-border",
      )}
    >
      <Icon className={cn("w-5 h-5", active && "text-primary")} />
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
};

/**
 * A collapsible Settings section. Header (icon + title) is the trigger,
 * a chevron rotates 180° when open. Always starts closed.
 *
 * `bare` skips the outer GlassCard frame — used for panels that render
 * their own GlassCard internally.
 */
const SettingsSection = ({
  icon: Icon,
  title,
  iconClassName,
  bare,
  className,
  children,
}: {
  icon: typeof Sun;
  title: string;
  iconClassName?: string;
  bare?: boolean;
  className?: string;
  children: React.ReactNode;
}) => {
  const Header = (
    <CollapsibleTrigger
      className={cn(
        "group w-full flex items-center justify-between gap-3 rounded-lg text-left transition-colors",
        bare ? "px-5 py-4 glass hover:bg-foreground/5" : "hover:bg-foreground/5 -m-2 p-2",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn("w-5 h-5 text-primary", iconClassName)} />
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      </div>
      <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  );

  if (bare) {
    return (
      <Collapsible defaultOpen={false} className={cn("rounded-xl", className)}>
        {Header}
        <CollapsibleContent>
          <div className="mt-3">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <GlassCard className={cn("p-6", className)}>
      <Collapsible defaultOpen={false}>
        {Header}
        <CollapsibleContent>
          <div className="pt-4 space-y-4">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    </GlassCard>
  );
};

const SettingsPage = () => {
  const { connected: agentConnected, refresh: refreshConnection } = useAgentConnection();
  const { settings, update, reset } = useSettings();
  const { clearAll, startNewSession } = useChat();

  const [name, setName] = useState("");
  const [originalName, setOriginalName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Confirmation dialogs
  const [confirmClearChat, setConfirmClearChat] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);

  const [settingsError, setSettingsError] = useState<string>("");

  // Sandbox / terminal backend
  const [terminalBackend, setTerminalBackend] = useState<"local" | "docker" | "ssh">("local");

  // Hermes profiles (isolated agent instances)
  const [profiles, setProfiles] = useState<Array<{ name: string; active?: boolean }>>([]);
  const [profilesCliAvailable, setProfilesCliAvailable] = useState(true);
  const [profilesLoading, setProfilesLoading] = useState(false);

  // Busy-input mode — what happens when the user types while the agent is replying
  const [busyInputMode, setBusyInputMode] = useState<"queue" | "interrupt" | "steer">("queue");
  const [busyInputSaving, setBusyInputSaving] = useState(false);

  useEffect(() => {
    if (!agentConnected) return;
    let cancelled = false;
    (async () => {
      const cfg = await systemAPI.readConfig();
      if (cancelled || !cfg.success || !cfg.content) return;
      const m = cfg.content.match(/^terminal:\s*\n(?:[ \t]+.*\n)*?[ \t]+backend:\s*([a-z]+)/im);
      if (m && (m[1] === "local" || m[1] === "docker" || m[1] === "ssh")) {
        setTerminalBackend(m[1]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentConnected]);

  const handleTerminalBackendChange = async (next: "local" | "docker" | "ssh") => {
    setTerminalBackend(next);
    const cfg = await systemAPI.readConfig();
    let body = cfg.success && cfg.content ? cfg.content : "";
    // Strip any existing managed terminal block, then append a fresh one.
    body = body.replace(/^terminal:\s*\n(?:[ \t]+.*\n?)*/im, "").trimEnd();
    body += `\n\nterminal:\n  backend: ${next}\n`;
    const w = await systemAPI.writeConfig(body);
    if (w.success) {
      setSettingsError("");
      toast.success(`Terminal backend set to ${next}`, {
        description:
          next === "local"
            ? "Commands run directly on this machine."
            : next === "docker"
              ? "Commands run inside a sandboxed Docker container. Set DOCKER_IMAGE in Secrets."
              : "Commands run over SSH. Set SSH_HOST / SSH_USER / SSH_KEY_PATH in Secrets.",
      });
    } else {
      setSettingsError(w.error || "Failed to update config");
      toast.error("Couldn't save", { description: w.error || "Failed to update config" });
    }
  };

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

  const handleSaveName = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Agent name cannot be empty");
      return;
    }
    setSaving(true);
    const result = await systemAPI.setAgentName(trimmed);
    setSaving(false);
    if (result.success) {
      setSettingsError("");
      setOriginalName(trimmed);
      toast.success("Agent name saved", {
        description: `Your agent will introduce itself as ${trimmed} in new conversations.`,
      });
    } else {
      setSettingsError("Failed to save agent name");
      toast.error("Failed to save agent name");
    }
  };

  const handleToggleNotifications = async (next: boolean) => {
    if (next) {
      const perm = await ensureNotificationPermission();
      if (perm !== "granted") {
        toast.error("Notification permission denied", {
          description: "Enable notifications for this app in your OS settings, then try again.",
        });
        return;
      }
    }
    update({ desktopNotifications: next });
  };

  const handleTestSound = () => {
    unlockChime();
    playReplyChime();
  };

  const handleTestNotification = async () => {
    const perm = await ensureNotificationPermission();
    if (perm !== "granted") {
      toast.error("Notification permission denied");
      return;
    }
    showDesktopNotification("Test notification", "This is what an agent reply alert looks like.");
    toast.info("Sent test notification", {
      description: "If you didn't see it, the app window is currently focused.",
    });
  };

  const handleWipeSession = () => {
    startNewSession();
    toast.success("Session ID wiped", { description: "Your next message will start a fresh agent session." });
  };

  const handleClearChat = () => {
    clearAll();
    setConfirmClearChat(false);
  };

  const handleReset = () => {
    reset();
    setConfirmReset(false);
    toast.success("Settings reset to defaults");
  };

  const handleUninstall = async () => {
    setConfirmUninstall(false);
    setUninstalling(true);
    const r = await systemAPI.hermesUninstall();
    setUninstalling(false);
    if (r.success) {
      setSettingsError("");
      toast.success("Hermes uninstalled", {
        description: "All agent files and the venv have been removed.",
      });
      // Force a re-detect — connection should now flip to disconnected.
      void refreshConnection();
    } else {
      setSettingsError(r.stderr?.split("\n")[0] || "Uninstall failed");
      toast.error("Uninstall failed", {
        description: r.stderr?.split("\n")[0] || "Check Logs for details.",
      });
    }
  };

  const dirty = name.trim() !== originalName.trim() && name.trim().length > 0;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <SettingsIcon className="w-6 h-6 text-primary" />
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">Appearance, behavior, notifications, and maintenance</p>
      </div>

      {settingsError && (
        <ActionableError
          title="Settings action failed"
          summary={settingsError}
          details={settingsError}
          onFix={() => setSettingsError("")}
          fixLabel="Dismiss"
        />
      )}

      {/* ─── General ─────────────────────────────────────────── */}
      <SettingsSection icon={Sun} title="General">
        <div>
          <Label className="text-sm font-medium text-foreground">Theme</Label>
          <p className="text-xs text-muted-foreground mb-3">
            Switch the entire interface between dark, light, and following your OS.
          </p>
          <div className="grid grid-cols-3 gap-3 max-w-md">
            <ThemeOption
              mode="dark"
              current={settings.theme}
              onSelect={(m) => update({ theme: m })}
              icon={Moon}
              label="Dark"
            />
            <ThemeOption
              mode="light"
              current={settings.theme}
              onSelect={(m) => update({ theme: m })}
              icon={Sun}
              label="Light"
            />
            <ThemeOption
              mode="system"
              current={settings.theme}
              onSelect={(m) => update({ theme: m })}
              icon={Monitor}
              label="System"
            />
          </div>
        </div>
      </SettingsSection>

      {/* ─── General: Agent Identity ───────────────────────────── */}
      {agentConnected ? (
        <SettingsSection icon={User} title="Agent Identity">
          <p className="text-sm text-muted-foreground">
            Give your agent a name. Stored in <code className="text-xs">~/.hermes/SOUL.md</code>.
          </p>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading current name…
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Ron"
                  className="bg-background/50 border-border"
                  disabled={saving}
                />
                <Button
                  onClick={handleSaveName}
                  disabled={!dirty || saving}
                  className="gradient-primary text-primary-foreground"
                >
                  {saving ? (
                    <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Saving…</>
                  ) : (
                    <><Save className="w-4 h-4 mr-1" /> Save</>
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {originalName ? (
                  <>Currently: <span className="text-primary font-semibold">{originalName}</span></>
                ) : (
                  <>No name set — your agent will respond as "Hermes" by default.</>
                )}
              </p>
            </div>
          )}
        </SettingsSection>
      ) : (
        <GlassCard className="p-6 flex items-center gap-3 text-sm text-muted-foreground">
          <AlertCircle className="w-5 h-5 text-muted-foreground/60" />
          Install and connect an agent to set its name.
        </GlassCard>
      )}

      {/* ─── General Behavior ─────────────────────────────────── */}
      <SettingsSection icon={Play} title="General Behavior">
        <div className="-mt-2">
          <ToggleRow
            title="Auto-start agent on app launch"
            description="Warm up the Hermes runtime in the background when the app opens, so your first chat reply is fast."
            checked={settings.autoStartAgent}
            onCheckedChange={(v) => update({ autoStartAgent: v })}
          />
          <ToggleRow
            title="Auto-resume last session"
            description="When ON, new messages continue the same Hermes session across app restarts. When OFF, every app restart starts fresh."
            checked={settings.autoResumeSession}
            onCheckedChange={(v) => update({ autoResumeSession: v })}
          />
          <ToggleRow
            title="Keep agent running when window is closed"
            description="Closing the app window minimizes Ronbot to your system tray instead of quitting. The agent keeps running in the background, so messaging gateways (WhatsApp, Telegram, Slack…) and any in-flight reply continue. Right-click the tray icon to fully quit."
            checked={settings.runInBackground}
            onCheckedChange={(v) => update({ runInBackground: v })}
          />
        </div>
      </SettingsSection>

      {/* ─── Notifications ─────────────────────────────────────── */}
      <SettingsSection icon={Bell} title="Notifications">
        <div className="-mt-2">
          <ToggleRow
            title="Desktop notification when reply lands"
            description="Get an OS-level popup when the agent finishes replying while the app is in the background."
            checked={settings.desktopNotifications}
            onCheckedChange={handleToggleNotifications}
            trailing={
              <Button variant="outline" size="sm" onClick={handleTestNotification}>Test</Button>
            }
          />
          <ToggleRow
            title="Sound on reply"
            description="Play a short chime when the agent finishes replying."
            checked={settings.soundOnReply}
            onCheckedChange={(v) => {
              if (v) unlockChime();
              update({ soundOnReply: v });
            }}
            trailing={
              <Button variant="outline" size="sm" onClick={handleTestSound}>
                <Volume2 className="w-4 h-4" />
              </Button>
            }
          />
          <ToggleRow
            title="Notify on sub-agent completion"
            description="Get a desktop notification each time a delegated sub-agent finishes its task."
            checked={settings.notifyOnSubAgentComplete}
            onCheckedChange={async (v) => {
              if (v) {
                const perm = await ensureNotificationPermission();
                if (perm !== "granted") {
                  toast.error("Notification permission denied");
                  return;
                }
              }
              update({ notifyOnSubAgentComplete: v });
            }}
          />
        </div>
      </SettingsSection>

      {/* ─── Sandbox / terminal backend ────────────────────────── */}
      {agentConnected && (
        <SettingsSection icon={Box} title="Sandbox">
          <p className="text-sm text-muted-foreground">
            Choose where the agent's <code>terminal</code> commands run. Default is your local
            machine; pick Docker or SSH to isolate the agent from the host.
          </p>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Terminal backend</Label>
            <Select value={terminalBackend} onValueChange={(v) => void handleTerminalBackendChange(v as "local" | "docker" | "ssh")}>
              <SelectTrigger className="w-full sm:w-72 bg-background/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local (this machine)</SelectItem>
                <SelectItem value="docker">Docker container (sandboxed)</SelectItem>
                <SelectItem value="ssh">Remote SSH host</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {terminalBackend === "local"
                ? "Commands run directly on this machine with your user permissions."
                : terminalBackend === "docker"
                  ? "Commands run inside a Docker container. Add DOCKER_IMAGE in Secrets to override the default image."
                  : "Commands run over SSH. Add SSH_HOST, SSH_USER, and SSH_KEY_PATH in Secrets."}
            </p>
          </div>
        </SettingsSection>
      )}

      <SettingsSection icon={History} title="Privacy">
        <div className="space-y-4 -mt-2">
          <div className="flex items-start justify-between gap-4 py-3 border-b border-border/40">
            <div className="space-y-0.5 min-w-0 flex-1">
              <Label className="text-sm font-medium text-foreground">Chat messages kept locally</Label>
              <p className="text-xs text-muted-foreground">
                Older messages are dropped from localStorage (the Hermes session itself is unaffected).
                Set to 0 for unlimited.
              </p>
            </div>
            <Input
              type="number"
              min={0}
              max={10000}
              value={settings.maxStoredMessages}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                update({ maxStoredMessages: Number.isFinite(n) && n >= 0 ? n : 0 });
              }}
              className="w-28 bg-background/50 border-border"
            />
          </div>

          <div className="flex items-start justify-between gap-4 py-3 border-b border-border/40">
            <div className="space-y-0.5 min-w-0 flex-1">
              <Label className="text-sm font-medium text-foreground">Per-prompt timeout (seconds)</Label>
              <p className="text-xs text-muted-foreground">
                How long to wait for the agent to finish a single prompt before giving up.
                Multi-step / sub-agent runs can take many minutes — raise this to 900–1800
                if you're seeing "agent didn't finish" errors. Min 60, max 1800.
              </p>
            </div>
            <Input
              type="number"
              min={60}
              max={1800}
              step={30}
              value={settings.chatTimeoutSec}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!Number.isFinite(n)) return;
                update({ chatTimeoutSec: Math.min(1800, Math.max(60, n)) });
              }}
              className="w-28 bg-background/50 border-border"
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={handleWipeSession} className="flex-1">
              <Network className="w-4 h-4 mr-2" />
              Wipe stored session ID
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirmClearChat(true)}
              className="flex-1"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Clear all chat history
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Wiping the session ID forces your next message to start a fresh Hermes session.
            Clearing history just empties this app's local copy of the conversation.
          </p>
        </div>
      </SettingsSection>

      {/* ─── Advanced ───────────────────────────────────────────── */}
      <SettingsSection icon={AlertTriangle} title="Advanced">
        <div className="-mt-2">
          <ToggleRow
            title="Auto-check for app & agent updates"
            description="Automatically run hermes update in the background every 6 hours from the Update Manager tab."
            checked={settings.autoCheckUpdates}
            onCheckedChange={(v) => update({ autoCheckUpdates: v })}
          />
        </div>
      </SettingsSection>

      <GlassCard className="border-destructive/40 bg-destructive/5">
        <p className="text-sm text-muted-foreground">
          Destructive actions. Both ask for confirmation first.
        </p>

        <div className="space-y-3">
          <div className="flex items-start justify-between gap-4 p-3 rounded-lg border border-border/60 bg-background/30">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Reset all settings</p>
              <p className="text-xs text-muted-foreground">
                Restore every preference on this page to its default. Doesn't touch chat history,
                secrets, or the installed agent.
              </p>
            </div>
            <Button variant="destructive" onClick={() => setConfirmReset(true)}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Reset settings
            </Button>
          </div>

          <div className="flex items-start justify-between gap-4 p-3 rounded-lg border border-destructive/40 bg-destructive/5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Uninstall Hermes</p>
              <p className="text-xs text-muted-foreground">
                Deletes <code>~/.hermes</code> (config, venv, skills, logs, state.db) and removes
                the <code>hermes-agent</code> Python package. Your secrets stored in the OS keychain
                are NOT touched.
              </p>
            </div>
            <Button
              variant="destructive"
              onClick={() => setConfirmUninstall(true)}
              disabled={uninstalling || !agentConnected}
            >
              {uninstalling ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uninstalling…</>
              ) : (
                <><Power className="w-4 h-4 mr-2" /> Uninstall Hermes</>
              )}
            </Button>
          </div>
        </div>
      </GlassCard>

      {/* ─── Confirmation dialogs ──────────────────────────────── */}
      <AlertDialog open={confirmClearChat} onOpenChange={setConfirmClearChat}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all chat history?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes every message stored in this app. The Hermes session itself is preserved
              — the agent will still remember the conversation if you ask it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearChat}>Clear history</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all settings?</AlertDialogTitle>
            <AlertDialogDescription>
              Every toggle on this page returns to its default. Chat history, secrets, and the
              installed agent are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset}>Reset</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmUninstall} onOpenChange={setConfirmUninstall}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Uninstall Hermes?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <code>~/.hermes</code> including your config, the Python
              venv, all installed skills, all logs, and the local state database. The Python package
              will also be removed. This cannot be undone — you'll need to re-run the installer to
              use the agent again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUninstall}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Uninstall
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
};

export default SettingsPage;
