import { detectToolCalls } from "@/lib/toolUseDetection";
import { extractDelegationGoal } from "@/lib/chat/streamGoals";
import { liveSubAgents } from "@/lib/liveSubAgents";

/** Regexes for permission-relevant tool names in streamed Hermes output. */
export const CHAT_ACTIVITY_PATTERNS = {
  shell: /\b(run_shell|shell\.run|exec_shell|bash_command|tool:\s*shell)\b/gi,
  fileWrite: /\b(write_file|file\.write|create_file|edit_file|patch_file|append_file|tool:\s*write)\b/gi,
  fileRead: /\b(read_file|file\.read|view_file|cat_file|tool:\s*read)\b/gi,
  internet:
    /\b(fetch_url|http\.get|http\.post|web_fetch|web_search|browse_url|tool:\s*(?:fetch|browse|search))\b/gi,
  script: /\b(run_python|run_node|run_script|execute_script|tool:\s*(?:python|node|script))\b/gi,
} as const;

export type ActivityThisTurn = {
  shell: number;
  fileWrite: number;
  fileRead: number;
  internet: number;
  script: number;
};

export type ChatStreamHandlerDeps = {
  recordUse: (capabilityId: string) => void;
  setLiveSubAgentCount: (n: number) => void;
};

/**
 * Mutable per-turn state for parsing streamed stdout/stderr from `hermes chat`.
 * Used by ChatContext's serial queue worker.
 */
export class ChatStreamTurnState {
  streamBuf = "";
  readonly turnLiveIds: string[] = [];
  readonly activityThisTurn: ActivityThisTurn = {
    shell: 0,
    fileWrite: 0,
    fileRead: 0,
    internet: 0,
    script: 0,
  };
  approvalPromptSeen = 0;
  readonly usedCapsThisTurn = new Set<string>();
  private liveCount = 0;

  handleChunk(
    chunk: { type: string; data?: string },
    { recordUse, setLiveSubAgentCount }: ChatStreamHandlerDeps,
  ): void {
    if ((chunk.type !== "stdout" && chunk.type !== "stderr") || !chunk.data) return;
    this.streamBuf = (this.streamBuf + chunk.data).slice(-8000);

    if (
      /Choice\s*\[\s*o\s*\/\s*s\s*\/\s*a/i.test(chunk.data) ||
      /\[\s*o\s*\]\s*nce.*\[\s*s\s*\]\s*ession/i.test(chunk.data) ||
      /Approve\??\s*\(\s*o\s*\/\s*s\s*\/\s*a/i.test(chunk.data) ||
      /Permission\s+required/i.test(chunk.data) ||
      /Awaiting\s+approval/i.test(chunk.data)
    ) {
      this.approvalPromptSeen += 1;
    }

    for (const k of Object.keys(CHAT_ACTIVITY_PATTERNS) as Array<keyof typeof CHAT_ACTIVITY_PATTERNS>) {
      const m = chunk.data.match(CHAT_ACTIVITY_PATTERNS[k]);
      if (m) {
        this.activityThisTurn[k] += m.length;
        this.usedCapsThisTurn.add(k);
        recordUse(k);
      }
    }

    const toolHits = detectToolCalls(chunk.data);
    for (const hit of toolHits) {
      if (!this.usedCapsThisTurn.has(hit.capabilityId)) {
        this.usedCapsThisTurn.add(hit.capabilityId);
        recordUse(hit.capabilityId);
      }
    }

    const spawnRe =
      /\b(delegate_task|sub[-_ ]?agent\.start|spawn(?:ed)?\s+(?:sub[-_ ]?agent|child\s+agent))\b/gi;
    const spawnMatches = chunk.data.match(spawnRe);
    if (spawnMatches?.length) {
      const batchGoals: string[] = [];
      const tasksBlock = this.streamBuf.match(/tasks\s*=\s*\[([\s\S]{0,4000}?)\]/i);
      if (tasksBlock) {
        const inner = tasksBlock[1];
        const goalRe =
          /["']?(?:goal|task|prompt|instruction|description|objective)["']?\s*[:=]\s*["']([^"']{3,400})["']/gi;
        let gm: RegExpExecArray | null;
        while ((gm = goalRe.exec(inner)) !== null) {
          batchGoals.push(gm[1].trim());
        }
      }
      for (let i = 0; i < spawnMatches.length; i++) {
        const goal = batchGoals[i] || extractDelegationGoal(this.streamBuf);
        const id = liveSubAgents.spawn(goal);
        this.turnLiveIds.push(id);
      }
      this.liveCount += spawnMatches.length;
      setLiveSubAgentCount(this.liveCount);
    }

    if (this.turnLiveIds.length) {
      const lateGoal = extractDelegationGoal(this.streamBuf);
      if (lateGoal !== "(no goal captured)") {
        for (const id of this.turnLiveIds) {
          const current = liveSubAgents.list().find((s) => s.id === id);
          if (current && current.goal === "(no goal captured)") {
            liveSubAgents.updateGoal(id, lateGoal);
          }
        }
      }
    }

    const completeRe =
      /\b(sub[-_ ]?agent\.complete|delegation\s+(?:complete|finished|done)|child[-_ ]?agent\b[^.\n]*\b(?:complete|finished|done))\b/gi;
    const completeMatches = chunk.data.match(completeRe);
    if (completeMatches) {
      for (let i = 0; i < completeMatches.length; i++) {
        const id = this.turnLiveIds.shift();
        if (id) liveSubAgents.complete(id);
      }
    }

    const failRe =
      /\b(sub[-_ ]?agent\.(?:failed|error|denied)|delegation\s+(?:failed|denied|errored)|child[-_ ]?agent\b[^.\n]*\b(?:failed|denied|crashed))\b/gi;
    const failMatches = chunk.data.match(failRe);
    if (failMatches) {
      for (let i = 0; i < failMatches.length; i++) {
        const id = this.turnLiveIds.shift();
        if (id) {
          const reasonM = chunk.data.match(/(?:reason|error|denied)\s*[:=]\s*["']?([^"'\n]{3,200})/i);
          liveSubAgents.fail(id, reasonM?.[1]);
        }
      }
    }
  }
}
