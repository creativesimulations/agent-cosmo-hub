// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { useCallback, useEffect, useState } from "react";
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
import { subscribeHermesMarkers, type HermesMarker } from "@/lib/chat/hermesMarkers";
import { useChat } from "@/contexts/ChatContext";

/** Credential marker only — QR and braid render inline in the chat thread. */
const MarkerModalHost = () => {
  const { setDraft } = useChat();
  const [queue, setQueue] = useState<HermesMarker[]>([]);
  const active = queue[0];
  const [pw, setPw] = useState("");

  useEffect(() => {
    return subscribeHermesMarkers((incoming) => {
      const modalOnly = incoming.filter((m) => m.kind === "password");
      if (!modalOnly.length) return;
      setQueue((q) => [...q, ...modalOnly]);
    });
  }, []);

  const advance = useCallback(() => {
    setQueue((q) => q.slice(1));
    setPw("");
  }, []);

  const onPasswordSubmit = () => {
    if (!active || active.kind !== "password") return;
    const purpose = active.purpose;
    const line = `User-provided secret for "${purpose}": ${pw}`;
    setDraft((prev) => (prev ? `${prev}\n\n` : "") + line);
    advance();
  };

  return (
    <Dialog open={active?.kind === "password"} onOpenChange={(o) => !o && advance()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Credential requested</DialogTitle>
          <DialogDescription>
            {active?.kind === "password"
              ? `The agent needs: ${active.purpose}. Enter a value — it will be inserted into your chat draft (not logged by Ronbot).`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-1">
          <Label htmlFor="ronbot-marker-pw">Value</Label>
          <Input
            id="ronbot-marker-pw"
            type="password"
            autoComplete="off"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onPasswordSubmit();
            }}
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={advance}>
            Cancel
          </Button>
          <Button type="button" onClick={onPasswordSubmit} disabled={!pw.trim()}>
            Insert into draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MarkerModalHost;
