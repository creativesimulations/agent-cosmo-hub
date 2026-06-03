import type { HermesMarker } from "./hermesMarkers";

const markerKey = (m: HermesMarker): string => {
  if (m.kind === "qr") return `qr:${m.display ?? "auto"}:${m.payload}`;
  if (m.kind === "password") return `pw:${m.purpose}`;
  return `braid:${m.mermaid ?? ""}`;
};

export function mergeHermesMarkers(
  existing: HermesMarker[] | undefined,
  incoming: HermesMarker[],
): HermesMarker[] {
  if (!incoming.length) return existing ?? [];
  const out = [...(existing ?? [])];
  const seen = new Set(out.map(markerKey));
  for (const marker of incoming) {
    const key = markerKey(marker);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(marker);
  }
  return out;
}
