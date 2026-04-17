import { useEffect, useState } from "react";
import { ChevronDown, HardDrive, MemoryStick, FolderOpen, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { systemAPI } from "@/lib/systemAPI";
import { cn } from "@/lib/utils";

// Thresholds (bytes)
const GB = 1024 ** 3;
const DISK_RECOMMENDED = 4 * GB;   // green ≥ 4 GB
const DISK_HARD_MIN    = 1.5 * GB; // red < 1.5 GB
const RAM_RECOMMENDED  = 8 * GB;
const RAM_HARD_MIN     = 4 * GB;

type Status = "green" | "yellow" | "red" | "loading";

const fmtGB = (bytes: number) =>
  bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : `${(bytes / (1024 ** 2)).toFixed(0)} MB`;

interface Props {
  /** Called whenever the install-readiness changes. true = OK to install. */
  onReadyChange: (ready: boolean) => void;
}

export default function InstallPreflight({ onReadyChange }: Props) {
  const [diskFree, setDiskFree] = useState<number | null>(null);
  const [diskTotal, setDiskTotal] = useState<number | null>(null);
  const [drive, setDrive] = useState<string>("");
  const [ramFree, setRamFree] = useState<number | null>(null);
  const [ramTotal, setRamTotal] = useState<number | null>(null);
  const [homeDir, setHomeDir] = useState<string>("");
  const [isWindows, setIsWindows] = useState(false);
  const [locationsOpen, setLocationsOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const [platform, disk] = await Promise.all([
        systemAPI.getPlatform(),
        systemAPI.getDiskSpace(),
      ]);
      setRamFree(platform.freeMemory);
      setRamTotal(platform.totalMemory);
      setHomeDir(platform.homeDir);
      setIsWindows(platform.isWindows);
      if (disk.success) {
        setDiskFree(disk.freeBytes ?? 0);
        setDiskTotal(disk.totalBytes ?? 0);
        setDrive(disk.drive ?? "");
      }
    })();
  }, []);

  const diskStatus: Status =
    diskFree === null ? "loading" :
    diskFree >= DISK_RECOMMENDED ? "green" :
    diskFree >= DISK_HARD_MIN ? "yellow" : "red";

  const ramStatus: Status =
    ramTotal === null ? "loading" :
    ramTotal >= RAM_RECOMMENDED ? "green" :
    ramTotal >= RAM_HARD_MIN ? "yellow" : "red";

  const ready = diskStatus !== "red" && ramStatus !== "red" && diskStatus !== "loading" && ramStatus !== "loading";

  useEffect(() => {
    onReadyChange(ready);
  }, [ready, onReadyChange]);

  return (
    <div className="space-y-3">
      {/* System Resources */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground/80 uppercase tracking-wider">System Resources</p>

        <ResourceRow
          icon={<HardDrive className="w-4 h-4" />}
          label={`Disk space ${drive ? `(${drive})` : ""}`}
          status={diskStatus}
          detail={
            diskFree !== null && diskTotal !== null
              ? `${fmtGB(diskFree)} free of ${fmtGB(diskTotal)}`
              : "Checking..."
          }
          message={
            diskStatus === "red"
              ? `Need at least ${fmtGB(DISK_HARD_MIN)} free — installation blocked.`
              : diskStatus === "yellow"
              ? `Below recommended ${fmtGB(DISK_RECOMMENDED)} — install may run tight.`
              : undefined
          }
        />

        <ResourceRow
          icon={<MemoryStick className="w-4 h-4" />}
          label="System RAM"
          status={ramStatus}
          detail={
            ramTotal !== null
              ? `${fmtGB(ramTotal)} total${ramFree !== null ? ` · ${fmtGB(ramFree)} free` : ""}`
              : "Checking..."
          }
          message={
            ramStatus === "red"
              ? `Need at least ${fmtGB(RAM_HARD_MIN)} total RAM — installation blocked.`
              : ramStatus === "yellow"
              ? `Below recommended ${fmtGB(RAM_RECOMMENDED)} — agent may run slowly.`
              : undefined
          }
        />
      </div>

      {/* Install Locations (collapsible) */}
      <div className="rounded-lg border border-white/10">
        <button
          onClick={() => setLocationsOpen((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-white/5 transition-colors rounded-lg"
        >
          <span className="flex items-center gap-2 text-xs font-medium text-foreground/80">
            <FolderOpen className="w-3.5 h-3.5" />
            Where things will be installed
          </span>
          <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", locationsOpen && "rotate-180")} />
        </button>

        {locationsOpen && (
          <div className="px-3 pb-3 pt-1 space-y-2 text-xs">
            {isWindows ? (
              <>
                <LocationRow
                  name="WSL2 + Ubuntu"
                  path="C:\Users\<you>\AppData\Local\Packages\CanonicalGroupLimited...\LocalState\ext4.vhdx"
                  note="Managed by Windows. Virtual disk grows as needed."
                />
                <LocationRow
                  name="Python 3.11"
                  path={`${homeDir}\\AppData\\Local\\Programs\\Python\\Python311\\`}
                  note="Installed by winget. Includes pip."
                />
                <LocationRow
                  name="Agent + config + venv"
                  path="\\wsl$\Ubuntu\home\<wsl-user>\.hermes\"
                  note="Lives inside WSL Ubuntu. Accessible from Windows via the path above."
                />
              </>
            ) : (
              <>
                <LocationRow
                  name="Python 3.11"
                  path="/usr/bin/python3 (system)"
                  note="Managed by your OS package manager."
                />
                <LocationRow
                  name="Agent + config + venv"
                  path={`${homeDir}/.hermes/`}
                  note="All agent files, the Python virtualenv, config.yaml, and .env live here."
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ResourceRow({
  icon,
  label,
  status,
  detail,
  message,
}: {
  icon: React.ReactNode;
  label: string;
  status: Status;
  detail: string;
  message?: string;
}) {
  const tone =
    status === "green" ? "text-success" :
    status === "yellow" ? "text-warning" :
    status === "red" ? "text-destructive" :
    "text-muted-foreground";

  const Icon =
    status === "green" ? CheckCircle2 :
    status === "yellow" ? AlertTriangle :
    status === "red" ? XCircle :
    null;

  return (
    <div className="glass-subtle rounded-lg px-3 py-2 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-foreground/80">
          <span className={tone}>{icon}</span>
          <span className="text-xs font-medium">{label}</span>
        </div>
        <div className={cn("flex items-center gap-1.5 text-xs", tone)}>
          {Icon && <Icon className="w-3.5 h-3.5" />}
          <span className="font-mono">{detail}</span>
        </div>
      </div>
      {message && <p className={cn("text-[11px] pl-6", tone)}>{message}</p>}
    </div>
  );
}

function LocationRow({ name, path, note }: { name: string; path: string; note: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-foreground/90 font-medium">{name}</p>
      <p className="font-mono text-[11px] text-muted-foreground break-all">{path}</p>
      <p className="text-[11px] text-muted-foreground/80">{note}</p>
    </div>
  );
}
