import { useState, useRef, useEffect, useCallback } from "react";
import { Terminal as TerminalIcon, Send, Loader2, Trash2, Shield } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { systemAPI } from "@/lib/systemAPI";
import { isElectron } from "@/lib/systemAPI";
import { usePermissions } from "@/contexts/PermissionsContext";
import PermissionEventBubble from "@/components/permissions/PermissionEventBubble";

interface TerminalLine {
  type: "input" | "output" | "error" | "system";
  content: string;
}

const WELCOME: TerminalLine[] = [
  { type: "system", content: "Ronbot Terminal — runs commands in your real shell." },
  { type: "system", content: "Type 'help' for built-ins, or any shell command (e.g. 'hermes status', 'ls ~/.hermes')." },
  { type: "system", content: "─".repeat(60) },
];

const HELP_TEXT = `Built-in commands:
  help              Show this help
  clear             Clear terminal output
  history           Show recent commands
  cd <dir>          Change working directory for this session

Anything else is run as a real shell command via the OS.
Useful examples:
  hermes status
  hermes doctor
  hermes update
  ls ~/.hermes
  cat ~/.hermes/config.yaml`;

const TerminalPage = () => {
  const { events: permissionEvents } = usePermissions();
  const [lines, setLines] = useState<TerminalLine[]>(WELCOME);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const [cwd, setCwd] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Initialize cwd from platform homeDir.
  useEffect(() => {
    void (async () => {
      const p = await systemAPI.getPlatform();
      setCwd(p.homeDir);
    })();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [lines, running]);

  const append = useCallback((newLines: TerminalLine[]) => {
    setLines((prev) => [...prev, ...newLines]);
  }, []);

  const runCommand = useCallback(
    async (raw: string) => {
      const cmd = raw.trim();
      if (!cmd) return;

      append([{ type: "input", content: `${cwd} $ ${cmd}` }]);
      setHistory((h) => [...h, cmd]);
      setHistoryIdx(null);

      // Built-ins
      if (cmd === "help") {
        append([{ type: "output", content: HELP_TEXT }]);
        return;
      }
      if (cmd === "clear") {
        setLines([]);
        return;
      }
      if (cmd === "history") {
        append([
          {
            type: "output",
            content: history.length ? history.map((h, i) => `  ${i + 1}  ${h}`).join("\n") : "(empty)",
          },
        ]);
        return;
      }
      if (cmd.startsWith("cd ") || cmd === "cd") {
        const target = cmd === "cd" ? "~" : cmd.slice(3).trim();
        // Expand ~ via platform info.
        const p = await systemAPI.getPlatform();
        const expanded = target === "~" || target.startsWith("~/")
          ? target.replace(/^~/, p.homeDir)
          : target;
        // Verify it exists by running a probe (pwd inside it).
        const probe = await systemAPI.runCommand(`cd "${expanded}" && pwd`);
        if (probe.exitCode === 0 && probe.stdout.trim()) {
          setCwd(probe.stdout.trim());
        } else {
          append([{ type: "error", content: probe.stderr.trim() || `cd: no such directory: ${target}` }]);
        }
        return;
      }

      if (!isElectron()) {
        append([
          {
            type: "error",
            content: "Shell execution is only available in the desktop app. (Browser preview can't run real commands.)",
          },
        ]);
        return;
      }

      setRunning(true);
      try {
        // Wrap in a login shell on macOS/Linux so PATH includes ~/.local/bin
        // (where `hermes` lives) and shell built-ins like `source` work.
        // On Windows we still go through cmd.exe via the default shell:true.
        const platform = await systemAPI.getPlatform();
        let toRun = cmd;
        if (!platform.isWindows) {
          const b64 = btoa(unescape(encodeURIComponent(cmd)));
          toRun = `bash -lc "echo ${b64} | base64 -d | bash"`;
        }
        const result = await systemAPI.runCommand(toRun, { cwd });
        if (result.stdout) {
          append([{ type: "output", content: result.stdout.replace(/\n$/, "") }]);
        }
        if (result.stderr) {
          append([{ type: "error", content: result.stderr.replace(/\n$/, "") }]);
        }
        if (!result.stdout && !result.stderr && result.exitCode === 0) {
          append([{ type: "system", content: "(no output)" }]);
        }
        if (result.exitCode !== 0) {
          append([{ type: "system", content: `[exit ${result.exitCode}]` }]);
        }
      } catch (e) {
        append([{ type: "error", content: e instanceof Error ? e.message : String(e) }]);
      } finally {
        setRunning(false);
      }
    },
    [append, cwd, history],
  );

  const handleSubmit = () => {
    if (running) return;
    const cmd = input;
    setInput("");
    void runCommand(cmd);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSubmit();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const next = historyIdx === null ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(next);
      setInput(history[next]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx === null) return;
      const next = historyIdx + 1;
      if (next >= history.length) {
        setHistoryIdx(null);
        setInput("");
      } else {
        setHistoryIdx(next);
        setInput(history[next]);
      }
    }
  };

  return (
    <div className="p-6 space-y-4 h-screen flex flex-col">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <TerminalIcon className="w-6 h-6 text-primary" />
            Terminal
          </h1>
          <p className="text-sm text-muted-foreground">Direct shell access — run real commands on your system.</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLines(WELCOME)}
          className="text-muted-foreground hover:text-foreground"
        >
          <Trash2 className="w-4 h-4 mr-1" /> Clear
        </Button>
      </div>

      {permissionEvents.length > 0 && (
        <GlassCard className="p-3 max-h-40 overflow-y-auto space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Shield className="w-3.5 h-3.5" />
            <span className="font-medium">Agent activity</span>
            <span className="text-muted-foreground/60">({permissionEvents.length} recent)</span>
          </div>
          {permissionEvents.slice(0, 8).map((e) => (
            <PermissionEventBubble key={e.id} event={e} />
          ))}
        </GlassCard>
      )}

      <GlassCard className="flex-1 flex flex-col overflow-hidden p-0 min-h-0">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border/40 shrink-0">
          <div className="w-3 h-3 rounded-full bg-destructive/60" />
          <div className="w-3 h-3 rounded-full bg-warning/60" />
          <div className="w-3 h-3 rounded-full bg-success/60" />
          <span className="text-xs text-muted-foreground ml-2 font-mono truncate">{cwd || "shell"}</span>
        </div>

        <div
          ref={scrollRef}
          onClick={() => inputRef.current?.focus()}
          className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-1 cursor-text"
        >
          {lines.map((line, i) => (
            <pre
              key={i}
              className={
                "whitespace-pre-wrap break-words " +
                (line.type === "input"
                  ? "text-accent"
                  : line.type === "error"
                  ? "text-destructive"
                  : line.type === "system"
                  ? "text-muted-foreground"
                  : "text-foreground/85")
              }
            >
              {line.content}
            </pre>
          ))}
          {running && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" /> running…
            </div>
          )}
        </div>

        <div className="border-t border-border/40 p-3 flex gap-2 shrink-0">
          <span className="text-accent font-mono text-sm flex items-center">$</span>
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            disabled={running}
            placeholder={running ? "Running…" : "Type a command and press Enter"}
            className="bg-transparent border-none focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm text-foreground placeholder:text-muted-foreground/50"
            autoFocus
            spellCheck={false}
          />
          <Button
            size="icon"
            variant="ghost"
            onClick={handleSubmit}
            disabled={running || !input.trim()}
            className="text-muted-foreground hover:text-accent shrink-0"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </GlassCard>
    </div>
  );
};

export default TerminalPage;
