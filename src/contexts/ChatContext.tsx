import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { systemAPI } from "@/lib/systemAPI";
import { toast } from "@/hooks/use-toast";
import { toast as sonnerToast } from "sonner";
import { useSettings } from "./SettingsContext";
import { handleAgentReplyArrived } from "@/lib/notify";
import { liveSubAgents } from "@/lib/liveSubAgents";
import { detectToolUnavailable, type ToolUnavailableHit } from "@/lib/toolUnavailable";
import { detectToolCalls } from "@/lib/toolUseDetection";
import { useCapabilities } from "./CapabilitiesContext";
import { capabilityProbe } from "@/lib/capabilityProbe";
import {
  splitIntentsFromText,
  formatIntentResponse,
  type AgentIntent,
  type IntentResponse,
} from "@/lib/agentIntents";

/**
 * Chat is hoisted into a top-level context so:
 *   1. The Hermes session id survives navigation — every turn calls
 *      `hermes chat --resume <id>` against the same conversation, so the
 *      agent actually remembers what we just said.
 *   2. An in-flight reply keeps streaming even when the user clicks away
 *      from /chat — the promise lives on the provider, not the page, so
 *      its `setMessages` callback always reaches a mounted component.
 *   3. We can show an unread indicator on the Agent Chat sidebar entry
 *      whenever a reply lands while the user is viewing another route.
 *   4. The user can keep typing/sending while the agent is still replying —
 *      additional prompts are queued and processed strictly in order, so
 *      the agent never sees two "user" turns interleaved out of sequence.
 */

const CHAT_STORAGE_KEY = "ronbot-agent-chat-history-v2";
const SESSION_STORAGE_KEY = "ronbot-agent-chat-session-id-v1";

/**
 * Disk mirror for chat history. Electron's `file://` localStorage has been
 * historically unreliable in packaged builds (it can get wiped on certain
 * upgrades or when the userData dir gets relocated), so we ALSO persist to
 * a JSON file under the user's home directory. localStorage stays as the
 * fast/sync primary; the disk file is a recovery mirror that gets
 * re-hydrated into localStorage on launch if localStorage is empty.
 */
const DISK_HISTORY_PATH = ".ronbot/chat-history.json";
const DISK_SESSION_PATH = ".ronbot/chat-session-id.txt";

const resolveHomePath = async (relative: string): Promise<string | null> => {
  if (typeof window === "undefined" || !window.electronAPI) return null;
  try {
    const platform = await window.electronAPI.getPlatform();
    const sep = platform.isWindows ? "\\" : "/";
    return `${platform.homeDir}${sep}${relative.replace(/\//g, sep)}`;
  } catch {
    return null;
  }
};

const ensureParentDir = async (fullPath: string): Promise<void> => {
  if (typeof window === "undefined" || !window.electronAPI) return;
  try {
    const sep = fullPath.includes("\\") ? "\\" : "/";
    const parent = fullPath.substring(0, fullPath.lastIndexOf(sep));
    if (parent) await window.electronAPI.mkdir(parent);
  } catch { /* best effort */ }
};

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  /** This message is the assistant placeholder currently being filled. */
  streaming?: boolean;
  /** This is a user message still waiting in the queue. */
  queued?: boolean;
  /** This message was cancelled by the user clicking Stop. */
  cancelled?: boolean;
  missingKey?: { provider: string; envVar: string };
  diagnostics?: string;
  materializeFailed?: boolean;
  /** Inline warning when agent reported denial despite a Ronbot Allow setting,
   *  or when an action ran without an "ask" prompt being shown. */
  permissionMismatch?: {
    kind:
      | "internet"
      | "shell"
      | "fileWrite"
      | "fileRead"
      | "script"
      | "shellNoPrompt"
      | "fileWriteNoPrompt"
      | "fileReadNoPrompt"
      | "internetNoPrompt"
      | "scriptNoPrompt";
    agentSetting: string;
    detail?: string;
  };
  /** Inline warning when the agent reported a tool/capability as unavailable
   *  (browser tool, web search, image gen, etc.) — surfaces a one-click
   *  diagnostic linking to the relevant Skills/Secrets entries. */
  toolUnavailable?: ToolUnavailableHit;
  /** Capability ids the agent invoked (or attempted) during this turn. */
  usedCapabilities?: string[];
  /** Structured intents the agent emitted in this assistant turn. */
  intents?: AgentIntent[];
  /** Per-intent responses already submitted (keyed by intent id). */
  intentResponses?: Record<string, IntentResponse>;
  /**
   * When this user message is the carrier for a `ronbot-intent-response`,
   * the chat bubble shows this redacted summary instead of the raw JSON
   * payload (so secrets never appear in chat history).
   */
  intentResponseSummary?: string;
}

interface QueueItem {
  /** id of the user message in the chat list */
  userMsgId: string;
  /** id of the assistant placeholder reserved for this turn */
  placeholderId: string;
  prompt: string;
}

interface ChatContextValue {
  messages: ChatMessage[];
  /** True while the worker is actively waiting on Hermes for the current turn. */
  isStreaming: boolean;
  /** Number of user prompts queued behind the active turn (does not include the active one). */
  queuedCount: number;
  unreadCount: number;
  sessionId: string | null;
  /** Number of sub-agent spawns observed in the in-flight streamed reply. */
  liveSubAgentCount: number;
  sendMessage: (prompt: string) => Promise<void>;
  /** Interrupt the active reply and discard everything still queued. */
  stop: () => Promise<void>;
  deleteMessage: (id: string) => void;
  clearAll: () => void;
  /** Reset the unread badge — called when the chat page mounts/focuses. */
  markChatViewed: () => void;
  /** Start a brand-new Hermes session (drops the resume id). */
  startNewSession: () => void;
  /** In-memory draft for the chat composer — survives tab switches but not app restarts. */
  draft: string;
  setDraft: (value: string) => void;
  /**
   * Reply to an agent intent. Stores the response on the carrier assistant
   * message (so the card renders as locked) and posts a `ronbot-intent-response`
   * turn back to the agent. The user-bubble shows a redacted summary.
   */
  sendIntentResponse: (
    assistantMsgId: string,
    intent: AgentIntent,
    response: IntentResponse,
  ) => Promise<void>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

const loadStoredMessages = (): ChatMessage[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Omit<ChatMessage, "timestamp"> & { timestamp: string }>;
    if (!Array.isArray(parsed)) return [];
    // Drop any half-finished streaming/queued markers from a previous run —
    // they would otherwise confuse the UI on reload.
    return parsed.map((m) => ({
      ...m,
      timestamp: new Date(m.timestamp),
      streaming: false,
      queued: false,
    }));
  } catch {
    return [];
  }
};

const loadStoredSessionId = (): string | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
};

export const ChatProvider = ({ children }: { children: ReactNode }) => {
  const { settings } = useSettings();
  const { recordUse, openCapabilityDecision } = useCapabilities();
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadStoredMessages());
  const [isStreaming, setIsStreaming] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [draft, setDraft] = useState("");
  const [liveSubAgentCount, setLiveSubAgentCount] = useState(0);
  // Honor "Auto-resume last session" — when disabled, we drop any persisted id
  // so the next message starts a fresh Hermes session.
  const [sessionId, setSessionId] = useState<string | null>(() =>
    settings.autoResumeSession ? loadStoredSessionId() : null,
  );

  // Track the current route via a ref so the async worker can read the
  // latest value without re-creating itself on every navigation.
  const location = useLocation();
  const onChatPageRef = useRef(location.pathname === "/chat");
  useEffect(() => {
    onChatPageRef.current = location.pathname === "/chat";
  }, [location.pathname]);

  // Mirror settings into a ref so the long-lived worker can read the
  // latest sound/notification preferences without re-creating itself.
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // The current Hermes session id is read by the worker on every turn —
  // keep it in a ref so updates from a previous turn are visible to the
  // next dequeue without restarting the worker.
  const sessionIdRef = useRef<string | null>(sessionId);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Worker state: a serial queue + a flag so we never start two turns at once.
  const queueRef = useRef<QueueItem[]>([]);
  const workerRunningRef = useRef(false);
  // streamId of the in-flight Hermes process (so Stop can kill it).
  const activeStreamIdRef = useRef<string | null>(null);
  // Set when the user clicks Stop — the worker checks this and aborts the
  // remaining queue rather than continuing on to the next prompt.
  const stopRequestedRef = useRef(false);

  // Persist messages, capped to settings.maxStoredMessages (0 = unlimited).
  // Mirror to BOTH localStorage (fast/sync) and a disk file under ~/.ronbot
  // (resilient to localStorage wipes in packaged Electron builds).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const max = settings.maxStoredMessages;
    const toStore = max > 0 && messages.length > max ? messages.slice(-max) : messages;
    const serialized = JSON.stringify(
      toStore.map((m) => ({ ...m, timestamp: m.timestamp.toISOString() })),
    );
    try { window.localStorage.setItem(CHAT_STORAGE_KEY, serialized); } catch { /* quota / private mode */ }

    // Mirror to disk asynchronously — never block the render.
    if (window.electronAPI) {
      void (async () => {
        const full = await resolveHomePath(DISK_HISTORY_PATH);
        if (!full) return;
        await ensureParentDir(full);
        await window.electronAPI!.writeFile(full, serialized).catch(() => { /* best effort */ });
      })();
    }
  }, [messages, settings.maxStoredMessages]);

  // On mount: ensure Hermes file logging is enabled (one-time, idempotent)
  // so the SubAgents tab can show post-hoc activity, and hydrate from disk
  // mirror if localStorage was empty.
  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI) return;
    // Best-effort: enable file logging silently. The managed-block writer
    // is a no-op when the block is already present.
    void systemAPI.enableHermesFileLogging?.().catch(() => undefined);
    // Periodically prune completed live sub-agent entries older than 24h.
    const pruneId = window.setInterval(() => liveSubAgents.prune(), 60_000);
    let cancelled = false;
    if (messages.length === 0) {
      void (async () => {
        const histPath = await resolveHomePath(DISK_HISTORY_PATH);
        if (!histPath) return;
        const result = await window.electronAPI!.readFile(histPath).catch(() => null);
        if (cancelled || !result?.success || !result.content) return;
        try {
          const parsed = JSON.parse(result.content) as Array<Omit<ChatMessage, "timestamp"> & { timestamp: string }>;
          if (!Array.isArray(parsed) || parsed.length === 0) return;
          setMessages(parsed.map((m) => ({
            ...m,
            timestamp: new Date(m.timestamp),
            streaming: false,
            queued: false,
          })));
        } catch { /* corrupt file — ignore */ }

        // Also try to recover session id if localStorage lost it.
        if (!sessionIdRef.current) {
          const sidPath = await resolveHomePath(DISK_SESSION_PATH);
          if (!sidPath) return;
          const sidRes = await window.electronAPI!.readFile(sidPath).catch(() => null);
          if (sidRes?.success && sidRes.content) {
            const sid = sidRes.content.trim();
            if (sid) {
              sessionIdRef.current = sid;
              setSessionId(sid);
            }
          }
        }
      })();
    }
    return () => { cancelled = true; window.clearInterval(pruneId); };
    // Run exactly once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the limit is lowered, trim in-memory list to match.
  useEffect(() => {
    const max = settings.maxStoredMessages;
    if (max > 0 && messages.length > max) {
      setMessages((prev) => prev.slice(-max));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.maxStoredMessages]);

  // Persist session id (localStorage + disk mirror) so app restarts can keep
  // talking to the same agent session.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionId) {
      try { window.localStorage.setItem(SESSION_STORAGE_KEY, sessionId); } catch { /* */ }
    } else {
      try { window.localStorage.removeItem(SESSION_STORAGE_KEY); } catch { /* */ }
    }
    if (window.electronAPI) {
      void (async () => {
        const full = await resolveHomePath(DISK_SESSION_PATH);
        if (!full) return;
        await ensureParentDir(full);
        await window.electronAPI!.writeFile(full, sessionId || "").catch(() => { /* best effort */ });
      })();
    }
  }, [sessionId]);

  const markChatViewed = useCallback(() => setUnreadCount(0), []);

  // Auto-clear the unread badge when the user is actually viewing /chat.
  useEffect(() => {
    if (location.pathname === "/chat") setUnreadCount(0);
  }, [location.pathname]);

  const deleteMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setMessages([]);
    toast({ title: "Conversation cleared", description: "All messages have been removed." });
  }, []);

  const startNewSession = useCallback(() => {
    setSessionId(null);
    sessionIdRef.current = null;
    toast({ title: "New session started", description: "Your next message will start a fresh agent session." });
  }, []);

  /** Process the queue strictly serially. */
  const drainQueue = useCallback(async () => {
    if (workerRunningRef.current) return;
    workerRunningRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        if (stopRequestedRef.current) {
          // Mark every remaining queued user message as cancelled so the user
          // can see what got dropped.
          const dropped = queueRef.current.splice(0);
          setQueuedCount(0);
          setMessages((prev) =>
            prev.map((m) =>
              dropped.some((d) => d.userMsgId === m.id || d.placeholderId === m.id)
                ? { ...m, queued: false, cancelled: true, streaming: false, content: m.content || "(cancelled before sending)" }
                : m,
            ),
          );
          break;
        }

        const item = queueRef.current.shift()!;
        setQueuedCount(queueRef.current.length);

        // Promote the user message out of "queued" state and the placeholder
        // into "streaming" state.
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id === item.userMsgId) return { ...m, queued: false };
            if (m.id === item.placeholderId) return { ...m, streaming: true };
            return m;
          }),
        );
        setIsStreaming(true);

        try {
          const timeoutMs = Math.max(60, settingsRef.current.chatTimeoutSec || 600) * 1000;

          // ── Live activity tracking (all permission categories) ──
          // Watch the streamed Hermes output for every permission-relevant
          // tool call so we can: (1) feed the live SubAgents store, and
          // (2) detect "ask"-set categories that ran without a prompt.
          let liveCount = 0;
          let spawnedThisTurn = 0;
          // Per-category activity counters for this turn.
          const activityThisTurn = {
            shell: 0,
            fileWrite: 0,
            fileRead: 0,
            internet: 0,
            script: 0,
          };
          // Did Hermes actually emit an approval prompt this turn? If so, the
          // user was asked at least once and we shouldn't flag a "no prompt"
          // mismatch even when `ask` is set.
          let approvalPromptSeen = 0;
          setLiveSubAgentCount(0);
          // Per-turn FIFO of live ids so we can pair up start → complete/fail.
          const turnLiveIds: string[] = [];
          // Buffer the tail of the stream so we can match multi-line patterns
          // like a delegate_task tool call followed by its `task: "..."` arg.
          let streamBuf = "";

          // Per-turn list of capability ids invoked by the agent (used for
          // capability chips on the assistant message).
          const usedCapsThisTurn = new Set<string>();

          const extractGoal = (buf: string): string => {
            // Try the broadest set of phrasings Hermes (and its forks) emit
            // when announcing a delegated task. Order matters — most specific
            // first so we don't grab a generic "task" key from elsewhere.
            const patterns: RegExp[] = [
              // JSON-ish args block: "task": "...", 'goal': '...', prompt: "..."
              /["']?(?:task|goal|prompt|instruction|description|objective)["']?\s*[:=]\s*["']([^"']{3,400})["']/i,
              // delegate_task(...) call with the goal as first positional arg
              /delegate_task\s*\(\s*["']([^"']{3,400})["']/i,
              // delegate_task tool call followed (possibly multi-line) by an arg
              /delegate_task[\s\S]{0,600}?["']?(?:task|goal|prompt|instruction|description)["']?\s*[:=]\s*["']([^"']{3,400})["']/i,
              // "spawned sub-agent to <do something>" / "spawn child agent: <goal>"
              /spawn(?:ed|ing)?\s+(?:a\s+)?(?:sub[-_ ]?agent|child\s+agent|worker)\s*(?:to|:)\s*([^\n"']{6,300})/i,
              // "delegating: <goal>" or "delegation: <goal>"
              /delegat(?:ing|ion)\s*[:\-]\s*([^\n"']{6,300})/i,
              // Unquoted task=... up to end of line / comma
              /(?:task|goal|prompt)\s*[:=]\s*([^,\n}]{6,300})/i,
            ];
            // Words that are clearly the tool/marker name itself rather than
            // a real goal — Hermes' streamed output sometimes emits the
            // tool name in a boxed header (`delegate_task │`) that the
            // greedy patterns above will happily capture as the "goal".
            const REJECT = /^(delegate_task|sub[-_ ]?agent(?:\.start)?|spawn|task|goal|prompt)\b[\s│|│┃┆┊╎╏┝┥┯┷┿┃─━│┃┄┅┈┉]*$/i;
            for (const re of patterns) {
              const m = buf.match(re);
              if (m) {
                // Strip trailing quotes, commas, braces AND box-drawing /
                // pipe characters that appear in Hermes' tool-call headers.
                const cleaned = m[1]
                  .trim()
                  .replace(/[",}\s│|┃┄┅┆┇┈┉┊┋╎╏─━]+$/u, "")
                  .replace(/^[\s│|┃─━]+/u, "")
                  .trim();
                if (cleaned.length >= 6 && !REJECT.test(cleaned)) return cleaned;
              }
            }
            return "(no goal captured)";
          };

          // Activity detectors — broad regexes that match the various ways
          // Hermes (and its forks) name tool calls in streamed output.
          const activityPatterns = {
            shell: /\b(run_shell|shell\.run|exec_shell|bash_command|tool:\s*shell)\b/gi,
            fileWrite: /\b(write_file|file\.write|create_file|edit_file|patch_file|append_file|tool:\s*write)\b/gi,
            fileRead: /\b(read_file|file\.read|view_file|cat_file|tool:\s*read)\b/gi,
            internet: /\b(fetch_url|http\.get|http\.post|web_fetch|web_search|browse_url|tool:\s*(?:fetch|browse|search))\b/gi,
            script: /\b(run_python|run_node|run_script|execute_script|tool:\s*(?:python|node|script))\b/gi,
          } as const;

          const onStream = (chunk: { type: string; data?: string }) => {
            if ((chunk.type !== "stdout" && chunk.type !== "stderr") || !chunk.data) return;
            streamBuf = (streamBuf + chunk.data).slice(-8000);

            // Approval prompt sighting — anything that looks like Hermes
            // asking us to choose o/s/a/d. We only need a rough hit count.
            if (/Choice\s*\[\s*o\s*\/\s*s\s*\/\s*a/i.test(chunk.data) ||
                /\[\s*o\s*\]\s*nce.*\[\s*s\s*\]\s*ession/i.test(chunk.data) ||
                /Approve\??\s*\(\s*o\s*\/\s*s\s*\/\s*a/i.test(chunk.data) ||
                /Permission\s+required/i.test(chunk.data) ||
                /Awaiting\s+approval/i.test(chunk.data)) {
              approvalPromptSeen += 1;
            }

            // Per-category activity counts.
            for (const k of Object.keys(activityPatterns) as Array<keyof typeof activityPatterns>) {
              const m = chunk.data.match(activityPatterns[k]);
              if (m) {
                activityThisTurn[k] += m.length;
                // Mirror into the capability tracker so chips show up.
                usedCapsThisTurn.add(k);
                recordUse(k);
              }
            }

            // Detect explicit tool announcements ("tool: web_search",
            // "calling browser…", etc.) and record them as capability uses.
            const toolHits = detectToolCalls(chunk.data);
            for (const hit of toolHits) {
              if (!usedCapsThisTurn.has(hit.capabilityId)) {
                usedCapsThisTurn.add(hit.capabilityId);
                recordUse(hit.capabilityId);
              }
            }

            // Spawn detection — count distinct delegation events.
            const spawnRe = /\b(delegate_task|sub[-_ ]?agent\.start|spawn(?:ed)?\s+(?:sub[-_ ]?agent|child\s+agent))\b/gi;
            const spawnMatches = chunk.data.match(spawnRe);
            if (spawnMatches && spawnMatches.length) {
              for (let i = 0; i < spawnMatches.length; i++) {
                const goal = extractGoal(streamBuf);
                const id = liveSubAgents.spawn(goal);
                turnLiveIds.push(id);
                spawnedThisTurn++;
              }
              liveCount += spawnMatches.length;
              setLiveSubAgentCount(liveCount);
            }

            // Deferred goal capture — Hermes often emits the spawn marker on
            // one chunk and the args (containing the goal) a few chunks later.
            // Re-scan the buffer and back-fill any "(no goal captured)" ids
            // that are still pending in this turn.
            if (turnLiveIds.length) {
              const lateGoal = extractGoal(streamBuf);
              if (lateGoal !== "(no goal captured)") {
                for (const id of turnLiveIds) {
                  // updateGoal is a no-op if the entry already has a real goal
                  // (we only want to overwrite the placeholder).
                  const current = liveSubAgents.list().find((s) => s.id === id);
                  if (current && current.goal === "(no goal captured)") {
                    liveSubAgents.updateGoal(id, lateGoal);
                  }
                }
              }
            }

            // Completion detection.
            const completeRe = /\b(sub[-_ ]?agent\.complete|delegation\s+(?:complete|finished|done)|child[-_ ]?agent\b[^.\n]*\b(?:complete|finished|done))\b/gi;
            const completeMatches = chunk.data.match(completeRe);
            if (completeMatches) {
              for (let i = 0; i < completeMatches.length; i++) {
                const id = turnLiveIds.shift();
                if (id) liveSubAgents.complete(id);
              }
            }

            // Failure / denial detection.
            const failRe = /\b(sub[-_ ]?agent\.(?:failed|error|denied)|delegation\s+(?:failed|denied|errored)|child[-_ ]?agent\b[^.\n]*\b(?:failed|denied|crashed))\b/gi;
            const failMatches = chunk.data.match(failRe);
            if (failMatches) {
              for (let i = 0; i < failMatches.length; i++) {
                const id = turnLiveIds.shift();
                if (id) {
                  const reasonM = chunk.data.match(/(?:reason|error|denied)\s*[:=]\s*["']?([^"'\n]{3,200})/i);
                  liveSubAgents.fail(id, reasonM?.[1]);
                }
              }
            }
          };

          const result = await systemAPI.chatAgent(
            item.prompt,
            onStream,
            sessionIdRef.current ?? undefined,
            (id) => { activeStreamIdRef.current = id; },
            timeoutMs,
            settingsRef.current.permissions,
          );

          // Any sub-agents still marked running at end-of-turn must have
          // finished (sub-agents die with their parent turn). This guards
          // against missed completion markers in noisy streams.
          liveSubAgents.finalizeRunning();

          // Even on success, if Stop fired during the call, treat as cancelled.
          if (stopRequestedRef.current) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === item.placeholderId
                  ? { ...m, content: "(stopped by user)", streaming: false, cancelled: true }
                  : m,
              ),
            );
            activeStreamIdRef.current = null;
            continue;
          }

          const reply = result.reply || result.stdout?.trim() || "(no response)";
          const matFailed = (result as { materializeFailed?: boolean }).materializeFailed === true;

          if (result.sessionId && result.sessionId !== sessionIdRef.current) {
            sessionIdRef.current = result.sessionId;
            setSessionId(result.sessionId);
          } else if (result.sessionId === null && sessionIdRef.current) {
            // Hermes refused our cached resume id and we recovered with a
            // fresh session that didn't print a new id — drop the stale one
            // so we don't keep trying it on every turn.
            sessionIdRef.current = null;
            setSessionId(null);
          }

          // ── Permission-mismatch detection ──
          // Two failure modes we surface as inline warnings:
          //  (a) Agent reported "I can't do X" while Ronbot is set to Allow
          //      → permissions block didn't reach the agent.
          //  (b) The agent performed X without a prompt while Ronbot is set
          //      to Ask → agent ignored our `ask` and auto-allowed.
          // Only one mismatch is shown per assistant message to keep the UI
          // clean; pick the highest-priority hit.
          const perms = settingsRef.current.permissions;
          const lower = (reply || "").toLowerCase();
          let permissionMismatch: ChatMessage["permissionMismatch"];

          // ── (a) Denial-while-Allow patterns ──
          const denyPatterns: Array<{
            kind: "internet" | "shell" | "fileWrite" | "fileRead" | "script";
            check: typeof perms.shell;
            re: RegExp;
          }> = [
            { kind: "internet",  check: perms.internet,  re: /(no internet|cannot access the internet|internet access (?:denied|blocked|disabled)|not (?:allowed|permitted) to (?:access|use) the (?:internet|web|network))/i },
            { kind: "shell",     check: perms.shell,     re: /(cannot (?:run|execute) (?:the )?(?:shell|command)|shell (?:access|command).*denied|not (?:allowed|permitted) to (?:run|execute) (?:shell|commands))/i },
            { kind: "fileWrite", check: perms.fileWrite, re: /(cannot (?:write|create|edit|modify) (?:the )?file|file write.*denied|not (?:allowed|permitted) to (?:write|create|modify) files)/i },
            { kind: "fileRead",  check: perms.fileRead,  re: /(cannot (?:read|open|view) (?:the )?file|file read.*denied|not (?:allowed|permitted) to (?:read|open) files)/i },
            { kind: "script",    check: perms.script,    re: /(cannot (?:run|execute) (?:the )?script|script execution.*denied|not (?:allowed|permitted) to (?:run|execute) scripts)/i },
          ];
          for (const p of denyPatterns) {
            if (p.check === "allow" && p.re.test(lower)) {
              permissionMismatch = { kind: p.kind, agentSetting: "Allow" };
              break;
            }
          }

          // ── (b) Ask-was-bypassed patterns ──
          // Only flag when the user set `ask`, we observed activity, AND no
          // approval prompt appeared in the stream this turn.
          // (Sub-agent spawns are no longer treated as a permission category —
          // they're observed for live tracking only.)
          if (!permissionMismatch && approvalPromptSeen === 0) {
            const askChecks: Array<{
              kind: "shellNoPrompt" | "fileWriteNoPrompt" | "fileReadNoPrompt" | "internetNoPrompt" | "scriptNoPrompt";
              check: typeof perms.shell;
              count: number;
              label: string;
            }> = [
              { kind: "shellNoPrompt",     check: perms.shell,     count: activityThisTurn.shell,     label: "Shell command" },
              { kind: "fileWriteNoPrompt", check: perms.fileWrite, count: activityThisTurn.fileWrite, label: "File write" },
              { kind: "internetNoPrompt",  check: perms.internet,  count: activityThisTurn.internet,  label: "Internet access" },
              { kind: "scriptNoPrompt",    check: perms.script,    count: activityThisTurn.script,    label: "Script execution" },
              { kind: "fileReadNoPrompt",  check: perms.fileRead,  count: activityThisTurn.fileRead,  label: "File read" },
            ];
            for (const a of askChecks) {
              if (a.check === "ask" && a.count > 0) {
                permissionMismatch = {
                  kind: a.kind,
                  agentSetting: "Ask each time",
                  detail: `${a.label}: ${a.count} call${a.count === 1 ? "" : "s"} ran without prompting.`,
                };
                break;
              }
            }
          }

          // ── Tool-unavailable detection ──
          // Independent of permissionMismatch — a single reply can hit both.
          const toolUnavailable = result.success && !result.missingKey
            ? detectToolUnavailable(reply)
            : undefined;

          // ── Agent intents ──
          // Pull `ronbot-intent` fenced JSON blocks out of the visible reply.
          // Strips them from the rendered text so the user only sees the
          // surrounding prose; the cards render alongside the bubble.
          const split = result.success && !result.missingKey
            ? splitIntentsFromText(reply)
            : { text: reply, intents: [] as AgentIntent[], errors: [] };

          setMessages((prev) =>
            prev.map((m) =>
              m.id === item.placeholderId
                ? {
                    ...m,
                    content: result.success && !result.missingKey
                      ? split.text
                      : matFailed
                        ? `Failed to sync your secrets to the agent. Open App Diagnostics for the exact shell error.\n\n${result.stderr || ""}`
                        : result.missingKey
                          ? `No API key found for ${result.missingKey.provider}. Add ${result.missingKey.envVar} in the Secrets tab to start chatting.`
                          : `Error: ${result.stderr || reply}`,
                    streaming: false,
                    missingKey: matFailed ? undefined : result.missingKey,
                    diagnostics: result.diagnostics,
                    materializeFailed: matFailed,
                    permissionMismatch,
                    toolUnavailable,
                    usedCapabilities: Array.from(usedCapsThisTurn),
                    intents: split.intents.length > 0 ? split.intents : undefined,
                  }
                : m,
            ),
          );

          // ── LOUD notice: when tool is reported unavailable, run the real
          // readiness probe and surface a persistent toast + modal so the
          // user is never left wondering. The probe overrides the agent's
          // (often hallucinated) self-diagnosis with ground truth.
          if (toolUnavailable) {
            const idMap: Record<string, string> = {
              browser: "webBrowser",
              webSearch: "webSearch",
              imageGen: "imageGen",
              voice: "voice",
              email: "email",
              messaging: "messaging",
              memory: "memory",
              codeInterpreter: "script",
              filesystem: "fileWrite",
            };
            const capId = idMap[toolUnavailable.capability] ?? toolUnavailable.capability;
            void (async () => {
              try {
                const probe = await capabilityProbe(capId);
                sonnerToast(`Ron tried to use ${toolUnavailable.label} and was blocked`, {
                  description: probe.message,
                  duration: 30_000,
                  action: {
                    label: "Fix it",
                    onClick: () => openCapabilityDecision(capId, probe, `The agent reported: "${toolUnavailable.matchedText.slice(0, 120)}…"`),
                  },
                });
              } catch { /* probe failed — toast still useful, fall back */
                sonnerToast(`Ron tried to use ${toolUnavailable.label} and was blocked`, {
                  description: toolUnavailable.hint,
                  duration: 30_000,
                });
              }
            })();
          }

          if (!result.success && !result.missingKey) {
            toast({
              title: matFailed ? "Secret sync failed" : "Agent error",
              description: result.stderr?.split("\n")[0] || "Failed to get a reply from the agent.",
              variant: "destructive",
            });
          }

          if (result.success && !result.missingKey && !matFailed) {
            handleAgentReplyArrived(settingsRef.current, reply);
          }
          if (!onChatPageRef.current) {
            setUnreadCount((n) => n + 1);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === item.placeholderId
                ? { ...m, content: `Error: ${msg}`, streaming: false }
                : m,
            ),
          );
          toast({ title: "Agent error", description: msg, variant: "destructive" });
          if (!onChatPageRef.current) setUnreadCount((n) => n + 1);
        } finally {
          activeStreamIdRef.current = null;
          setLiveSubAgentCount(0);
        }
      }
    } finally {
      workerRunningRef.current = false;
      stopRequestedRef.current = false;
      setIsStreaming(false);
      setQueuedCount(0);
    }
  }, []);

  const sendMessage = useCallback(async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed) return;
    // Gate on the user-facing on/off switch. Read directly from localStorage
    // so ChatContext doesn't need to depend on AgentConnectionContext.
    try {
      const running = window.localStorage.getItem("ronbot-agent-running-v1");
      if (running === "false") {
        toast({
          title: "Agent is turned off",
          description: "Turn the agent on from the Dashboard to send messages.",
          variant: "destructive",
        });
        return;
      }
    } catch { /* best effort */ }

    // Reserve a user message + an assistant placeholder. They appear instantly
    // even if the worker is still chewing through earlier prompts; the
    // placeholder shows as "queued" until its turn arrives.
    const stamp = Date.now();
    const userMsgId = `${stamp}-u-${Math.random().toString(36).slice(2, 6)}`;
    const placeholderId = `${stamp}-r-${Math.random().toString(36).slice(2, 6)}`;
    const willBeQueued = queueRef.current.length > 0 || workerRunningRef.current;

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", content: trimmed, timestamp: new Date(), queued: willBeQueued },
      { id: placeholderId, role: "assistant", content: "", timestamp: new Date(), streaming: !willBeQueued, queued: willBeQueued },
    ]);

    queueRef.current.push({ userMsgId, placeholderId, prompt: trimmed });
    setQueuedCount(queueRef.current.length - (workerRunningRef.current ? 0 : 1));

    void drainQueue();
  }, [drainQueue]);

  const stop = useCallback(async () => {
    stopRequestedRef.current = true;
    const sid = activeStreamIdRef.current;
    if (sid) {
      await systemAPI.killStream(sid).catch(() => { /* best effort */ });
      activeStreamIdRef.current = null;
    }
    // Mark queued items as cancelled immediately for UI feedback; the worker
    // will also flush them when it loops.
    const dropped = queueRef.current.splice(0);
    if (dropped.length > 0) {
      setMessages((prev) =>
        prev.map((m) =>
          dropped.some((d) => d.userMsgId === m.id || d.placeholderId === m.id)
            ? { ...m, queued: false, cancelled: true, streaming: false, content: m.content || "(cancelled before sending)" }
            : m,
        ),
      );
    }
    setQueuedCount(0);
    toast({ title: "Stopped", description: "The agent was interrupted and any queued messages were cancelled." });
  }, []);

  return (
    <ChatContext.Provider
      value={{
        messages,
        isStreaming,
        queuedCount,
        unreadCount,
        sessionId,
        liveSubAgentCount,
        sendMessage,
        stop,
        deleteMessage,
        clearAll,
        markChatViewed,
        startNewSession,
        draft,
        setDraft,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
};
