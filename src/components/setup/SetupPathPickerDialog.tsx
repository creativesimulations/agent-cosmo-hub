// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { useState } from "react";
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

type Props = {
  open: boolean;
  title: string;
  onCancel: () => void;
  onSubmit: (path: string) => void;
};

/** Browser dev fallback when native folder picker is unavailable. */
export function SetupPathPickerDialog({ open, title, onCancel, onSubmit }: Props) {
  const [path, setPath] = useState("~");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Ronbot desktop app uses a native folder picker. In browser dev mode, enter an absolute path to your
            agent source folder.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/home/you/projects/hermes-agent"
          className="font-mono text-sm"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit(path.trim())} disabled={!path.trim()}>
            Use path
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
