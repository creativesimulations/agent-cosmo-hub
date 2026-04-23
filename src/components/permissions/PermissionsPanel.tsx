import { useState } from "react";
import { Shield, X, FolderOpen, FolderX, RefreshCw, Loader2, FolderPlus } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/contexts/SettingsContext";
import { systemAPI } from "@/lib/systemAPI";
import { toast } from "@/hooks/use-toast";
import {
  PermissionDefault,
  PermissionsConfig,
  PERMISSION_LABELS,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";

/** Three-way segmented control for a permission default. */
const ModeSelect = ({
  value,
  onChange,
  options,
}: {
  value: PermissionDefault;
  onChange: (v: PermissionDefault) => void;
  options?: PermissionDefault[];
}) => {
  const all: PermissionDefault[] = options ?? ["allow", "ask", "deny"];
  return (
    <div className="inline-flex rounded-md border border-border bg-background/40 p-0.5">
      {all.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={cn(
            "px-2.5 py-1 text-[11px] rounded transition-colors capitalize",
            value === opt
              ? opt === "deny"
                ? "bg-destructive/20 text-destructive"
                : opt === "allow"
                  ? "bg-success/20 text-success"
                  : "bg-primary/20 text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {opt === "ask" ? "Ask each time" : opt}
        </button>
      ))}
    </div>
  );
};

const PermRow = ({
  title,
  description,
  value,
  onChange,
  trailing,
}: {
  title: string;
  description: string;
  value: PermissionDefault;
  onChange: (v: PermissionDefault) => void;
  trailing?: React.ReactNode;
}) => (
  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 py-3 border-b border-border/40 last:border-b-0">
    <div className="space-y-0.5 min-w-0 flex-1">
      <Label className="text-sm font-medium text-foreground">{title}</Label>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
    <div className="flex items-center gap-2 shrink-0">
      {trailing}
      <ModeSelect value={value} onChange={onChange} />
    </div>
  </div>
);

/** Editable list of folder paths (allow / block) using the OS folder picker. */
const FolderList = ({
  title,
  description,
  icon: Icon,
  paths,
  onChange,
  pickerTitle,
}: {
  title: string;
  description: string;
  icon: typeof FolderOpen;
  paths: string[];
  onChange: (next: string[]) => void;
  pickerTitle: string;
}) => {
  const [picking, setPicking] = useState(false);

  const pickFolder = async () => {
    setPicking(true);
    try {
      const r = await systemAPI.selectFolder({ title: pickerTitle });
      if (!r.success) {
        toast({
          title: "Couldn't open folder picker",
          description: r.error || "Unknown error",
          variant: "destructive",
        });
        return;
      }
      if (r.canceled || !r.path) return;
      const chosen = r.path.trim();
      if (!chosen) return;
      if (paths.includes(chosen)) {
        toast({ title: "Already in the list", description: chosen });
        return;
      }
      onChange([...paths, chosen]);
    } finally {
      setPicking(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-muted-foreground" />
          <Label className="text-sm font-medium text-foreground">{title}</Label>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={pickFolder}
          disabled={picking}
        >
          {picking ? (
            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
          ) : (
            <FolderPlus className="w-3.5 h-3.5 mr-1.5" />
          )}
          Add folder…
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
      {paths.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {paths.map((p) => (
            <span
              key={p}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-background/50 border border-border text-xs font-mono"
            >
              {p}
              <button
                type="button"
                onClick={() => onChange(paths.filter((x) => x !== p))}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Remove ${p}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground/60 italic pt-1">
          No folders yet — click "Add folder…" to choose one.
        </p>
      )}
    </div>
  );
};

const PermissionsPanel = () => {
  const { settings, update } = useSettings();
  const perms = settings.permissions;
  const [syncing, setSyncing] = useState(false);

  const setPerms = (patch: Partial<PermissionsConfig>) => {
    update({ permissions: { ...perms, ...patch } });
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await systemAPI.syncPermissions(perms);
      if (r.success) {
        toast({ title: "Permissions synced", description: "Your rules were written to ~/.hermes/config.yaml" });
      } else {
        toast({ title: "Sync failed", description: r.error || "Unknown error", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Sync failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <GlassCard className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Permissions</h2>
        </div>
        <Button size="sm" variant="outline" onClick={syncNow} disabled={syncing}>
          {syncing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
          Sync to agent now
        </Button>
      </div>
      <p className="text-sm text-muted-foreground -mt-2">
        Control what your agent can do without asking. Rules are auto-synced to the agent on every
        message — sub-agents inherit them too. Use "Sync to agent now" to push them immediately.
      </p>

      <div className="-mt-1">
        <PermRow
          title={PERMISSION_LABELS.shell}
          description="Run shell commands like `python3 script.py`, `git push`, package installs."
          value={perms.shell}
          onChange={(v) => setPerms({ shell: v })}
          trailing={
            <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground mr-2">
              <Switch
                checked={perms.shellAllowReadOnly}
                onCheckedChange={(v) => setPerms({ shellAllowReadOnly: v })}
              />
              auto-allow read-only (ls, cat…)
            </label>
          }
        />
        <PermRow
          title={PERMISSION_LABELS.fileRead}
          description="Read files from disk. With scoped mode, only the allow-listed folders below."
          value={perms.fileRead}
          onChange={(v) => setPerms({ fileRead: v })}
          trailing={
            perms.fileRead === "allow" && (
              <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground mr-2">
                <Switch
                  checked={perms.fileReadScope === "scoped"}
                  onCheckedChange={(v) => setPerms({ fileReadScope: v ? "scoped" : "anywhere" })}
                />
                scoped only
              </label>
            )
          }
        />
        <PermRow
          title={PERMISSION_LABELS.fileWrite}
          description="Create, modify, or delete files. With scoped mode, only the allow-listed folders below."
          value={perms.fileWrite}
          onChange={(v) => setPerms({ fileWrite: v })}
          trailing={
            perms.fileWrite === "allow" && (
              <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground mr-2">
                <Switch
                  checked={perms.fileWriteScope === "scoped"}
                  onCheckedChange={(v) => setPerms({ fileWriteScope: v ? "scoped" : "anywhere" })}
                />
                scoped only
              </label>
            )
          }
        />
        <PermRow
          title={PERMISSION_LABELS.internet}
          description="Fetch URLs, hit APIs, download files."
          value={perms.internet}
          onChange={(v) => setPerms({ internet: v })}
        />
        <PermRow
          title={PERMISSION_LABELS.script}
          description="Execute Python / Node / Bash scripts the agent has authored."
          value={perms.script}
          onChange={(v) => setPerms({ script: v })}
        />
        <PermRow
          title={PERMISSION_LABELS.subAgent}
          description="Spawn delegated sub-agents to handle sub-tasks in parallel."
          value={perms.subAgent}
          onChange={(v) => setPerms({ subAgent: v })}
        />
        <PermRow
          title="Default fallback"
          description="What to do when an action doesn't match any of the categories above."
          value={perms.fallback}
          onChange={(v) => setPerms({ fallback: v })}
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4 pt-2">
        <FolderList
          title="Allow-listed folders"
          description="Folders the agent may freely read/write inside (when scope = scoped)."
          icon={FolderOpen}
          paths={perms.allowedFolders}
          onChange={(next) => setPerms({ allowedFolders: next })}
          pickerTitle="Choose a folder to allow"
        />
        <FolderList
          title="Blocked folders"
          description="Always denied — overrides every other setting."
          icon={FolderX}
          paths={perms.blockedFolders}
          onChange={(next) => setPerms({ blockedFolders: next })}
          pickerTitle="Choose a folder to block"
        />
      </div>
    </GlassCard>
  );
};

export default PermissionsPanel;
