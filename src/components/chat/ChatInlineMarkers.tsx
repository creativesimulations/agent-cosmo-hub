import { useEffect, useState } from "react";
import { QrCode } from "lucide-react";
import type { HermesMarker } from "@/lib/chat/hermesMarkers";
import { LazyChatMessageMarkdown } from "@/components/chat/LazyChatMessageMarkdown";

function isDirectImagePayload(payload: string): boolean {
  const p = payload.trim();
  return p.startsWith("data:image/") || /^https?:\/\//i.test(p);
}

const EncodedQrImage = ({ payload }: { payload: string }) => {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    const p = payload.trim();
    if (isDirectImagePayload(p)) {
      setSrc(p.startsWith("data:") ? p : p);
      return undefined;
    }
    let cancelled = false;
    void import("qrcode")
      .then((QR) => QR.default.toDataURL(p, { margin: 1, width: 220 }))
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [payload]);

  if (!src) {
    return <p className="text-xs text-muted-foreground">Generating QR…</p>;
  }

  return (
    <div className="bg-white p-3 rounded-lg">
      <img src={src} alt="QR code from agent" className="w-48 h-48 object-contain" />
    </div>
  );
};

interface Props {
  markers: HermesMarker[];
}

/** Renders agent-driven QR / braid visuals inside the chat thread (non-modal). */
const ChatInlineMarkers = ({ markers }: Props) => {
  if (!markers.length) return null;

  return (
    <div className="mt-2 space-y-2">
      {markers.map((marker, index) => {
        if (marker.kind === "qr") {
          return (
            <div
              key={`qr-${index}`}
              className="rounded-lg border border-primary/20 bg-primary/5 p-3"
            >
              <div className="flex items-center gap-2 text-xs font-medium text-foreground mb-2">
                <QrCode className="w-3.5 h-3.5 text-primary" />
                Scan QR code
              </div>
              <div className="flex flex-col items-center gap-2">
                {marker.display === "terminal" ? (
                  <pre className="max-w-full overflow-auto rounded-lg bg-white p-3 font-mono text-[9px] leading-none text-black">
                    {marker.payload}
                  </pre>
                ) : (
                  <EncodedQrImage payload={marker.payload} />
                )}
              </div>
            </div>
          );
        }

        if (marker.kind === "braid" && marker.mermaid?.trim()) {
          return (
            <div
              key={`braid-${index}`}
              className="rounded-lg border border-white/10 bg-background/40 p-3"
            >
              <LazyChatMessageMarkdown content={`\`\`\`mermaid\n${marker.mermaid.trim()}\n\`\`\``} />
            </div>
          );
        }

        return null;
      })}
    </div>
  );
};

export default ChatInlineMarkers;
