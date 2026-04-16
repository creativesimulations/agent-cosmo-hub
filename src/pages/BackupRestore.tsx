import { useState } from "react";
import { Archive, Download, Upload, Trash2, Clock, CheckCircle2, FolderArchive, Loader2, AlertCircle } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface Backup {
  id: string;
  name: string;
  date: string;
  size: string;
  includes: string[];
}

const BackupRestore = () => {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [creating, setCreating] = useState(false);
  const [createProgress, setCreateProgress] = useState(0);
  const [selectedItems, setSelectedItems] = useState(["config", "keys", "skills", "schedules"]);
  const [agentConnected] = useState(false);

  const toggleItem = (item: string) => {
    setSelectedItems((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
    );
  };

  const createBackup = async () => {
    if (!agentConnected) return;
    setCreating(true);
    setCreateProgress(0);
    // TODO: implement real backup via systemAPI
    setCreating(false);
  };

  if (!agentConnected) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Archive className="w-6 h-6 text-primary" />
            Backup & Restore
          </h1>
          <p className="text-sm text-muted-foreground">Export and import your agent configuration</p>
        </div>
        <GlassCard className="flex items-center justify-center py-16">
          <div className="text-center space-y-3">
            <AlertCircle className="w-10 h-10 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">No agent connected</p>
            <p className="text-xs text-muted-foreground/60">Install and start an agent to manage backups</p>
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Archive className="w-6 h-6 text-primary" />
          Backup & Restore
        </h1>
        <p className="text-sm text-muted-foreground">Export and import your agent configuration</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <GlassCard className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Create Backup</h3>
          <div className="space-y-2">
            {[
              { id: "config", label: "Agent Config", desc: "config.yaml and settings" },
              { id: "keys", label: "API Keys", desc: "Encrypted provider credentials" },
              { id: "skills", label: "Skills", desc: "Installed skills and preferences" },
              { id: "schedules", label: "Schedules", desc: "Cron jobs and automations" },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => toggleItem(item.id)}
                className={cn(
                  "w-full text-left glass-subtle rounded-lg p-3 transition-all",
                  selectedItems.includes(item.id)
                    ? "border border-primary/20 bg-primary/5"
                    : "border border-transparent"
                )}
              >
                <p className="text-sm text-foreground">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </button>
            ))}
          </div>
          {creating && <Progress value={createProgress} className="h-1" />}
          <Button
            onClick={createBackup}
            disabled={creating || selectedItems.length === 0}
            className="w-full gradient-primary text-primary-foreground"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <FolderArchive className="w-4 h-4 mr-1" />}
            {creating ? "Creating..." : "Create Backup"}
          </Button>
        </GlassCard>

        <GlassCard className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Import Backup</h3>
          <div className="border-2 border-dashed border-white/10 rounded-xl p-8 text-center space-y-3 hover:border-primary/30 transition-colors cursor-pointer">
            <Upload className="w-8 h-8 text-muted-foreground mx-auto" />
            <div>
              <p className="text-sm text-foreground">Drop backup file here</p>
              <p className="text-xs text-muted-foreground">or click to browse</p>
            </div>
          </div>
        </GlassCard>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Backup History</h3>
        {backups.length === 0 ? (
          <GlassCard variant="subtle" className="text-center py-8">
            <p className="text-sm text-muted-foreground/60">No backups yet</p>
          </GlassCard>
        ) : (
          backups.map((backup) => (
            <GlassCard key={backup.id} variant="subtle" className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FolderArchive className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-sm font-medium text-foreground">{backup.name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" /> {backup.date}
                    <span>•</span>
                    <span>{backup.size}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                  <Download className="w-4 h-4 mr-1" /> Export
                </Button>
                <Button variant="ghost" size="sm" className="text-primary hover:text-primary">
                  <CheckCircle2 className="w-4 h-4 mr-1" /> Restore
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </GlassCard>
          ))
        )}
      </div>
    </div>
  );
};

export default BackupRestore;
