/**
 * Live sub-agent activity bus.
 *
 * Hermes only writes sub-agent events to ~/.hermes/logs/agent.log when file
 * logging is enabled — and even then there's a multi-second flush delay. But
 * the parent agent's chat stdout already mentions every spawn (via the
 * delegate_task tool call), so we can detect them in real time as they fly
 * past in the streamed chat output.
 *
 * ChatContext is the sole producer (it watches the in-flight Hermes process'
 * stdout/stderr). The SubAgents tab is the consumer — it merges these live
 * events with whatever it can also parse out of agent.log so the user sees
 * activity even when file logging is off.
 *
 * Events are kept in-memory only; on app reload everything visible here is
 * gone (the persistent record lives in agent.log when logging is on).
 */

export type LiveSubAgentStatus = "running" | "completed" | "failed";

export interface LiveSubAgent {
  id: string;
  goal: string;
  startedAt: string; // ISO
  endedAt?: string;
  status: LiveSubAgentStatus;
  reason?: string; // for failures
  /** Short human-readable last activity ("using a tool", "thinking", etc.) */
  lastEvent?: string;
}

type Listener = (snapshot: LiveSubAgent[]) => void;

class LiveSubAgentStore {
  private items = new Map<string, LiveSubAgent>();
  private listeners = new Set<Listener>();

  list(): LiveSubAgent[] {
    return Array.from(this.items.values()).sort((a, b) =>
      a.startedAt < b.startedAt ? 1 : -1,
    );
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.list());
    return () => { this.listeners.delete(fn); };
  }

  spawn(goal: string): string {
    const id = `live-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.items.set(id, {
      id,
      goal: goal.slice(0, 400),
      startedAt: new Date().toISOString(),
      status: "running",
    });
    this.emit();
    return id;
  }

  complete(id: string) {
    const item = this.items.get(id);
    if (!item) return;
    item.status = "completed";
    item.endedAt = new Date().toISOString();
    this.emit();
  }

  fail(id: string, reason?: string) {
    const item = this.items.get(id);
    if (!item) return;
    item.status = "failed";
    item.endedAt = new Date().toISOString();
    item.reason = reason;
    this.emit();
  }

  /** Mark all currently-running items as completed. Called when a chat turn
   *  ends without explicit completion markers, since sub-agents always die
   *  with their parent turn. */
  finalizeRunning() {
    let changed = false;
    for (const item of this.items.values()) {
      if (item.status === "running") {
        item.status = "completed";
        item.endedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  noteEvent(id: string, label: string) {
    const item = this.items.get(id);
    if (!item) return;
    item.lastEvent = label;
    this.emit();
  }

  /** Update the goal text for an existing entry. Used when the goal arrives
   *  in the stream slightly after the spawn marker was detected. */
  updateGoal(id: string, goal: string) {
    const item = this.items.get(id);
    if (!item) return;
    const trimmed = goal.trim().slice(0, 400);
    if (!trimmed) return;
    item.goal = trimmed;
    this.emit();
  }

  clearAll() {
    this.items.clear();
    this.emit();
  }

  /** Drop completed/failed items older than 24h to keep the list bounded. */
  prune() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let changed = false;
    for (const [id, item] of this.items) {
      if (item.status !== "running" && item.endedAt && Date.parse(item.endedAt) < cutoff) {
        this.items.delete(id);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  private emit() {
    const snap = this.list();
    for (const fn of this.listeners) fn(snap);
  }
}

export const liveSubAgents = new LiveSubAgentStore();
