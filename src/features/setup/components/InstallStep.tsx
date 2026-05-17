import { Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import InstallPreflight from "@/components/setup/InstallPreflight";
import { StreamingLogPanel } from "@/components/setup/StreamingLogPanel";
import type { InstallSource } from "@/features/setup/types";

type Props = {
  source: InstallSource;
  localPath: string;
  replacePersona: boolean;
  onReplacePersonaChange: (v: boolean) => void;
  installing: boolean;
  progress: number;
  logLines: string[];
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
      {logLines.length > 0 && <StreamingLogPanel lines={logLines} variant="install" />}
      <Button
        className="w-full gradient-primary text-primary-foreground"
        disabled={!preflightReady}
        onClick={onInstall}
      >
        Install agent
      </Button>
    </div>
  );
}
