// Hermes v0.13.0 sync — May 2026 (Ronbot)
/** Stream timeouts for staged Hermes install (idle = no output; timeout 0 = no hard cap). */

export const INSTALL_CORE_STREAM = {
  timeout: 0,
  idleTimeoutMs: 10 * 60_000,
} as const;

export const INSTALL_BROWSER_STREAM = {
  timeout: 0,
  idleTimeoutMs: 15 * 60_000,
} as const;
