// Hermes v0.13.0 sync — May 2026 (Ronbot)

export type HermesMarker =
  | { kind: "qr"; payload: string; display?: "image" | "terminal" | "payload" }
  | { kind: "password"; purpose: string }
  | { kind: "braid"; mermaid?: string };

type MarkerListener = (markers: HermesMarker[]) => void;

const listeners = new Set<MarkerListener>();

export function subscribeHermesMarkers(fn: MarkerListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(markers: HermesMarker[]) {
  if (!markers.length) return;
  for (const fn of listeners) fn(markers);
}

/**
 * Remove Ronbot marker lines from assistant-visible text and collect modal
 * payloads. Run after `splitIntentsFromText` so markers inside intent fences
 * stay untouched (intents are stripped earlier).
 */
export function stripHermesMarkers(source: string): { text: string; markers: HermesMarker[] } {
  const markers: HermesMarker[] = [];
  let text = source;

  const pushQr = (payload: string, display?: "terminal" | "payload") => {
    const p = payload.trim();
    if (p) markers.push({ kind: "qr", payload: p, display });
  };
  const pushPw = (purpose: string) => {
    markers.push({ kind: "password", purpose: purpose.trim() || "credential" });
  };
  const pushBraid = (diagram?: string) => {
    const d = diagram?.trim();
    markers.push({ kind: "braid", mermaid: d || undefined });
  };

  text = text.replace(
    /\[SHOW_QR\]\s*\r?\n```(?:text|terminal|ansi)?\r?\n([\s\S]*?)```\s*/gi,
    (_full, payload: string) => {
      pushQr(payload, "terminal");
      return "";
    },
  );

  text = text.replace(/\[SHOW_QR\]\s*([^\r\n]+)/gi, (_, payload: string) => {
    pushQr(payload, "payload");
    return "";
  });

  text = text.replace(/\[REQUEST_PASSWORD\]\s*([^\r\n]*)/gi, (_, purpose: string) => {
    pushPw(purpose);
    return "";
  });

  text = text.replace(
    /\[SHOW_BRAID_GRAPH\](?:\r?\n```mermaid\r?\n([\s\S]*?)```)?\s*/gi,
    (_full, diagram?: string) => {
      pushBraid(diagram);
      return "";
    },
  );

  const cleaned = text.replace(/\n{3,}/g, "\n\n").trimEnd();
  return { text: cleaned, markers };
}

export function publishHermesMarkers(markers: HermesMarker[]) {
  emit(markers);
}
