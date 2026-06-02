import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Copy, Download, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import InstallPreflight from "@/components/setup/InstallPreflight";
import { StreamingLogPanel } from "@/components/setup/StreamingLogPanel";
import { installPrereqItem } from "@/features/setup/prereqScan";
import type { InstallSource } from "@/features/setup/types";
import type { InstallFailure } from "@/features/setup/installErrors";
import { downloadTextFile, timestampedFilename } from "@/lib/diagnosticsExport";

type Props = {
  source: InstallSource;
  localPath: string;
  replacePersona: boolean;
  onReplacePersonaChange: (v: boolean) => void;
  installing: boolean;
  installCancelling: boolean;
  progress: number;
  logLines: string[];
  failure: InstallFailure | null;
  preflightReady: boolean;
  onPreflightReady: (ready: boolean) => void;
  onRequestSudo: (reason: string) => Promise<string | null>;
  onInstall: () => void;
  onCancel: () => void;
};

export function InstallStep({
  source,
  localPath,
  replacePersona,
  onReplacePersonaChange,
  installing,
  installCancelling,
  progress,
  logLines,
  failure,
  preflightReady,
  onPreflightReady,
  onRequestSudo,
  onInstall,
  onCancel,
}: Props) {
  const [autoFixing, setAutoFixing] = useState(false);
  const [autoFixMessage, setAutoFixMessage] = useState<string | null>(null);
  const logScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = logScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logLines]);

  const runAutoFix = async (id: string) => {
    setAutoFixing(true);
    setAutoFixMessage(null);
    try {
      const result = await installPrereqItem(id, onRequestSudo);
      const installed = result.status === "installed";
      setAutoFixMessage(result.description ?? (installed ? "Fix applied. Continuing installation..." : "Fix finished."));
      if (installed) {
        setAutoFixing(false);
        onInstall();
        return;
      }
    } catch (e) {
      setAutoFixMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setAutoFixing(false);
    }
  };

  if (installing) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Installing Hermes</p>
            <p className="text-xs text-muted-foreground">Live installer output stays visible while buttons are disabled.</p>
          </div>
          <Button variant="ghost" size="sm" className="text-destructive" onClick={onCancel} disabled={installCancelling}>
            {installCancelling ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <XCircle className="w-4 h-4 mr-1" />}
            {installCancelling ? "Cancelling..." : "Cancel installation"}
          </Button>
        </div>
        <Progress value={progress} className="h-2" />
        <StreamingLogPanel
          lines={logLines.length > 0 ? logLines : ["Waiting for installer output..."]}
          variant="install"
          scrollRef={logScrollRef}
          className="max-h-72 rounded-lg border border-white/10 bg-background/40 p-3"
        />
        {logLines.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => downloadTextFile(logLines.join("\n"), timestampedFilename("ronbot-install-log"))}
          >
            <Download className="w-4 h-4 mr-1" />
            Export install log
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {source === "bundled"
          ? "Official Hermes installer from Nous Research. Configure API keys and setup after install."
          : `Local install from: ${localPath}`}
      </p>
      <label className="glass-subtle rounded-lg border border-white/10 p-3 flex items-start gap-2 text-sm cursor-pointer">
        <Checkbox checked={replacePersona} onCheckedChange={(v) => onReplacePersonaChange(v === true)} />
        <span className="space-y-1">
          <span className="block font-medium">Apply Ronbot personality and app guidance after install</span>
          <span className="block text-xs text-muted-foreground">
            {source === "bundled"
              ? "Leave unchecked to keep Hermes exactly as the official installer creates it."
              : "Leave unchecked to keep the selected Hermes folder's existing core files unchanged."}
          </span>
        </span>
      </label>
      <InstallPreflight onReadyChange={onPreflightReady} />
      {failure && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 space-y-2 text-sm">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-4 h-4" />
            <p className="font-medium">{failure.title}</p>
          </div>
          <p className="text-muted-foreground">{failure.message}</p>
          {failure.hint && <p className="text-xs text-muted-foreground">{failure.hint}</p>}
          {autoFixMessage && <p className="text-xs text-muted-foreground">{autoFixMessage}</p>}
          {failure.autoInstallId && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void runAutoFix(failure.autoInstallId ?? "")}
              disabled={autoFixing}
            >
              {autoFixing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Download className="w-3 h-3 mr-1" />}
              Try to fix automatically
            </Button>
          )}
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
