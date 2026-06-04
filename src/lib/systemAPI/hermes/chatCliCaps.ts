/**
 * Parse `hermes chat --help` output for optional flags we rely on.
 * One-shot prompts always use `-q` / `--query` per Hermes CLI reference
 * (do not use `-p` here — in Hermes, `-p` is the global profile selector).
 */
export type HermesChatCliCaps = {
  supportsNoColor: boolean;
  /** Programmatic mode — less banner/spinner noise in transcripts. */
  supportsQuiet: boolean;
};

export const DEFAULT_HERMES_CHAT_CAPS: HermesChatCliCaps = {
  supportsNoColor: true,
  supportsQuiet: false,
};

/** Unit-testable parser; keep regexes conservative to avoid false positives. */
export function parseHermesChatHelp(helpText: string): HermesChatCliCaps {
  const out = helpText || '';
  return {
    supportsNoColor: /--no-color\b/.test(out),
    supportsQuiet: /(?:--quiet\b|-Q\b)/.test(out),
  };
}
