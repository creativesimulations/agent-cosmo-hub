/* eslint-disable no-control-regex -- intentional ANSI CSI / OSC stripping */
export const stripAnsi = (s: string) =>
  s
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '');

const BOX_CHARS = /[│┃┆┇┊┋║╎╏╽╿─━┄┅┈┉═╌╍╴╶╸╺▎▏▕▌▐▔▁▂▃▄▅▆▇█╭╮╯╰┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬]/;

export const isBannerLine = (line: string): boolean => {
  const t = line.trim();
  if (!t) return true;
  if (BOX_CHARS.test(t)) return true;
  if (/^(hermes agent v|available tools|available skills|session:|tip:|warning:|⚠|✦|⚕|❯)/i.test(t)) return true;
  if (/^\[hermes(-diag)?\]/.test(t)) return true;
  if (/^\d+\s+tools\s+·\s+\d+\s+skills/i.test(t)) return true;
  if (/^\/(exit|help)\b/.test(t)) return true;
  if (/^query:\s/i.test(t)) return true;
  if (/^goodbye/i.test(t)) return true;
  if (/^initializing agent\.{0,3}$/i.test(t)) return true;
  if (/^resume this session( with)?:?$/i.test(t)) return true;
  if (/^hermes\s+--resume\b/i.test(t)) return true;
  if (/^[↻⟳⭯⟲]?\s*resumed session\b/i.test(t)) return true;
  if (/^[▶►▷]?\s*starting (a )?new session\b/i.test(t)) return true;
  if (/^session id:\s/i.test(t)) return true;
  if (/^duration:\s/i.test(t)) return true;
  if (/^messages:\s/i.test(t)) return true;
  if (/^tokens?:\s/i.test(t)) return true;
  if (/^cost:\s/i.test(t)) return true;
  if (/^\d+\s+(user|tool calls?|assistant)/i.test(t)) return true;
  return false;
};

export const isEchoLine = (line: string, prompt: string): boolean => {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const ln = norm(line);
  const promptNorm = norm(prompt);
  if (!ln || ln.length < 4) return false;
  if (promptNorm.includes(ln)) return true;
  const lnWords = ln.split(' ').filter(Boolean);
  if (lnWords.length >= 3) {
    const joined = lnWords.join(' ');
    if (promptNorm.endsWith(joined) || promptNorm.startsWith(joined)) return true;
  }
  return false;
};

export const extractSessionId = (
  stdout: string,
  resumeId?: string,
  sessionWasInvalid?: boolean,
): string | null | undefined => {
  const sessionIdMatch = (stdout || '').match(/hermes\s+--resume\s+([A-Za-z0-9_\-:.]+)/);
  return sessionIdMatch?.[1] || (sessionWasInvalid ? null : resumeId);
};

export const classifyChatError = (text: string): 'missingKey' | 'noProvider' | 'other' => {
  if (/missing api key|api key.*not (set|found)|invalid api key|unauthorized.*api key|401.*unauthorized/i.test(text)) {
    return 'missingKey';
  }
  if (/no inference provider configured/i.test(text)) return 'noProvider';
  return 'other';
};
