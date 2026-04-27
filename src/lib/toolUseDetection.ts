/**
 * Detect outbound tool-call markers in the agent's streamed output so we
 * can gate them PROACTIVELY, before the tool is actually invoked.
 *
 * Hermes (and most agent frameworks) emit recognizable announcements
 * when they're about to call a tool, e.g.:
 *
 *   "tool: web_search"
 *   "Calling browser…"
 *   "using image_gen"
 *   "[tool_call] delegate_task(...)"
 *   "Invoking tool: send_email"
 *
 * This module recognizes those phrasings, normalizes them to a tool
 * name, and the runtime gate in ChatContext maps that name → capability
 * id via `toolNameToCapabilityId`.
 */

import { BUILTIN_CAPABILITIES } from "./capabilities";

export interface ToolCallMarker {
  /** Raw tool name as the agent emitted it. */
  toolName: string;
  /** Capability id the runtime gate should consult. */
  capabilityId: string;
  /** The full snippet that triggered the match (for display). */
  matchedText: string;
}

/**
 * Patterns that announce a tool call. Order matters — most specific
 * first so structured forms ("tool: foo") beat free-form text.
 */
const TOOL_CALL_PATTERNS: RegExp[] = [
  // Structured: "tool: <name>" or "[tool_call] <name>" or "Calling <name> tool"
  /tool[_\s]?call\s*[:\s]+([a-z][a-z0-9_]{2,40})/gi,
  /\btool\s*[:=]\s*([a-z][a-z0-9_]{2,40})/gi,
  /\bcalling\s+(?:the\s+)?([a-z][a-z0-9_]{2,40})\s+(?:tool|skill|capability|function)\b/gi,
  /\binvoking\s+(?:tool|skill)\s*[:\s]*([a-z][a-z0-9_]{2,40})/gi,
  /\busing\s+(?:the\s+)?([a-z][a-z0-9_]{2,40})\s+(?:tool|skill)\b/gi,
  // Function-call form: "web_search(", "image_gen(", "delegate_task("
  /\b([a-z][a-z0-9_]{2,40})\s*\(\s*["']/g,
];

/** Map raw tool names to capability ids. Built from BUILTIN_CAPABILITIES.candidateSkills. */
const TOOL_NAME_TO_CAP_ID: Record<string, string> = {};
for (const cap of BUILTIN_CAPABILITIES) {
  for (const skill of cap.candidateSkills) {
    TOOL_NAME_TO_CAP_ID[skill.toLowerCase()] = cap.id;
  }
}
// Common synonyms that don't appear in candidateSkills.
Object.assign(TOOL_NAME_TO_CAP_ID, {
  // Internet / web
  fetch_url: "internet",
  http_get: "internet",
  http_post: "internet",
  web_fetch: "internet",
  web_extract: "webSearch",
  web_search: "webSearch",
  browse_url: "webBrowser",
  // Browser automation (hermes-cli)
  browser_navigate: "webBrowser",
  browser_click: "webBrowser",
  browser_type: "webBrowser",
  browser_snapshot: "webBrowser",
  browser_screenshot: "webBrowser",
  browser_wait: "webBrowser",
  // Shell
  run_shell: "shell",
  exec_shell: "shell",
  bash_command: "shell",
  shell_command: "shell",
  terminal: "shell",
  // Files
  write_file: "fileWrite",
  create_file: "fileWrite",
  edit_file: "fileWrite",
  patch_file: "fileWrite",
  append_file: "fileWrite",
  read_file: "fileRead",
  view_file: "fileRead",
  cat_file: "fileRead",
  // Scripts / code execution
  run_python: "script",
  run_node: "script",
  execute_script: "script",
  code_execution: "script",
  code_execution_run: "script",
  // Messaging
  send_email: "email",
  send_message: "messaging",
  send_telegram: "messaging",
  send_discord: "messaging",
  send_slack: "messaging",
  messaging_send: "messaging",
  // Media
  generate_image: "imageGen",
  image_gen_create: "imageGen",
  text_to_speech: "voice",
  speak: "voice",
  tts_speak: "voice",
  // Sub-agents / scheduling
  delegation_spawn: "skill:delegation",
  delegate_task: "skill:delegation",
  cronjob_create: "skill:cronjob",
});

/**
 * Resolve a raw tool name to its capability id. Falls back to
 * `observed:<name>` for unknown tools so the user can still gate them.
 */
export const toolNameToCapabilityId = (toolName: string): string => {
  const key = toolName.toLowerCase();
  return TOOL_NAME_TO_CAP_ID[key] ?? `observed:${key}`;
};

/**
 * Scan a stream chunk for tool-call announcements. Returns each unique
 * tool name found (deduped within the chunk) so the gate can prompt
 * once per distinct capability invocation.
 */
export const detectToolCalls = (chunk: string): ToolCallMarker[] => {
  if (!chunk) return [];
  const seen = new Set<string>();
  const hits: ToolCallMarker[] = [];
  for (const re of TOOL_CALL_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(chunk)) !== null) {
      const name = m[1].toLowerCase();
      // Skip obviously bogus matches (very short, common JS keywords).
      if (name.length < 3) continue;
      if (["the", "for", "and", "but", "with", "from", "this", "that", "what", "when"].includes(name)) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      hits.push({
        toolName: name,
        capabilityId: toolNameToCapabilityId(name),
        matchedText: m[0],
      });
    }
  }
  return hits;
};
