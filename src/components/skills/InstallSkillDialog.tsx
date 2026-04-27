import { useState } from "react";
import { FolderPlus, GitBranch, Loader2, Wrench, Puzzle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { systemAPI } from "@/lib/systemAPI";
import { toast } from "sonner";
import ActionableError from "@/components/ui/ActionableError";

type Kind = "skill" | "tool";

interface InstallSkillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What we're installing — drives titles + which API is called. */
  kind?: Kind;
  /** Called after a successful install so the parent can refresh its list. */
  onInstalled?: (result: { name: string; missingSecrets: string[] }) => void;
}

/**
 * Lets the user drop in a Hermes-compatible skill or tool from a local
 * folder or a Git URL. After install we surface validation results
 * (manifest found? required secrets?) and offer to open the secrets page
 * for any missing keys.
 */
const InstallSkillDialog = ({
  open,
  onOpenChange,
  kind = "skill",
  onInstalled,
}: InstallSkillDialogProps) => {
  const [busy, setBusy] = useState(false);
  const [gitUrl, setGitUrl] = useState("");
  const [actionError, setActionError] = useState("");

  const noun = kind === "skill" ? "Skill" : "Tool";
  const Icon = kind === "skill" ? Puzzle : Wrench;

  const handleResult = (
    r: { success: boolean; name?: string; missingSecrets?: string[]; error?: string },
  ) => {
    if (!r.success) {
      setActionError(r.error || `Couldn't install ${noun.toLowerCase()}.`);
      toast.error(`Couldn't install ${noun.toLowerCase()}`, {
        description: r.error || "Unknown error",
      });
      return false;
    }
    const name = r.name || "(unnamed)";
    const missing = r.missingSecrets ?? [];
    toast.success(`${noun} "${name}" installed`, {
      description:
        missing.length > 0
          ? `Needs ${missing.length} secret${missing.length === 1 ? "" : "s"} before it can run.`
          : "Will load on the next agent restart.",
    });
    onInstalled?.({ name, missingSecrets: missing });
    setActionError("");
    onOpenChange(false);
    return true;
  };

  const pickFolder = async () => {
    setBusy(true);
    try {
      const picked = await systemAPI.selectFolder({
        title: `Choose a ${noun.toLowerCase()} folder`,
      });
      if (!picked.success) {
        setActionError(picked.error || "Folder picker failed.");
        toast.error("Folder picker failed", { description: picked.error || "Unknown error" });
        return;
      }
      if (picked.canceled || !picked.path) return;
      const r =
        kind === "skill"
          ? await systemAPI.installSkillFromPath(picked.path)
          : await systemAPI.installToolFromPath(picked.path);
      handleResult(r);
    } finally {
      setBusy(false);
    }
  };

  const cloneFromGit = async () => {
    const url = gitUrl.trim();
    if (!url) {
      setActionError("Enter a Git URL first.");
      toast.error("Enter a Git URL first");
      return;
    }
    setBusy(true);
    try {
      // Tools-from-git aren't broadly supported by the agent yet — fall back
      // to skill install (the underlying handler validates manifest either way).
      const r = await systemAPI.installSkillFromGit(url);
      handleResult(r);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="w-5 h-5 text-primary" /> Install a {noun.toLowerCase()}
          </DialogTitle>
          <DialogDescription>
            Drop in any Hermes-compatible {noun.toLowerCase()}. We'll validate the manifest, copy
            it into <code className="text-xs">~/.hermes/{kind === "skill" ? "skills" : "tools"}/</code>,
            and enable it for the next agent restart.
          </DialogDescription>
        </DialogHeader>

        {actionError && (
          <ActionableError
            title={`Couldn't install ${noun.toLowerCase()}`}
            summary={actionError}
            details={actionError}
            onFix={() => setActionError("")}
            fixLabel="Dismiss"
          />
        )}

        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <Label className="text-sm font-medium">From a local folder</Label>
            <p className="text-xs text-muted-foreground">
              The folder must contain a <code>manifest.yaml</code> (or <code>skill.yaml</code>).
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={pickFolder}
              disabled={busy}
              className="w-full"
            >
              {busy ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <FolderPlus className="w-4 h-4 mr-2" />
              )}
              Choose folder…
            </Button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border/60" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-background px-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                or
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="skill-git-url" className="text-sm font-medium">
              From a Git URL
            </Label>
            <p className="text-xs text-muted-foreground">
              We'll <code>git clone</code> it into{" "}
              <code className="text-xs">~/.hermes/{kind === "skill" ? "skills" : "tools"}/</code>.
            </p>
            <div className="flex gap-2">
              <Input
                id="skill-git-url"
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
                placeholder="https://github.com/you/my-skill.git"
                className="bg-background/50"
                disabled={busy}
              />
              <Button onClick={cloneFromGit} disabled={busy || !gitUrl.trim()}>
                {busy ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <GitBranch className="w-4 h-4 mr-2" />
                )}
                Clone
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default InstallSkillDialog;
