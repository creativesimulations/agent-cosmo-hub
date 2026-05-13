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
import { LazyChatMessageMarkdown } from "@/components/chat/LazyChatMessageMarkdown";

function isDirectImagePayload(payload: string): boolean {
  const p = payload.trim();
  return p.startsWith("data:image/") || /^https?:\/\//i.test(p);
}

const MarkerModalHost = () => {
  const { setDraft } = useChat();
  const [queue, setQueue] = useState<HermesMarker[]>([]);
  const active = queue[0];
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [pw, setPw] = useState("");

  useEffect(() => {
    return subscribeHermesMarkers((incoming) => {
      setQueue((q) => [...q, ...incoming]);
    });
  }, []);

  const advance = useCallback(() => {
    setQueue((q) => q.slice(1));
    setPw("");
    setQrSrc(null);
  }, []);

  useEffect(() => {
    if (!active || active.kind !== "qr") {
      setQrSrc(null);
      return;
    }
    const payload = active.payload.trim();
    if (isDirectImagePayload(payload)) {
      setQrSrc(payload.startsWith("data:") ? payload : payload);
      return;
    }
    let cancelled = false;
    void import("qrcode")
      .then((QR) => QR.default.toDataURL(payload, { margin: 1, width: 220 }))
      .then((url) => {
        if (!cancelled) setQrSrc(url);
      })
      .catch(() => {
        if (!cancelled) setQrSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  const onPasswordSubmit = () => {
    if (!active || active.kind !== "password") return;
    const purpose = active.purpose;
    const line = `User-provided secret for "${purpose}": ${pw}`;
    setDraft((prev) => (prev ? `${prev}\n\n` : "") + line);
    advance();
  };

  return (
    <>
      <Dialog open={active?.kind === "qr"} onOpenChange={(o) => !o && advance()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Scan QR code</DialogTitle>
            <DialogDescription>
              The agent asked to display a QR code. Scan it with your phone to continue pairing.
            </DialogDescription>
          </DialogHeader>
          {active?.kind === "qr" && (
            <div className="flex flex-col items-center gap-3 py-2">
              {qrSrc ? (
                <div className="bg-white p-3 rounded-lg">
                  <img src={qrSrc} alt="QR code from agent" className="w-52 h-52 object-contain" />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Generating QR…</p>
              )}
              {!isDirectImagePayload(active.payload) && (
                <p className="text-[10px] text-muted-foreground font-mono break-all max-h-20 overflow-y-auto">
                  {active.payload}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={advance}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={active?.kind === "password"} onOpenChange={(o) => !o && advance()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Secret requested</DialogTitle>
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

      <Dialog open={active?.kind === "braid"} onOpenChange={(o) => !o && advance()}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Braid graph</DialogTitle>
            <DialogDescription>Visualization from the agent (Mermaid).</DialogDescription>
          </DialogHeader>
          {active?.kind === "braid" && (
            <div className="py-2">
              {active.mermaid?.trim() ? (
                <LazyChatMessageMarkdown content={`\`\`\`mermaid\n${active.mermaid.trim()}\n\`\`\``} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  No Mermaid body was attached to this marker. Ask the agent to include a fenced{" "}
                  <code className="font-mono text-xs">mermaid</code> block after{" "}
                  <code className="font-mono text-xs">[SHOW_BRAID_GRAPH]</code>.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" onClick={advance}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default MarkerModalHost;
