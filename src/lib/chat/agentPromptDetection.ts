export interface AgentPromptOption {
  value: string;
  label: string;
  description?: string;
}

export interface AgentPromptDetection {
  prompt: string;
  context: string;
  inputKind: "choice" | "text";
  options: AgentPromptOption[];
  timeoutSeconds: number;
}

const QUESTION_RE =
  /\b(which|what|choose|select|pick|enter|provide|type|send|confirm)\b[^?\n]{0,180}\?/i;

const REQUIRED_INPUT_RE =
  /\b(what(?:'s| is) your|enter|provide|type|send)\b[^?\n]{0,220}\?/i;

const AUTO_DECIDE_TIMEOUT_RE = /clarify\s+timed\s+out\s+after\s+(\d+)s|timeout\s+after\s+(\d+)s|within\s+(\d+)\s*seconds/i;

const normalizeLine = (line: string) =>
  line
    .replace(/\r/g, "")
    .replace(/^\s*(?:[-*]\s*)?/, "")
    .trim();

const stripAnsi = (s: string) =>
  s
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, "")
    .replace(/\x1b[@-Z\\-_]/g, "");

const extractTimeoutSeconds = (text: string): number => {
  const match = text.match(AUTO_DECIDE_TIMEOUT_RE);
  const raw = match?.[1] || match?.[2] || match?.[3];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120;
};

const extractNumberedOptions = (lines: string[]): AgentPromptOption[] => {
  const options: AgentPromptOption[] = [];
  for (const line of lines) {
    const normalized = normalizeLine(line);
    const match = normalized.match(/^(\d{1,2})[\).:)-]\s+(.{3,220})$/);
    if (!match) continue;
    const [, value, body] = match;
    const parts = body.split(/\s+[—-]\s+/);
    options.push({
      value,
      label: parts[0].trim(),
      description: parts.slice(1).join(" - ").trim() || undefined,
    });
  }
  return options;
};

const extractLetterOptions = (lines: string[]): AgentPromptOption[] => {
  const options: AgentPromptOption[] = [];
  for (const line of lines) {
    const normalized = normalizeLine(line);
    const match = normalized.match(/^\[?([A-Za-z])\]?[\).:-]\s+(.{3,160})$/);
    if (!match) continue;
    const [, value, label] = match;
    options.push({ value, label: label.trim() });
  }
  return options;
};

const lastQuestionLine = (lines: string[]): string | null => {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = normalizeLine(lines[i]);
    if (line.length > 260) continue;
    if (QUESTION_RE.test(line) || REQUIRED_INPUT_RE.test(line)) return line;
  }
  return null;
};

const isAgentWaitingContext = (text: string, question: string, options: AgentPromptOption[]): boolean => {
  if (/clarify\s+timed\s+out/i.test(text)) return false;
  if (options.length >= 2) return true;
  if (QUESTION_RE.test(question) || REQUIRED_INPUT_RE.test(question)) return true;
  if (/\bclarify\b/i.test(text) && !/clarify\s+timed\s+out/i.test(text)) return true;
  return false;
};

export const detectAgentPrompt = (buffer: string): AgentPromptDetection | null => {
  const clean = stripAnsi(buffer)
    .replace(/\s+(\d{1,2}[\).:-]\s+)/g, "\n$1")
    .replace(/\s+((?:Which|What(?:'s| is)|Choose|Select|Pick|Enter|Provide|Type|Send|Confirm)\b[^?\n]{0,220}\?)/gi, "\n$1");
  const lines = clean
    .split("\n")
    .map((line) => line.replace(/\r/g, ""))
    .filter((line) => line.trim());

  if (lines.length === 0) return null;

  const recentLines = lines.slice(-28);
  const recent = recentLines.join("\n");
  const question = lastQuestionLine(recentLines);
  if (!question) return null;

  const numbered = extractNumberedOptions(recentLines);
  const lettered = numbered.length >= 2 ? [] : extractLetterOptions(recentLines);
  const options = numbered.length >= 2 ? numbered : lettered;
  if (!isAgentWaitingContext(recent, question, options)) return null;

  const contextStart = Math.max(
    0,
    recentLines.findIndex((line) => normalizeLine(line) === question) - 10,
  );
  const context = recentLines
    .slice(contextStart)
    .join("\n")
    .trim()
    .slice(-2000);

  return {
    prompt: question,
    context,
    inputKind: options.length >= 2 ? "choice" : "text",
    options,
    timeoutSeconds: extractTimeoutSeconds(recent),
  };
};

export const promptDetectionSignature = (detected: AgentPromptDetection): string =>
  `${detected.inputKind}:${detected.prompt}:${detected.options.map((option) => option.value).join(",")}`;
