import { useState, useRef, useEffect } from "react";
import { Terminal as TerminalIcon, Send } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface TerminalLine {
  type: "input" | "output" | "error" | "system";
  content: string;
}

const initialLines: TerminalLine[] = [
  { type: "system", content: "Ainoval Agent Terminal v1.0" },
  { type: "system", content: "Type 'help' for available commands." },
  { type: "system", content: "─".repeat(50) },
  { type: "input", content: "$ agent status" },
  { type: "output", content: "Agent: online | Uptime: 4h 23m | Sub-agents: 3" },
  { type: "input", content: "$ agent logs --tail 3" },
  { type: "output", content: "[14:23:05] Sub-agent 'research-agent' spawned" },
  { type: "output", content: "[14:22:58] Task delegation: market analysis" },
  { type: "output", content: "[14:22:41] Rate limit warning: OpenAI 80%" },
];

const TerminalPage = () => {
  const [lines, setLines] = useState<TerminalLine[]>(initialLines);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [lines]);

  const handleCommand = () => {
    if (!input.trim()) return;
    const newLines: TerminalLine[] = [
      ...lines,
      { type: "input", content: `$ ${input}` },
    ];

    const cmd = input.trim().toLowerCase();
    if (cmd === "help") {
      newLines.push({
        type: "output",
        content: "Available: agent status | agent logs | agent restart | agent config | clear",
      });
    } else if (cmd === "clear") {
      setLines([]);
      setInput("");
      return;
    } else if (cmd === "agent restart") {
      newLines.push({ type: "system", content: "Restarting agent..." });
      newLines.push({ type: "output", content: "✓ Agent restarted successfully" });
    } else {
      newLines.push({ type: "output", content: `Executing: ${input}` });
    }

    setLines(newLines);
    setInput("");
  };

  return (
    <div className="p-6 space-y-6 h-[calc(100vh-0px)] flex flex-col">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <TerminalIcon className="w-6 h-6 text-primary" />
          Terminal
        </h1>
        <p className="text-sm text-muted-foreground">Direct CLI access to your agent</p>
      </div>

      <GlassCard className="flex-1 flex flex-col overflow-hidden p-0">
        {/* Terminal Header */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5">
          <div className="w-3 h-3 rounded-full bg-destructive/60" />
          <div className="w-3 h-3 rounded-full bg-warning/60" />
          <div className="w-3 h-3 rounded-full bg-success/60" />
          <span className="text-xs text-muted-foreground ml-2 font-mono">ainoval-terminal</span>
        </div>

        {/* Terminal Content */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 font-mono text-sm space-y-1"
        >
          {lines.map((line, i) => (
            <div
              key={i}
              className={
                line.type === "input"
                  ? "text-accent"
                  : line.type === "error"
                  ? "text-destructive"
                  : line.type === "system"
                  ? "text-muted-foreground"
                  : "text-foreground/80"
              }
            >
              {line.content}
            </div>
          ))}
        </div>

        {/* Input */}
        <div className="border-t border-white/5 p-3 flex gap-2">
          <span className="text-accent font-mono text-sm flex items-center">$</span>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCommand()}
            placeholder="Type a command..."
            className="bg-transparent border-none focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm text-foreground placeholder:text-muted-foreground/50"
          />
          <Button
            size="icon"
            variant="ghost"
            onClick={handleCommand}
            className="text-muted-foreground hover:text-accent shrink-0"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </GlassCard>
    </div>
  );
};

export default TerminalPage;
