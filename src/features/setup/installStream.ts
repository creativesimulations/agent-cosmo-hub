// Hermes v0.13.0 sync — May 2026 (Ronbot)
import type { StreamEvent } from './types';
import {
  initialInstallProgressState,
  stripAnsi,
  toProgressUpdate,
  updateInstallProgressFromLine,
  type InstallProgressPhase,
  type InstallProgressUpdate,
} from './installProgress';

const HEARTBEAT_MS = 15_000;
const PARTIAL_FLUSH_MS = 4_000;
const MIN_PARTIAL_LEN = 8;

export type InstallStreamHandler = {
  parse: (event: StreamEvent) => void;
  flush: () => void;
  dispose: () => void;
};

export function createInstallStreamHandler(options: {
  phase: InstallProgressPhase;
  onLines: (lines: string[]) => void;
  onProgress?: (update: InstallProgressUpdate) => void;
}): InstallStreamHandler {
  let lineBuffer = '';
  let progressState = initialInstallProgressState(options.phase);
  let lastPartialEmitted = '';
  let lastPartialFlushAt = Date.now();
  let lastHeartbeatAt = Date.now();
  const startedAt = Date.now();

  const emitProgress = () => {
    options.onProgress?.(toProgressUpdate(progressState));
  };

  const onInstallerLine = (raw: string) => {
    const cleaned = stripAnsi(raw).trim();
    if (!cleaned) return;
    progressState = updateInstallProgressFromLine(raw, progressState, options.phase);
    emitProgress();
    options.onLines([cleaned]);
  };

  const maybeEmitPartial = (force = false) => {
    const tail = stripAnsi(lineBuffer).trim();
    if (tail.length < MIN_PARTIAL_LEN) return;
    const now = Date.now();
    if (!force && now - lastPartialFlushAt < PARTIAL_FLUSH_MS) return;
    if (tail === lastPartialEmitted) return;
    lastPartialFlushAt = now;
    lastPartialEmitted = tail;
    onInstallerLine(tail);
    lineBuffer = '';
  };

  const heartbeat = () => {
    const now = Date.now();
    if (now - lastHeartbeatAt < HEARTBEAT_MS) return;
    lastHeartbeatAt = now;
    const secs = Math.round((now - startedAt) / 1000);
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    options.onLines([`… still working — ${progressState.label} (elapsed ${mm}:${ss})`]);
  };

  const ingest = (data: string) => {
    heartbeat();
    const normalized = data.replace(/\r\n/g, '\n');
    const segments = normalized.split('\r');
    const tail = segments.pop() ?? '';
    for (const seg of segments) {
      const line = seg.trim();
      if (line) onInstallerLine(line);
    }
    lineBuffer += tail;
    const parts = lineBuffer.split('\n');
    lineBuffer = parts.pop() ?? '';
    for (const part of parts) {
      if (part.trim()) onInstallerLine(part);
    }
    maybeEmitPartial(false);
  };

  const parse = (event: StreamEvent) => {
    if ((event.type !== 'stdout' && event.type !== 'stderr') || !event.data) return;
    ingest(event.data);
  };

  const flush = () => {
    maybeEmitPartial(true);
    if (lineBuffer.trim()) {
      onInstallerLine(lineBuffer);
      lineBuffer = '';
    }
  };

  const partialTimer = window.setInterval(() => maybeEmitPartial(false), PARTIAL_FLUSH_MS);
  const heartbeatTimer = window.setInterval(heartbeat, HEARTBEAT_MS);

  const dispose = () => {
    window.clearInterval(partialTimer);
    window.clearInterval(heartbeatTimer);
  };

  emitProgress();
  return { parse, flush, dispose };
}
