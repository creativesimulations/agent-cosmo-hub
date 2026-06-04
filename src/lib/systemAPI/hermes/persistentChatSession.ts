// Hermes v0.13.0 sync — May 2026 (Ronbot)
/**
 * Keeps one interactive `hermes chat` process alive per Ronbot conversation so
 * background PTY/tool state survives between user messages (matching the stock CLI).
 */
import { coreAPI } from "../core";
import { choiceToStdin, getApprovalHandler, guessAction, matchesApprovalPrompt } from "../../approvalBridge";
import type { CommandOutputHandler } from "./shell";
import { runHermesShell } from "./shell";
import { extractSessionId } from "./chatOutput";
import type { CommandResult } from "../types";

const TURN_END_RE = /(?:^|\n)(?:Duration:\s|Resume this session(?:\s+with)?:)/m;
const READY_RE =
  /(?:^|\n)(?:Duration:\s|Resume this session|Choice\s*\[|❯|hermes agent v|\]\s*once\s*\|)/im;

export type PersistentTurnOptions = {
  prompt: string;
  resumeId?: string;
  noColorFlag: string;
  quietFlag: string;
  timeoutMs: number;
  onOutput?: CommandOutputHandler;
  onStreamId?: (id: string) => void;
};

type SessionState = {
  conversationKey: string;
  resumeId: string | null;
  streamId: string | null;
  buffer: string;
  ready: boolean;
  starting: Promise<void> | null;
  turnPromise: Promise<CommandResult & { reply?: string; sessionId?: string | null }> | null;
  turnResolve: ((r: CommandResult & { reply?: string; sessionId?: string | null }) => void) | null;
  turnTimer: ReturnType<typeof setTimeout> | null;
  promptBuffer: string;
  answeringPrompt: boolean;
  lastTurnSliceStart: number;
  disposeRequested: boolean;
};

const sessions = new Map<string, SessionState>();

const shellEscapeDouble = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const wrapHermesInPty = (hermesCmd: string) =>
  `script -qefc "${shellEscapeDouble(hermesCmd)}" /dev/null`;

function buildStartScript(resumeId: string | null, noColorFlag: string, quietFlag: string): string {
  const resumePart = resumeId ? ` --resume ${JSON.stringify(resumeId)}` : "";
  const hermesLine = `hermes chat${resumePart}${quietFlag}${noColorFlag} 2>&1`;
  return [
    "set -e",
    'export PATH="$HOME/.hermes/venv/bin:$HOME/.local/bin:$PATH"',
    "export TERM=xterm-256color NO_COLOR=1 CI=1 PYTHONUNBUFFERED=1",
    'if [ -f "$HOME/.hermes/.env" ]; then set -a; . "$HOME/.hermes/.env"; set +a; fi',
    'cd "$HOME/.hermes" 2>/dev/null || true',
    "command -v script >/dev/null 2>&1 || { echo \"[ronbot] FATAL: script(1) required for chat PTY\" >&2; exit 127; }",
    wrapHermesInPty(hermesLine),
  ].join("\n");
}

function sliceTurnOutput(state: SessionState): string {
  return state.buffer.slice(state.lastTurnSliceStart);
}

function failTurn(state: SessionState, partial: string, stderr: string, code: number) {
  if (state.turnTimer) clearTimeout(state.turnTimer);
  state.turnTimer = null;
  const resolve = state.turnResolve;
  state.turnResolve = null;
  state.turnPromise = null;
  if (!resolve) return;
  resolve({
    success: false,
    stdout: partial,
    stderr,
    code,
    reply: partial,
    sessionId: state.resumeId,
  });
}

function completeTurn(state: SessionState) {
  if (state.turnTimer) clearTimeout(state.turnTimer);
  state.turnTimer = null;
  const resolve = state.turnResolve;
  if (!resolve) return;

  const slice = sliceTurnOutput(state);
  const match = TURN_END_RE.exec(slice);
  const endIdx = match?.index ?? slice.length;
  const turnText = slice.slice(0, endIdx);
  state.lastTurnSliceStart = state.buffer.length;

  const discovered = extractSessionId(state.buffer, state.resumeId ?? undefined, false);
  if (discovered && discovered !== state.resumeId) state.resumeId = discovered;

  state.turnResolve = null;
  state.turnPromise = null;
  resolve({
    success: true,
    stdout: turnText,
    stderr: "",
    code: 0,
    reply: turnText,
    sessionId: state.resumeId,
  });
}

function handleApproval(state: SessionState, text: string) {
  state.promptBuffer = (state.promptBuffer + text).slice(-8000);
  if (state.answeringPrompt || !matchesApprovalPrompt(state.promptBuffer)) return;

  const lines = state.promptBuffer.split("\n").filter((l) => l.trim());
  let promptIdx = lines.findIndex((l) => matchesApprovalPrompt(l));
  if (promptIdx < 0) promptIdx = lines.length - 1;
  const ctxLines = lines.slice(Math.max(0, promptIdx - 20), promptIdx).join("\n").trim();
  const target = ctxLines.slice(-1500) || "(action details not captured)";
  const action = guessAction(ctxLines);
  const handler = getApprovalHandler();
  const sid = state.streamId;
  if (!handler || !sid) return;

  state.answeringPrompt = true;
  state.promptBuffer = "";
  void handler({ action, target }).then((choice) => {
    void coreAPI.writeStreamStdin(sid, choiceToStdin(choice)).catch(() => undefined);
    state.answeringPrompt = false;
  });
}

function attachOutputHandler(state: SessionState, onOutput?: CommandOutputHandler) {
  return (chunk: { type: string; data?: string; code?: number }) => {
    onOutput?.(chunk);
    if (chunk.type === "exit") {
      const partial = state.turnResolve ? sliceTurnOutput(state) : "";
      failTurn(state, partial, "Hermes chat session ended unexpectedly", chunk.code ?? 1);
      sessions.delete(state.conversationKey);
      return;
    }
    if (chunk.type !== "stdout" && chunk.type !== "stderr") return;
    const text = chunk.data || "";
    if (!text) return;

    state.buffer += text;
    if (!state.ready && READY_RE.test(state.buffer)) state.ready = true;

    handleApproval(state, text);

    if (state.turnResolve && TURN_END_RE.test(sliceTurnOutput(state))) {
      completeTurn(state);
    }
  };
}

function startSessionProcess(state: SessionState, opts: PersistentTurnOptions): Promise<void> {
  if (state.starting) return state.starting;

  state.starting = new Promise<void>((resolve, reject) => {
    const script = buildStartScript(state.resumeId, opts.noColorFlag, opts.quietFlag);
    const onChunk = attachOutputHandler(state, opts.onOutput);
    const readyTimer = setTimeout(() => {
      if (!state.ready) {
        state.ready = true;
        resolve();
      }
    }, 45_000);

    void runHermesShell(
      script,
      {
        timeout: 0,
        idleTimeoutMs: 0,
        onStreamId: (id) => {
          state.streamId = id;
          opts.onStreamId?.(id);
        },
      },
      (chunk) => {
        onChunk(chunk);
        if (!state.ready && state.buffer.length > 0 && READY_RE.test(state.buffer)) {
          state.ready = true;
          clearTimeout(readyTimer);
          resolve();
        }
      },
    )
      .then((result) => {
        clearTimeout(readyTimer);
        if (!state.ready && !result.success) {
          reject(new Error(result.stderr || "Failed to start Hermes chat session"));
          sessions.delete(state.conversationKey);
        }
      })
      .catch((err) => {
        clearTimeout(readyTimer);
        reject(err);
        sessions.delete(state.conversationKey);
      });
  });

  return state.starting;
}

async function ensureSession(
  conversationKey: string,
  opts: PersistentTurnOptions,
): Promise<SessionState> {
  let state = sessions.get(conversationKey);
  if (state?.disposeRequested) {
    await disposeConversationChat(conversationKey);
    state = undefined;
  }
  if (!state) {
    state = {
      conversationKey,
      resumeId: opts.resumeId ?? null,
      streamId: null,
      buffer: "",
      ready: false,
      starting: null,
      turnPromise: null,
      turnResolve: null,
      turnTimer: null,
      promptBuffer: "",
      answeringPrompt: false,
      lastTurnSliceStart: 0,
      disposeRequested: false,
    };
    sessions.set(conversationKey, state);
  } else if (opts.resumeId && state.resumeId && opts.resumeId !== state.resumeId) {
    await disposeConversationChat(conversationKey);
    return ensureSession(conversationKey, opts);
  } else if (opts.resumeId && !state.resumeId) {
    state.resumeId = opts.resumeId;
  }

  await startSessionProcess(state, opts);
  return state;
}

export async function runPersistentChatTurn(
  conversationKey: string,
  opts: PersistentTurnOptions,
): Promise<CommandResult & { reply?: string; sessionId?: string | null; persistent?: boolean }> {
  const state = await ensureSession(conversationKey, opts);

  if (state.turnPromise) await state.turnPromise;

  if (!state.streamId) {
    return {
      success: false,
      stdout: "",
      stderr: "Hermes chat stream not ready",
      code: 1,
      reply: "",
      sessionId: state.resumeId,
      persistent: true,
    };
  }

  state.lastTurnSliceStart = state.buffer.length;
  state.promptBuffer = "";

  const turnPromise = new Promise<CommandResult & { reply?: string; sessionId?: string | null }>((resolve) => {
    state.turnResolve = resolve;
  });
  state.turnPromise = turnPromise;

  state.turnTimer = setTimeout(() => {
    if (!state.turnResolve) return;
    const partial = sliceTurnOutput(state);
    failTurn(state, partial, `Chat turn timed out after ${opts.timeoutMs}ms`, 124);
  }, opts.timeoutMs);

  await coreAPI.writeStreamStdin(state.streamId, `${opts.prompt}\n`);

  const timeoutResult = await turnPromise;
  return { ...timeoutResult, persistent: true };
}

export async function disposeConversationChat(conversationKey: string): Promise<void> {
  const state = sessions.get(conversationKey);
  if (!state) return;
  state.disposeRequested = true;
  if (state.turnTimer) clearTimeout(state.turnTimer);
  if (state.streamId) {
    await coreAPI.killStream(state.streamId).catch(() => undefined);
  }
  sessions.delete(conversationKey);
}

export async function disposeAllConversationChats(): Promise<void> {
  const keys = [...sessions.keys()];
  await Promise.all(keys.map((k) => disposeConversationChat(k)));
}
