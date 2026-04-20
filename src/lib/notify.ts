/**
 * Tiny wrapper around the Web Notification API + an optional reply chime.
 *
 * Both features are opt-in via Settings. The functions are safe to call even
 * when the user has them disabled — they no-op silently — so callers don't
 * need to gate every site.
 */

import type { AppSettings } from "@/contexts/SettingsContext";

let chimeUnlocked = false;
let audioCtx: AudioContext | null = null;

const ensureAudio = (): AudioContext | null => {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  return audioCtx;
};

/**
 * Browsers require a user gesture before the AudioContext can produce sound.
 * Call this from a click handler at least once per session (the Settings
 * "Test sound" button does it).
 */
export const unlockChime = () => {
  chimeUnlocked = true;
  const ctx = ensureAudio();
  if (ctx && ctx.state === "suspended") void ctx.resume();
};

export const playReplyChime = () => {
  const ctx = ensureAudio();
  if (!ctx) return;
  if (!chimeUnlocked && ctx.state === "suspended") return;
  try {
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, t0);
    osc.frequency.exponentialRampToValueAtTime(1320, t0 + 0.12);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.4);
  } catch {
    /* ignore */
  }
};

export const ensureNotificationPermission = async (): Promise<NotificationPermission> => {
  if (typeof window === "undefined" || !("Notification" in window)) return "denied";
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
};

export const showDesktopNotification = (title: string, body: string) => {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  // Only show when the window is hidden / unfocused — otherwise the user can
  // already see the new content and a popup would just be noise.
  if (typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus()) {
    return;
  }
  try {
    const n = new Notification(title, { body, silent: true });
    setTimeout(() => n.close(), 6000);
  } catch {
    /* ignore */
  }
};

/** Convenience: react to a chat reply respecting both sound + desktop toggles. */
export const handleAgentReplyArrived = (
  settings: Pick<AppSettings, "soundOnReply" | "desktopNotifications">,
  preview: string,
) => {
  if (settings.soundOnReply) playReplyChime();
  if (settings.desktopNotifications) {
    showDesktopNotification("Agent reply ready", preview.slice(0, 140));
  }
};
