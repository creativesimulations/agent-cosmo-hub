// Hermes v0.13.0 sync — May 2026 (Ronbot)

export type HermesMarker =
  | { kind: "qr"; payload: string; display?: "image" | "terminal" | "payload" }
  | { kind: "password"; purpose: string }
  | { kind: "braid"; mermaid?: string };

type MarkerListener = (markers: HermesMarker[]) => void;
type DashboardListener = () => void;

const listeners = new Set<MarkerListener>();
const dashboardListeners = new Set<DashboardListener>();

export function subscribeHermesMarkers(fn: MarkerListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function subscribeDashboardRefresh(fn: DashboardListener): () => void {
  dashboardListeners.add(fn);
  return () => {
    dashboardListeners.delete(fn);
  };
}

function emit(markers: HermesMarker[]) {
  if (!markers.length) return;
  for (const fn of listeners) fn(markers);
}

export function publishDashboardRefresh() {
  for (const fn of dashboardListeners) fn();
}

const stripAnsi = (s: string) =>
  s
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, "")
    .replace(/\x1b[@-Z\\-_]/g, "");

const QR_BLOCK_LINE_RE = /^[\s▄▀█▌▐░▒▓■□▪▫]+$/;

const looksLikeQrLine = (line: string): boolean => {
  const trimmed = line.trimEnd();
  if (trimmed.length < 24) return false;
  const blockChars = trimmed.match(/[▄▀█▌▐░▒▓■□▪▫]/g)?.length ?? 0;
  return blockChars >= 12 && QR_BLOCK_LINE_RE.test(trimmed);
};

export function extractTerminalQrMarkers(source: string): HermesMarker[] {
  const normalized = stripAnsi(source).replace(/\\n/g, "\n");
  const lines = normalized.split(/\r?\n/);
  const markers: HermesMarker[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i += 1) {
    if (!looksLikeQrLine(lines[i])) continue;

    const block: string[] = [];
    let j = i;
    while (j < lines.length && (looksLikeQrLine(lines[j]) || lines[j].trim() === "")) {
      if (looksLikeQrLine(lines[j])) block.push(lines[j].trimEnd());
      j += 1;
    }

    const payload = block.join("\n").trim();
    const blockChars = payload.match(/[▄▀█▌▐░▒▓■□▪▫]/g)?.length ?? 0;
    if (block.length >= 8 && blockChars >= 180 && !seen.has(payload)) {
      seen.add(payload);
      markers.push({ kind: "qr", payload, display: "terminal" });
    }
    i = Math.max(i, j - 1);
  }

  return markers;
}

/**
 * Remove Ronbot marker lines from assistant-visible text and collect UI payloads.
 */
export function stripHermesMarkers(source: string): {
  text: string;
  markers: HermesMarker[];
  dashboardRefresh: boolean;
} {
  const markers: HermesMarker[] = [];
  let text = source;
  let dashboardRefresh = false;

  const pushQr = (payload: string, display?: "terminal" | "payload") => {
    const p = payload.trim();
    if (p) markers.push({ kind: "qr", payload: p, display });
  };
  const pushCredential = (purpose: string) => {
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

  text = text.replace(/\[SHOW_QR\][ \t]*([^\r\n]+)/gi, (_, payload: string) => {
    pushQr(payload, "payload");
    return "";
  });

  text = text.replace(/\[SHOW_QR\][ \t]*(?:\r?\n)?/gi, "");

  text = text.replace(/\[REQUEST_CREDENTIALS\]\s*([^\r\n]*)/gi, (_, purpose: string) => {
    pushCredential(purpose);
    return "";
  });

  text = text.replace(/\[REQUEST_PASSWORD\]\s*([^\r\n]*)/gi, (_, purpose: string) => {
    pushCredential(purpose);
    return "";
  });

  text = text.replace(
    /\[SHOW_BRAID_GRAPH\](?:\r?\n```mermaid\r?\n([\s\S]*?)```)?\s*/gi,
    (_full, diagram?: string) => {
      pushBraid(diagram);
      return "";
    },
  );

  text = text.replace(/\[UPDATE_DASHBOARD\][ \t]*(?:\r?\n)?/gi, () => {
    dashboardRefresh = true;
    return "";
  });

  const cleaned = text.replace(/\n{3,}/g, "\n\n").trimEnd();
  return { text: cleaned, markers, dashboardRefresh };
}

export function publishHermesMarkers(markers: HermesMarker[]) {
  emit(markers);
}
