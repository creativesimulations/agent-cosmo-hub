import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { systemAPI } from "@/lib/systemAPI";
import { DEFAULT_PERMISSIONS, type PermissionsConfig } from "@/lib/permissions";
import type { CapabilityChoice } from "@/lib/capabilities";

/**
 * App-wide user preferences. Persisted to localStorage, applied immediately
 * (theme is set on <html> on every change), and consumed by ChatContext,
 * Index (auto-start), UpdateManager (auto-check), SubAgents (notifications),
 * and SettingsPage itself.
 *
 * Adding a new setting:
 *   1. Add the field + default below in DEFAULTS.
 *   2. Read it via `useSettings().settings.<field>` from any consumer.
 *   3. Update it via `useSettings().update({ <field>: value })`.
 */

export type ThemeMode = "dark" | "light" | "system";

export interface AppSettings {
  theme: ThemeMode;
  autoStartAgent: boolean;
  autoResumeSession: boolean;
  desktopNotifications: boolean;
  soundOnReply: boolean;
  notifyOnSubAgentComplete: boolean;
  /** 0 = unlimited */
  maxStoredMessages: number;
  autoCheckUpdates: boolean;
  /** Keep the agent running when the user closes the app window. */
  runInBackground: boolean;
  /**
   * Per-prompt timeout (in seconds) for `hermes chat`. Long agent runs
   * (sub-agents, multi-tool turns, file generation) can easily exceed the
   * default 3 min, so we expose this as a user-tunable setting. Range is
   * enforced in the UI: 60–1800 seconds.
   */
  chatTimeoutSec: number;
  /**
   * Per-action permission defaults the agent enforces without asking.
   * See src/lib/permissions.ts for the full shape and what each field does.
   * "Ask each time" surfaces a glass approval dialog instead of a silent
   * deny — historically the agent would hang on its built-in
   * `[o]nce | [s]ession | [a]lways | [d]eny` prompt with no UI surface,
   * and the user never knew why their task failed.
   */
  permissions: PermissionsConfig;
  /**
   * Per-capability user policy. Key is the capability id (see
   * `src/lib/capabilities.ts`), value is one of `ask | allow | session | deny`.
   * Auto-generated entries (skills/observed tools) are added on first use.
   * Missing entries fall back to DEFAULT_CAPABILITY_POLICY in the registry.
   */
  capabilityPolicy: Record<string, CapabilityChoice>;
}

const STORAGE_KEY = "ronbot-settings-v1";

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  // Behavior — all on by default so the agent feels "always ready".
  autoStartAgent: true,
  autoResumeSession: true,
  // Notifications — opt-out, since users explicitly want to know when the
  // agent replies / sub-agents finish, especially when running in tray.
  desktopNotifications: true,
  soundOnReply: true,
  notifyOnSubAgentComplete: true,
  maxStoredMessages: 200,
  autoCheckUpdates: true,
  // Keep the agent alive when the window is closed by default — closing the
  // window now hides to the system tray instead of quitting outright.
  runInBackground: true,
  // 10 minutes — generous enough for multi-step / sub-agent runs without
  // hanging the UI forever if the agent truly stalls.
  chatTimeoutSec: 600,
  permissions: DEFAULT_PERMISSIONS,
  capabilityPolicy: {},
};

interface SettingsContextValue {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  reset: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const loadSettings = (): AppSettings => {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    // Merge nested permissions so newly-added permission fields pick up
    // their defaults instead of being undefined for existing users.
    const permissions = { ...DEFAULT_PERMISSIONS, ...(parsed?.permissions || {}) };
    return { ...DEFAULT_SETTINGS, ...parsed, permissions };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

const applyTheme = (mode: ThemeMode) => {
  if (typeof document === "undefined") return;
  const resolved =
    mode === "system"
      ? (window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark")
      : mode;
  const root = document.documentElement;
  root.classList.toggle("light", resolved === "light");
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
};

// Disk mirror — packaged Electron's file:// localStorage can get wiped on
// upgrades/rebuilds, so we also persist settings to ~/.ronbot/settings.json
// and re-hydrate from there on launch when localStorage is empty.
const DISK_SETTINGS_PATH = ".ronbot/settings.json";

const resolveSettingsDiskPath = async (): Promise<string | null> => {
  if (typeof window === "undefined" || !window.electronAPI) return null;
  try {
    const platform = await window.electronAPI.getPlatform();
    const sep = platform.isWindows ? "\\" : "/";
    return `${platform.homeDir}${sep}${DISK_SETTINGS_PATH.replace(/\//g, sep)}`;
  } catch {
    return null;
  }
};

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  // Tracks whether we've finished the one-shot disk hydration so we don't
  // overwrite the disk file with localStorage defaults before we've checked
  // for a richer disk copy.
  const hydratedFromDiskRef = useRef(false);

  // One-shot disk hydration: if localStorage was empty/missing and disk has a
  // saved copy, restore it. Runs once on mount.
  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI) {
      hydratedFromDiskRef.current = true;
      return;
    }
    let cancelled = false;
    void (async () => {
      const fullPath = await resolveSettingsDiskPath();
      if (!fullPath) { hydratedFromDiskRef.current = true; return; }
      const result = await window.electronAPI!.readFile(fullPath).catch(() => null);
      if (!cancelled && result?.success && result.content) {
        try {
          const parsed = JSON.parse(result.content);
          if (parsed && typeof parsed === "object") {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            // localStorage already has a saved copy → it was written by this
            // same session, prefer it. Otherwise restore from disk and merge
            // over defaults so newly-added keys still get a value.
            if (!raw) setSettings({ ...DEFAULT_SETTINGS, ...parsed });
          }
        } catch { /* corrupt file — ignore */ }
      }
      hydratedFromDiskRef.current = true;
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist on every change to BOTH localStorage and the disk mirror.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const serialized = JSON.stringify(settings);
    try { window.localStorage.setItem(STORAGE_KEY, serialized); } catch { /* */ }

    // Skip the disk write until we've checked for an existing disk copy,
    // otherwise we'd clobber it with defaults on first paint.
    if (window.electronAPI && hydratedFromDiskRef.current) {
      void (async () => {
        const fullPath = await resolveSettingsDiskPath();
        if (!fullPath) return;
        try {
          const sep = fullPath.includes("\\") ? "\\" : "/";
          const parent = fullPath.substring(0, fullPath.lastIndexOf(sep));
          if (parent) await window.electronAPI!.mkdir(parent);
        } catch { /* best effort */ }
        await window.electronAPI!.writeFile(fullPath, serialized).catch(() => { /* best effort */ });
      })();
    }
  }, [settings]);

  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  // React to OS theme changes when user picked "system".
  useEffect(() => {
    if (settings.theme !== "system" || typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = () => applyTheme("system");
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, [settings.theme]);

  // Mirror runInBackground to the Electron main process so closing the
  // window hides to tray (instead of quitting and killing the agent).
  useEffect(() => {
    void systemAPI.setRunInBackground(settings.runInBackground);
  }, [settings.runInBackground]);

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const reset = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
  }, []);

  const value = useMemo(() => ({ settings, update, reset }), [settings, update, reset]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

export const useSettings = () => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
};
