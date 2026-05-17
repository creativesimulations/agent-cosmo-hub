// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { useState } from "react";
import { FolderOpen, GitBranch, Loader2 } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SetupPathPickerDialog } from "@/components/setup/SetupPathPickerDialog";
import { systemAPI } from "@/lib/systemAPI";
import { invalidateSkillCaches, skillSetupPrompt, type ListedSkill } from "@/features/skills/skillModel";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstalled: () => void;
  onAskAgentInstall?: () => void;
  onSetupInChat?: (prompt: string) => void;
};

export function InstallSkillDialog({
  open,
  onOpenChange,
  onInstalled,
  onAskAgentInstall,
  onSetupInChat,
}: Props) {
  const [gitUrl, setGitUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [pathPickerOpen, setPathPickerOpen] = useState(false);

  const finishInstall = (skillName: string | undefined, requiredSecrets?: string[]) => {
    invalidateSkillCaches();
    onInstalled();
    onOpenChange(false);
    setGitUrl("");
    toast.success(skillName ? `Installed ${skillName}` : "Skill installed");
    if (onSetupInChat && skillName) {
      const skill: ListedSkill = {
        name: skillName,
        category: "other",
        source: "user",
        requiredSecrets,
      };
      onSetupInChat(skillSetupPrompt(skill));
    }
  };

  const installFromPath = async (srcPath: string) => {
    setBusy(true);
    try {
      const r = await systemAPI.installSkillFromPath(srcPath);
      if (!r.success) {
        toast.error("Install failed", { description: r.error });
        return;
      }
      if (r.hasManifest === false) {
        toast.warning("Installed, but no manifest found", {
          description: "The folder may not be a valid Hermes skill.",
        });
      }
      finishInstall(r.skillName, r.requiredSecrets);
    } finally {
      setBusy(false);
    }
  };

  const pickFolder = async () => {
    const res = await systemAPI.selectFolder({ title: "Select skill folder" });
    if (!res.success || res.canceled || !res.path) return;
    await installFromPath(res.path);
  };

  const installFromGit = async () => {
    const url = gitUrl.trim();
    if (!url) return;
    setBusy(true);
    try {
      const r = await systemAPI.installSkillFromGit(url);
      if (!r.success) {
        toast.error("Clone failed", { description: r.error });
        return;
      }
      finishInstall(r.skillName, r.requiredSecrets);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Install skill</DialogTitle>
            <DialogDescription>
              Copy a local folder or clone a Git repository into ~/.hermes/skills/.
            </DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="local">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="local">Local folder</TabsTrigger>
              <TabsTrigger value="git">Git URL</TabsTrigger>
            </TabsList>
            <TabsContent value="local" className="space-y-3 pt-2">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={busy}
                onClick={() => void pickFolder()}
              >
                {busy ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <FolderOpen className="w-4 h-4 mr-2" />
                )}
                Choose folder…
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                disabled={busy}
                onClick={() => setPathPickerOpen(true)}
              >
                Enter path manually (browser dev)
              </Button>
            </TabsContent>
            <TabsContent value="git" className="space-y-3 pt-2">
              <Input
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
                placeholder="https://github.com/org/my-skill.git"
                className="font-mono text-sm"
                disabled={busy}
              />
              <Button
                type="button"
                className="w-full gradient-primary text-primary-foreground"
                disabled={busy || !gitUrl.trim()}
                onClick={() => void installFromGit()}
              >
                {busy ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <GitBranch className="w-4 h-4 mr-2" />
                )}
                Clone and install
              </Button>
            </TabsContent>
          </Tabs>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            {onAskAgentInstall && (
              <Button type="button" variant="ghost" size="sm" onClick={onAskAgentInstall}>
                Ask agent to install
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SetupPathPickerDialog
        open={pathPickerOpen}
        title="Skill folder path"
        onCancel={() => setPathPickerOpen(false)}
        onSubmit={(path) => {
          setPathPickerOpen(false);
          void installFromPath(path);
        }}
      />
    </>
  );
}
