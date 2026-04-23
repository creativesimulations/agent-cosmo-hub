import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from "react";
import { useSettings } from "./SettingsContext";
import {
  ApprovalChoice,
  PermissionAction,
  PermissionEvent,
  RISK_BY_ACTION,
} from "@/lib/permissions";
import { agentLogs } from "@/lib/diagnostics";
import {
  ensureNotificationPermission,
  showDesktopNotification,
} from "@/lib/notify";

/**
 * PermissionsContext owns the live approval queue and a rolling history
 * of every permission decision (auto or interactive) the agent has hit.
 *
 *  - When `requestApproval` is called by the Hermes prompt detector, we
 *    open the modal, wait for the user, and resolve a promise with the
 *    user's choice. The detector then writes `o\n` / `s\n` / `a\n` / `d\n`
 *    into the agent's stdin so the run continues.
 *  - "Always" choices update the relevant Permissions setting so the
 *    next time the same class hits, the agent skips the prompt entirely.
 *  - All decisions (including auto-resolves) are recorded as `PermissionEvent`
 *    objects so AgentChat and the Terminal feed can render the history.
 */

export interface PendingRequest {
  id: string;
  action: PermissionAction;
  /** Short human-readable description of what's being attempted. */
  target: string;
  /** Optional reason / agent stated intent (the chat step we're inside). */
  reason?: string;
  /** Risk badge — derived from action class. */
  risk: "low" | "medium" | "high";
  /** Resolves once the user picks. */
  resolve: (choice: ApprovalChoice) => void;
}

interface PermissionsContextValue {
  /** The currently visible request (modal is open iff this is non-null). */
  pending: PendingRequest | null;
  /** Last ~50 events, newest first. */
  events: PermissionEvent[];
  /** Open the approval dialog and await the user's choice. */
  requestApproval: (req: Omit<PendingRequest, "id" | "resolve" | "risk">) => Promise<ApprovalChoice>;
  /** Record an event without prompting (used for auto-allow/deny paths). */
  recordEvent: (event: Omit<PermissionEvent, "id" | "timestamp">) => void;
  /** Subscribe to new events for live feeds (returns an unsubscribe). */
  subscribe: (fn: (events: PermissionEvent[]) => void) => () => void;
  /** Clear the rolling history. */
  clearEvents: () => void;
}

const PermissionsContext = createContext<PermissionsContextValue | null>(null);

const MAX_EVENTS = 100;

export const PermissionsProvider = ({ children }: { children: ReactNode }) => {
  const { settings, update } = useSettings();
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [events, setEvents] = useState<PermissionEvent[]>([]);
  const queueRef = useRef<PendingRequest[]>([]);
  const listenersRef = useRef<Set<(e: PermissionEvent[]) => void>>(new Set());

  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const pushEvent = useCallback((event: PermissionEvent) => {
    setEvents((prev) => {
      const next = [event, ...prev].slice(0, MAX_EVENTS);
      for (const fn of listenersRef.current) fn(next);
      return next;
    });
    // Mirror into the global agent log so the Logs tab also sees it.
    agentLogs.push({
      source: "system",
      level: event.decision.includes("denied") ? "warn" : "info",
      summary: `[permission] ${event.decision} · ${event.action} · ${event.target}`,
      detail: event.reason,
    });
  }, []);

  const recordEvent = useCallback(
    (event: Omit<PermissionEvent, "id" | "timestamp">) => {
      pushEvent({
        ...event,
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
      });
    },
    [pushEvent],
  );

  // When the modal closes (pending becomes null), pull the next queued
  // request — only one dialog at a time so the user can read each one.
  const advanceQueue = useCallback(() => {
    if (queueRef.current.length === 0) {
      setPending(null);
      return;
    }
    setPending(queueRef.current.shift() ?? null);
  }, []);

  const requestApproval = useCallback(
    (req: Omit<PendingRequest, "id" | "resolve" | "risk">) => {
      return new Promise<ApprovalChoice>((resolve) => {
        const full: PendingRequest = {
          ...req,
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          risk: RISK_BY_ACTION[req.action] ?? "medium",
          resolve,
        };
        // Show immediately if nothing else is on screen, otherwise queue.
        setPending((prev) => {
          if (!prev) return full;
          queueRef.current.push(full);
          return prev;
        });
        // Fire desktop notification when window is in the background so
        // the user actually knows the agent is waiting on them — this is
        // the whole point of the system.
        if (
          settingsRef.current.desktopNotifications &&
          typeof document !== "undefined" &&
          document.visibilityState !== "visible"
        ) {
          void ensureNotificationPermission().then((perm) => {
            if (perm === "granted") {
              showDesktopNotification(
                "Agent is waiting for your approval",
                `${req.action}: ${req.target.slice(0, 80)}`,
              );
            }
          });
        }
      });
    },
    [],
  );

  const respond = useCallback(
    (choice: ApprovalChoice) => {
      const current = pending;
      if (!current) return;

      // If user said "always", flip the relevant permission default to allow
      // (or deny, if they pick deny — but "always-deny" isn't currently
      // exposed; "deny" is per-request). This makes future runs frictionless.
      if (choice === "always") {
        const patch: Partial<typeof settingsRef.current.permissions> = {};
        switch (current.action) {
          case "shell":
          case "shellSafe":
            patch.shell = "allow";
            break;
          case "fileRead":
            patch.fileRead = "allow";
            patch.fileReadScope = "anywhere";
            break;
          case "fileWrite":
            patch.fileWrite = "allow";
            patch.fileWriteScope = "anywhere";
            break;
          case "internet":
            patch.internet = "allow";
            break;
          case "script":
            patch.script = "allow";
            break;
        }
        update({ permissions: { ...settingsRef.current.permissions, ...patch } });
      }

      const decision: PermissionEvent["decision"] =
        choice === "deny"
          ? "denied"
          : choice === "always"
            ? "always-allowed"
            : choice === "session"
              ? "session-allowed"
              : "allowed";

      recordEvent({
        action: current.action,
        target: current.target,
        decision,
        prompted: true,
        reason: current.reason,
      });

      current.resolve(choice);
      advanceQueue();
    },
    [pending, recordEvent, update, advanceQueue],
  );

  const subscribe = useCallback((fn: (e: PermissionEvent[]) => void) => {
    listenersRef.current.add(fn);
    fn(events);
    return () => { listenersRef.current.delete(fn); };
  }, [events]);

  const clearEvents = useCallback(() => setEvents([]), []);

  const value = useMemo<PermissionsContextValue & { _respond: (c: ApprovalChoice) => void }>(
    () => ({
      pending,
      events,
      requestApproval,
      recordEvent,
      subscribe,
      clearEvents,
      _respond: respond,
    }),
    [pending, events, requestApproval, recordEvent, subscribe, clearEvents, respond],
  );

  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  );
};

export const usePermissions = () => {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error("usePermissions must be used within PermissionsProvider");
  return ctx;
};

/** Internal hook for the ApprovalDialog to dispatch the user's choice. */
export const useRespondToPending = () => {
  const ctx = useContext(PermissionsContext) as
    | (PermissionsContextValue & { _respond: (c: ApprovalChoice) => void })
    | null;
  if (!ctx) throw new Error("useRespondToPending must be used within PermissionsProvider");
  return ctx._respond;
};
