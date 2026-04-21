import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  Download,
  Upload,
  Trash2,
  Clock,
  CheckCircle2,
  FolderArchive,
  Loader2,
  AlertCircle,
  RefreshCw,
  Check,
} from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import { systemAPI } from "@/lib/systemAPI";
import { toast } from "sonner";
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

interface Backup {
  id: string; // filename (no ext)
  name: string;
  date: string;
  sizeBytes: number;
  fullPath: string;
}

interface BackupItem {
  id: "config" | "secrets" | "skills" | "memory" | "logs";
  label: string;
  desc: string;
  /** Path glob relative to ~/.hermes that the tar should include. */
  include: string;
}

const ITEMS: BackupItem[] = [
  { id: "config", label: "Agent Config", desc: "config.yaml, .env, SOUL.md", include: "config.yaml .env SOUL.md" },
  { id: "secrets", label: "Secrets snapshot", desc: ".env file (keychain secrets are managed separately)", include: ".env" },
  { id: "skills", label: "Skills", desc: "Installed skills folder", include: "skills" },
  { id: "memory", label: "Memory & state", desc: "state.db and persistent memory", include: "state.db memory" },
  { id: "logs", label: "Logs", desc: "Recent agent logs", include: "logs" },
];

const formatBytes = (b: number) => {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
};

const formatDate = (d: Date) =>
  d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Quote a path for POSIX shell. */
const sh = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

/** Convert a Windows path (C:\Users\X\foo) to a WSL-mounted path (/mnt/c/Users/X/foo). */
const toPosixPath = (p: string): string => {
  const m = p.match(/^([A-Za-z]):[\\/](.*)$/);
  if (!m) return p.replace(/\\/g, "/");
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}`;
};

/** Wrap a bash script so it runs through WSL on Windows, native bash elsewhere. */
const wrapBash = (script: string, isWindows: boolean): string => {
  // base64-encode to avoid every layer of quoting (cmd.exe, wsl, bash).
  const b64 = btoa(unescape(encodeURIComponent(script)));
  const decode = `echo ${b64} | base64 -d | bash`;
  return isWindows ? `wsl bash -lc "${decode}"` : `bash -lc '${decode}'`;
};

const BackupRestore = () => {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [creating, setCreating] = useState(false);
  const [createProgress, setCreateProgress] = useState(0);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<Backup | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Backup | null>(null);
  const [selectedItems, setSelectedItems] = useState<string[]>(["config", "skills", "memory"]);
  const [homeDir, setHomeDir] = useState<string>("");
  const [backupDir, setBackupDir] = useState<string>("");
  const [backupDirPosix, setBackupDirPosix] = useState<string>("");
  const [homeDirPosix, setHomeDirPosix] = useState<string>("");
  const [isWindows, setIsWindows] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { connected: agentConnected } = useAgentConnection();

  // Resolve home + backup dir on mount.
  useEffect(() => {
    void (async () => {
      const p = await systemAPI.getPlatform();
      setHomeDir(p.homeDir);
      setIsWindows(p.isWindows);
      const dir = p.isWindows ? `${p.homeDir}\\.ronbot-backups` : `${p.homeDir}/.ronbot-backups`;
      setBackupDir(dir);
      const homePosix = p.isWindows ? toPosixPath(p.homeDir) : p.homeDir;
      const dirPosix = `${homePosix}/.ronbot-backups`;
      setHomeDirPosix(homePosix);
      setBackupDirPosix(dirPosix);
      // Create dir via bash (works cross-platform, including WSL on Windows).
      await systemAPI.runCommand(wrapBash(`mkdir -p ${sh(dirPosix)}`, p.isWindows));
      void loadBackupsFor(dirPosix, p.isWindows);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadBackupsFor = useCallback(async (dirPosix: string, win: boolean) => {
    if (!dirPosix) return;
    setRefreshing(true);
    try {
      // List files: name, size in bytes, mtime epoch. Always run via bash.
      const script = `cd ${sh(dirPosix)} 2>/dev/null && ls -1 2>/dev/null | grep '\\.tar\\.gz$' | while read f; do stat -c "%n|%s|%Y" "$f" 2>/dev/null || stat -f "%N|%z|%m" "$f" 2>/dev/null; done`;
      const result = await systemAPI.runCommand(wrapBash(script, win));
      if (!result.stdout) {
        setBackups([]);
        return;
      }
      const parsed: Backup[] = result.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [filename, sizeStr, mtimeStr] = line.split("|");
          const id = filename.replace(/\.tar\.gz$/, "");
          const sizeBytes = parseInt(sizeStr, 10) || 0;
          const mtime = parseInt(mtimeStr, 10) || 0;
          return {
            id,
            name: id,
            fullPath: `${dirPosix}/${filename}`,
            sizeBytes,
            date: mtime ? formatDate(new Date(mtime * 1000)) : "—",
          };
        })
        .sort((a, b) => (b.id > a.id ? 1 : -1));
      setBackups(parsed);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const loadBackups = useCallback(async () => {
    await loadBackupsFor(backupDirPosix, isWindows);
  }, [loadBackupsFor, backupDirPosix, isWindows]);

  const toggleItem = (id: string) =>
    setSelectedItems((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));

  const createBackup = async () => {
    if (!agentConnected || !homeDirPosix || !backupDirPosix) return;
    if (selectedItems.length === 0) {
      toast.error("Pick at least one item to back up");
      return;
    }
    setCreating(true);
    setCreateProgress(10);

    const includes = ITEMS.filter((i) => selectedItems.includes(i.id))
      .map((i) => i.include)
      .join(" ");

    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const name = `ronbot-backup-${stamp}`;
    const archivePosix = `${backupDirPosix}/${name}.tar.gz`;

    setCreateProgress(40);
    const script = `cd ${sh(homeDirPosix)}/.hermes && tar --ignore-failed-read -czf ${sh(archivePosix)} ${includes} 2>&1 || true`;
    const result = await systemAPI.runCommand(wrapBash(script, isWindows));
    setCreateProgress(90);

    const verify = await systemAPI.runCommand(
      wrapBash(`[ -f ${sh(archivePosix)} ] && echo OK || echo MISS`, isWindows),
    );
    const exists = verify.stdout.includes("OK");
    setCreateProgress(100);
    setCreating(false);

    if (exists) {
      toast.success("Backup created", { description: `${name}.tar.gz` });
      void loadBackups();
    } else {
      toast.error("Backup failed", {
        description: (result.stderr || result.stdout).split("\n")[0] || "Could not create archive — check Diagnostics.",
      });
    }
    setCreateProgress(0);
  };

  const restoreBackup = async (backup: Backup) => {
    if (!homeDirPosix) return;
    setRestoring(backup.id);
    setConfirmRestore(null);
    const script = `mkdir -p ${sh(homeDirPosix)}/.hermes && tar -xzf ${sh(backup.fullPath)} -C ${sh(homeDirPosix)}/.hermes 2>&1`;
    const result = await systemAPI.runCommand(wrapBash(script, isWindows));
    setRestoring(null);
    if (result.success) {
      toast.success("Backup restored", {
        description: "Restart the agent for changes to take effect.",
      });
    } else {
      toast.error("Restore failed", { description: (result.stderr || result.stdout).split("\n")[0] || "Unknown error" });
    }
  };

  const deleteBackup = async (backup: Backup) => {
    setDeleting(backup.id);
    setConfirmDelete(null);
    const result = await systemAPI.runCommand(wrapBash(`rm -f ${sh(backup.fullPath)}`, isWindows));
    setDeleting(null);
    if (result.success) {
      toast.success("Backup deleted");
      void loadBackups();
    } else {
      toast.error("Delete failed", { description: (result.stderr || result.stdout).split("\n")[0] });
    }
  };

  const exportBackup = async (backup: Backup) => {
    // Reveal in OS file manager — works on Win/Mac/Linux.
    if (isWindows) {
      // backup.fullPath is /mnt/c/... — convert back to C:\... for explorer.
      const m = backup.fullPath.match(/^\/mnt\/([a-z])\/(.*)$/);
      const winPath = m
        ? `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, "\\")}`
        : backupDir;
      const arg = backup.id ? `/select,${winPath}` : winPath;
      await systemAPI.runCommand(`explorer.exe ${arg}`);
    } else if (navigator.platform.startsWith("Mac")) {
      await systemAPI.runCommand(wrapBash(`open -R ${sh(backup.fullPath || backupDirPosix)}`, false));
    } else {
      await systemAPI.runCommand(wrapBash(`xdg-open ${sh(backupDirPosix)}`, false));
    }
    toast.info("Opened backup folder", { description: backupDir });
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
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Archive className="w-6 h-6 text-primary" />
            Backup & Restore
          </h1>
          <p className="text-sm text-muted-foreground">
            Snapshots of <code className="text-xs">~/.hermes</code> stored in <code className="text-xs">{backupDir || "~/.ronbot-backups"}</code>
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => loadBackups()} disabled={refreshing}>
          <RefreshCw className={cn("w-4 h-4 mr-1", refreshing && "animate-spin")} /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GlassCard className="space-y-4 p-5">
          <h3 className="text-sm font-semibold text-foreground">Create Backup</h3>
          <div className="space-y-2">
            {ITEMS.map((item) => {
              const checked = selectedItems.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleItem(item.id)}
                  aria-pressed={checked}
                  className={cn(
                    "w-full text-left glass-subtle rounded-lg p-3 transition-all flex items-start gap-3",
                    checked
                      ? "border border-primary/30 bg-primary/5"
                      : "border border-transparent hover:bg-background/40"
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                      checked
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-muted-foreground/40 bg-transparent"
                    )}
                  >
                    {checked && <Check className="w-3 h-3" />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.desc}</p>
                  </div>
                </button>
              );
            })}
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

        <GlassCard className="space-y-4 p-5">
          <h3 className="text-sm font-semibold text-foreground">Import Backup</h3>
          <div className="border-2 border-dashed border-border rounded-xl p-8 text-center space-y-3">
            <Upload className="w-8 h-8 text-muted-foreground mx-auto" />
            <div>
              <p className="text-sm text-foreground">Drop a <code>.tar.gz</code> backup into</p>
              <code className="text-xs text-muted-foreground block mt-1 break-all">{backupDir}</code>
              <p className="text-xs text-muted-foreground/70 mt-2">then click Refresh — it'll appear below for restore.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportBackup({ id: "", name: "", date: "", sizeBytes: 0, fullPath: backupDir })}
            >
              Open backup folder
            </Button>
          </div>
        </GlassCard>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">
          Backup History {backups.length > 0 && <span className="text-muted-foreground font-normal">({backups.length})</span>}
        </h3>
        {backups.length === 0 ? (
          <GlassCard variant="subtle" className="text-center py-8">
            <p className="text-sm text-muted-foreground/60">No backups yet — create your first one above.</p>
          </GlassCard>
        ) : (
          backups.map((backup) => (
            <GlassCard key={backup.id} variant="subtle" className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3 min-w-0">
                <FolderArchive className="w-5 h-5 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{backup.name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" /> {backup.date}
                    <span>•</span>
                    <span>{formatBytes(backup.sizeBytes)}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => exportBackup(backup)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Download className="w-4 h-4 mr-1" /> Reveal
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmRestore(backup)}
                  disabled={!!restoring}
                  className="text-primary hover:text-primary"
                >
                  {restoring === backup.id ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 mr-1" />
                  )}
                  Restore
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setConfirmDelete(backup)}
                  disabled={deleting === backup.id}
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                >
                  {deleting === backup.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </GlassCard>
          ))
        )}
      </div>

      <AlertDialog open={!!confirmRestore} onOpenChange={(o) => !o && setConfirmRestore(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              Files inside the archive will overwrite their counterparts in <code>~/.hermes</code>.
              Other files (not in the backup) are kept. Restart the agent afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmRestore && restoreBackup(confirmRestore)}>
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              The archive file will be permanently removed. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && deleteBackup(confirmDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default BackupRestore;
