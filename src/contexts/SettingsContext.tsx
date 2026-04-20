import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";

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
}

const STORAGE_KEY = "ainoval-settings-v1";

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  autoStartAgent: false,
  autoResumeSession: true,
  desktopNotifications: false,
  soundOnReply: false,
  notifyOnSubAgentComplete: false,
  maxStoredMessages: 200,
  autoCheckUpdates: true,
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
    return { ...DEFAULT_SETTINGS, ...parsed };
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

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  // Persist + apply theme on every change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
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
