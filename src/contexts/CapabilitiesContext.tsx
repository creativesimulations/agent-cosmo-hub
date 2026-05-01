import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { systemAPI } from "@/lib/systemAPI";
import {
  BUILTIN_CAPABILITIES,
  buildRegistry,
  CapabilityChoice,
  CapabilityDefinition,
  DEFAULT_CAPABILITY_POLICY,
  DiscoveredSkill,
  assessReadiness,
  CapabilityReadiness,
} from "@/lib/capabilities";
import { useSettings } from "./SettingsContext";
import { usePermissions } from "./PermissionsContext";
import { useAgentConnection } from "./AgentConnectionContext";
import { capabilityProbe, type CapabilityProbeResult } from "@/lib/capabilityProbe";
import {
  discoverCapabilities,
  invalidateDiscoveryCache,
} from "@/lib/capabilities/discovery";
import type { DiscoveredCapability } from "@/lib/capabilities/types";
import { SEED_CAPABILITIES } from "@/lib/capabilities/seed";

/**
 * CapabilitiesContext is the runtime façade for the Capability Registry.
 *
 *   - On mount (and when the agent reconnects) it discovers installed
 *     skills + stored secrets and merges them with the built-in catalog.
 *   - It exposes `gate(capId, target, reason)` — the proactive gate the
 *     ChatContext calls when it detects an outbound tool announcement.
 *   - It tracks per-session "allow this session" decisions so the user
 *     isn't prompted again until the app reloads.
 *   - It exposes a `recentlyUsed` map so chat bubbles can show "🌐 Used
 *     web search" chips for capabilities consumed this turn.
 *   - It also handles REACTIVE gating: when a tool failure is detected
 *     post-hoc, `gateAfterFailure(hit)` shows the same dialog so the
 *     user can train the policy with one click.
 *
 * Backward compatibility: this layer is purely additive — the existing
 * `settings.permissions` block (shell/internet/etc.) remains the source
 * of truth for the agent-side YAML config. CapabilityPolicy reflects
 * the same defaults for the system capabilities AND adds new entries
 * for browser, search, image gen, etc.
 */

interface ObservedToolUse {
  capabilityId: string;
  /** ms timestamp of the most recent invocation. */
  lastUsed: number;
  /** Total times observed this session. */
  count: number;
}

interface PendingDecision {
  capabilityId: string;
  probe: CapabilityProbeResult;
  /** Optional human-readable context shown above the checklist. */
  context?: string;
}

interface CapabilitiesContextValue {
  /** Live merged registry: built-ins + skills + observed. */
  registry: Record<string, CapabilityDefinition>;
  /** Per-capability stored choice (defaults pulled from settings). */
  policy: Record<string, CapabilityChoice>;
  /** Update one capability's policy (persists into settings). */
  setPolicy: (id: string, choice: CapabilityChoice) => void;
  /** Reset every capability to "ask". */
  resetAll: () => void;
  /** Capabilities used at least once this app session — for chat chips. */
  recentlyUsed: Record<string, ObservedToolUse>;
  /** Per-capability readiness (key/skill availability). */
  readinessFor: (id: string) => CapabilityReadiness;
  /** Re-run discovery (call after enabling a skill or adding a secret). */
  rediscover: () => Promise<void>;
  /**
   * Proactive gate. Called by the chat worker when a tool-call marker is
   * detected. Returns true if the agent may proceed, false if denied.
   * If policy is "ask", opens the existing approval dialog.
   */
  gate: (capabilityId: string, target: string, reason?: string) => Promise<boolean>;
  /** Record that a capability was used (for chat-chip display). */
  recordUse: (capabilityId: string) => void;
  /** Currently open capability decision dialog (null if none). */
  pendingDecision: PendingDecision | null;
  /** Open the capability approval/fix dialog with a probe result. */
  openCapabilityDecision: (capabilityId: string, probe: CapabilityProbeResult, context?: string) => void;
  /** Close the dialog without changing policy. */
  closePendingDecision: () => void;
  /** Grant a capability for this session only. */
  grantSession: (capabilityId: string) => void;
  /** Number of capabilities currently in a "needs setup" state — drives the sidebar dot. */
  pendingDecisionsCount: number;
  /** Latest probe results, keyed by capability id (for badge counting). */
  probeResults: Record<string, CapabilityProbeResult>;
  /** Re-run probes for all web-class capabilities (refreshes badge count). */
  refreshProbes: () => Promise<void>;
  /**
   * Live agent-discovered registry: channels, tools, connectors, skills.
   * Built from `hermes capabilities --json` + installed skills + a seed
   * fallback. Drives Dashboard tiles, Channels page, slash palette.
   */
  discovered: Record<string, DiscoveredCapability>;
  /** True once at least one Hermes CLI discovery call has succeeded. */
  discoveryFromHermes: boolean;
}

const CapabilitiesContext = createContext<CapabilitiesContextValue | null>(null);

const SESSION_GRANTS_KEY = "ronbot-capability-session-grants-v1";

export const CapabilitiesProvider = ({ children }: { children: ReactNode }) => {
  const { settings, update } = useSettings();
  const { requestApproval, recordEvent } = usePermissions();
  const { connected: agentConnected } = useAgentConnection();

  const [installedSkills, setInstalledSkills] = useState<DiscoveredSkill[]>([]);
  const [storedSecretKeys, setStoredSecretKeys] = useState<string[]>([]);
  const [observedTools, setObservedTools] = useState<string[]>([]);
  const [recentlyUsed, setRecentlyUsed] = useState<Record<string, ObservedToolUse>>({});
  // Session grants live in sessionStorage so they survive HMR but not a real reload.
  const sessionGrantsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(SESSION_GRANTS_KEY);
      if (raw) sessionGrantsRef.current = new Set(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  const persistSessionGrants = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(
        SESSION_GRANTS_KEY,
        JSON.stringify(Array.from(sessionGrantsRef.current)),
      );
    } catch { /* ignore */ }
  }, []);

  // Discovery: pull installed skills + stored secret keys.
  const rediscover = useCallback(async () => {
    try {
      const r = await systemAPI.listSkills?.();
      if (r && r.success && Array.isArray(r.skills)) {
        setInstalledSkills(
          r.skills.map((s) => ({
            name: s.name,
            category: s.category,
            requiredSecrets: s.requiredSecrets,
          })),
        );
      }
    } catch { /* best effort */ }
    try {
      const r = await systemAPI.secrets?.list?.();
      if (r && Array.isArray(r.keys)) {
        setStoredSecretKeys(r.keys);
      }
    } catch { /* best effort */ }
  }, []);

  useEffect(() => {
    void rediscover();
  }, [rediscover, agentConnected]);

  const registry = useMemo(
    () => buildRegistry(installedSkills, observedTools),
    [installedSkills, observedTools],
  );

  // Merge stored policy with defaults so every registry entry has a value.
  const policy = useMemo(() => {
    const stored = settings.capabilityPolicy || {};
    const merged: Record<string, CapabilityChoice> = { ...DEFAULT_CAPABILITY_POLICY };
    for (const id of Object.keys(registry)) {
      merged[id] = (stored[id] as CapabilityChoice) ?? merged[id] ?? "ask";
    }
    // Carry through any stored entries for capabilities not yet in the registry
    // (e.g. user disabled the providing skill but kept the policy).
    for (const [id, val] of Object.entries(stored)) {
      if (!(id in merged)) merged[id] = val as CapabilityChoice;
    }
    return merged;
  }, [registry, settings.capabilityPolicy]);

  const setPolicy = useCallback(
    (id: string, choice: CapabilityChoice) => {
      const next = { ...(settings.capabilityPolicy || {}), [id]: choice };
      update({ capabilityPolicy: next });
      // Clear any session grant for this id so the new policy takes effect immediately.
      if (sessionGrantsRef.current.has(id)) {
        sessionGrantsRef.current.delete(id);
        persistSessionGrants();
      }
    },
    [settings.capabilityPolicy, update, persistSessionGrants],
  );

  const resetAll = useCallback(() => {
    update({ capabilityPolicy: {} });
    sessionGrantsRef.current.clear();
    persistSessionGrants();
  }, [update, persistSessionGrants]);

  const readinessFor = useCallback(
    (id: string): CapabilityReadiness => {
      const cap = registry[id];
      if (!cap) {
        return { ready: false, reason: "Unknown capability", missingSecret: false, missingSkill: false };
      }
      return assessReadiness(cap, storedSecretKeys, installedSkills);
    },
    [registry, storedSecretKeys, installedSkills],
  );

  const recordUse = useCallback((capabilityId: string) => {
    setRecentlyUsed((prev) => {
      const cur = prev[capabilityId];
      return {
        ...prev,
        [capabilityId]: {
          capabilityId,
          lastUsed: Date.now(),
          count: (cur?.count || 0) + 1,
        },
      };
    });
    // Remember unknown tool names so the registry surfaces them.
    if (capabilityId.startsWith("observed:")) {
      const name = capabilityId.slice("observed:".length);
      setObservedTools((prev) => (prev.includes(name) ? prev : [...prev, name]));
    }
  }, []);

  const gate = useCallback(
    async (capabilityId: string, target: string, reason?: string): Promise<boolean> => {
      // Auto-record so the chip shows up later in the message.
      recordUse(capabilityId);

      const choice: CapabilityChoice = (policy[capabilityId] as CapabilityChoice) ?? "ask";
      const cap = registry[capabilityId];
      const label = cap?.label ?? capabilityId;

      if (choice === "allow") {
        recordEvent({
          action: (cap?.id === "shell" ? "shell" : cap?.id === "fileRead" ? "fileRead" : cap?.id === "fileWrite" ? "fileWrite" : cap?.id === "internet" ? "internet" : cap?.id === "script" ? "script" : "shell") as never,
          target: `[${label}] ${target}`.slice(0, 200),
          decision: "auto-allowed",
          prompted: false,
          reason,
        });
        return true;
      }
      if (choice === "deny") {
        recordEvent({
          action: "shell" as never,
          target: `[${label}] ${target}`.slice(0, 200),
          decision: "auto-denied",
          prompted: false,
          reason,
        });
        return false;
      }
      if (choice === "session" && sessionGrantsRef.current.has(capabilityId)) {
        return true;
      }

      // ask (or session not yet granted) — open the dialog. We re-use the
      // existing PermissionsContext dialog by mapping our capability id to
      // a permission action; the dialog UI is the same shape.
      const fakeAction =
        capabilityId === "shell" || capabilityId === "fileRead" || capabilityId === "fileWrite" ||
        capabilityId === "internet" || capabilityId === "script"
          ? capabilityId
          : "internet"; // internet is the safest visual default for "tool needing approval"
      const userChoice = await requestApproval({
        action: fakeAction as never,
        target: `[${label}] ${target}`,
        reason: reason ?? cap?.description,
      });
      if (userChoice === "always") {
        setPolicy(capabilityId, "allow");
        return true;
      }
      if (userChoice === "session") {
        sessionGrantsRef.current.add(capabilityId);
        persistSessionGrants();
        return true;
      }
      if (userChoice === "once") return true;
      return false;
    },
    [policy, registry, requestApproval, recordEvent, setPolicy, persistSessionGrants, recordUse],
  );

  // ── Capability decision dialog state ──
  const [pendingDecision, setPendingDecision] = useState<PendingDecision | null>(null);
  const [probeResults, setProbeResults] = useState<Record<string, CapabilityProbeResult>>({});

  const openCapabilityDecision = useCallback(
    (capabilityId: string, probe: CapabilityProbeResult, context?: string) => {
      setProbeResults((prev) => ({ ...prev, [capabilityId]: probe }));
      setPendingDecision({ capabilityId, probe, context });
    },
    [],
  );
  const closePendingDecision = useCallback(() => setPendingDecision(null), []);
  const grantSession = useCallback(
    (capabilityId: string) => {
      sessionGrantsRef.current.add(capabilityId);
      persistSessionGrants();
    },
    [persistSessionGrants],
  );

  const refreshProbes = useCallback(async () => {
    // Probe every web/media/communication capability so probe data is
    // available when something opens the decision dialog. The badge count
    // below is much more conservative — see pendingDecisionsCount.
    const targets = Object.values(registry).filter(
      (c) => c.group === "web" || c.group === "media" || c.group === "communication",
    );
    const next: Record<string, CapabilityProbeResult> = {};
    for (const cap of targets) {
      try {
        next[cap.id] = await capabilityProbe(cap.id);
      } catch { /* skip */ }
    }
    setProbeResults((prev) => ({ ...prev, ...next }));
  }, [registry]);

  // Re-run probes whenever the underlying inputs change (skills, secrets,
  // agent reconnect). Cheap thanks to the 60s probe cache.
  useEffect(() => {
    void refreshProbes();
  }, [refreshProbes, installedSkills, storedSecretKeys, agentConnected]);

  // The sidebar badge should only nag for capabilities the user has
  // actually shown intent to use — not every optional integration we
  // know about (Telegram, ElevenLabs, Google Calendar, …). We count a
  // capability iff:
  //   - it's been used at least once this session (recentlyUsed), OR
  //   - the user has set its policy to "allow" / "session" (explicit opt-in), OR
  //   - it's "webBrowser" or "webSearch" (core web stack the doctor flags).
  const pendingDecisionsCount = useMemo(() => {
    const ALWAYS_NAG = new Set(["webBrowser", "webSearch"]);
    return Object.values(probeResults).filter((p) => {
      if (p.ready || p.reason === "ready") return false;
      if (ALWAYS_NAG.has(p.capabilityId)) return true;
      if (recentlyUsed[p.capabilityId]) return true;
      const choice = policy[p.capabilityId];
      if (choice === "allow" || choice === "session") return true;
      return false;
    }).length;
  }, [probeResults, recentlyUsed, policy]);

  const value = useMemo(
    () => ({
      registry,
      policy,
      setPolicy,
      resetAll,
      recentlyUsed,
      readinessFor,
      rediscover,
      gate,
      recordUse,
      pendingDecision,
      openCapabilityDecision,
      closePendingDecision,
      grantSession,
      pendingDecisionsCount,
      probeResults,
      refreshProbes,
    }),
    [
      registry, policy, setPolicy, resetAll, recentlyUsed, readinessFor, rediscover, gate, recordUse,
      pendingDecision, openCapabilityDecision, closePendingDecision, grantSession,
      pendingDecisionsCount, probeResults, refreshProbes,
    ],
  );

  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>;
};

export const useCapabilities = () => {
  const ctx = useContext(CapabilitiesContext);
  if (!ctx) throw new Error("useCapabilities must be used within CapabilitiesProvider");
  return ctx;
};

/** Convenience hook to read a single capability's policy + readiness. */
export const useCapability = (id: string) => {
  const { registry, policy, readinessFor, setPolicy } = useCapabilities();
  return {
    cap: registry[id] ?? BUILTIN_CAPABILITIES.find((c) => c.id === id),
    choice: (policy[id] as CapabilityChoice) ?? "ask",
    readiness: readinessFor(id),
    setChoice: (c: CapabilityChoice) => setPolicy(id, c),
  };
};
