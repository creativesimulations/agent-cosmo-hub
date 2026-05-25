import { AlertTriangle, Copy, Download, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import InstallPreflight from "@/components/setup/InstallPreflight";
import { StreamingLogPanel } from "@/components/setup/StreamingLogPanel";
import type { InstallSource } from "@/features/setup/types";
import type { InstallFailure } from "@/features/setup/installErrors";
import { downloadTextFile, timestampedFilename } from "@/lib/diagnosticsExport";

type Props = {
  source: InstallSource;
  localPath: string;
  replacePersona: boolean;
  onReplacePersonaChange: (v: boolean) => void;
  installing: boolean;
  progress: number;
  logLines: string[];
  failure: InstallFailure | null;
  preflightReady: boolean;
  onPreflightReady: (ready: boolean) => void;
  onInstall: () => void;
  onCancel: () => void;
};

export function InstallStep({
  source,
  localPath,
  replacePersona,
  onReplacePersonaChange,
  installing,
  progress,
  logLines,
  failure,
  preflightReady,
  onPreflightReady,
  onInstall,
  onCancel,
}: Props) {
  if (installing) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" className="text-destructive" onClick={onCancel}>
          <XCircle className="w-4 h-4 mr-1" /> Cancel installation
        </Button>
        <Progress value={progress} className="h-2" />
        <StreamingLogPanel lines={logLines} variant="install" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {source === "bundled"
          ? "Official Hermes installer (curl | bash from Nous Research)."
          : `Local install from: ${localPath}`}
      </p>
      {source === "local" && (
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <Checkbox checked={replacePersona} onCheckedChange={(v) => onReplacePersonaChange(v === true)} />
          <span>Replace SOUL, PERSONALITY, and memory files with Ronbot defaults</span>
        </label>
      )}
      <InstallPreflight onReadyChange={onPreflightReady} />
      {failure && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 space-y-2 text-sm">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-4 h-4" />
            <p className="font-medium">{failure.title}</p>
          </div>
          <p className="text-muted-foreground">{failure.message}</p>
          {failure.hint && <p className="text-xs text-muted-foreground">{failure.hint}</p>}
          {failure.manualCommand && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void navigator.clipboard.writeText(failure.manualCommand ?? "")}
            >
              <Copy className="w-3 h-3 mr-1" />
              Copy manual command
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (typeof window !== "undefined") window.location.hash = "#/diagnostics";
            }}
          >
            Open diagnostics
          </Button>
        </div>
      )}
      {logLines.length > 0 && <StreamingLogPanel lines={logLines} variant="install" />}
      {logLines.length > 0 && (
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => downloadTextFile(logLines.join("\n"), timestampedFilename("ronbot-install-log"))}
          >
            <Download className="w-4 h-4 mr-1" />
            Export install log
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              downloadTextFile(
                JSON.stringify(
                  {
                    generatedAt: new Date().toISOString(),
                    failure,
                    recentLog: logLines.slice(-200),
                  },
                  null,
                  2,
                ),
                timestampedFilename("ronbot-setup-support-bundle"),
              )
            }
          >
            <Download className="w-4 h-4 mr-1" />
            Export support bundle
          </Button>
        </div>
      )}
      <Button
        className="w-full gradient-primary text-primary-foreground"
        disabled={!preflightReady}
        onClick={onInstall}
      >
        {failure ? "Retry install" : "Install agent"}
      </Button>
    </div>
  );
}
