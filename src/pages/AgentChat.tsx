import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { MessageSquare, Send, Bot, User, Loader2, Sparkles } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  streaming?: boolean;
}

const sampleResponses = [
  "I've analyzed the data and found 3 key patterns. Would you like me to elaborate on any of them?",
  "The sub-agent has completed the research task. Here's a summary of the findings:\n\n1. Market trends indicate a 15% growth\n2. Competitor analysis shows 3 new entrants\n3. Customer sentiment is largely positive",
  "I can help with that. Let me delegate this to a specialized sub-agent for code analysis. This should take about 30 seconds.",
  "Configuration updated successfully. The new LLM provider settings are now active across all sub-agents.",
];

const AgentChat = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Hello! I'm Ron, your AI agent. How can I assist you today? I can help with tasks, answer questions, or delegate work to specialized sub-agents.",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || isStreaming) return;
    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsStreaming(true);

    // Simulate streaming response
    const response = sampleResponses[Math.floor(Math.random() * sampleResponses.length)];
    const assistantId = (Date.now() + 1).toString();
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "", timestamp: new Date(), streaming: true }]);

    let streamed = "";
    for (const char of response) {
      streamed += char;
      const current = streamed;
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: current } : m)));
      await new Promise((r) => setTimeout(r, 15));
    }
    setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)));
    setIsStreaming(false);
  };

  return (
    <div className="p-6 flex flex-col h-[calc(100vh-2rem)] max-h-screen">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <MessageSquare className="w-6 h-6 text-primary" />
          Agent Chat
        </h1>
        <p className="text-sm text-muted-foreground">Interact directly with your AI agent</p>
      </div>

      <GlassCard className="flex-1 flex flex-col overflow-hidden p-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn("flex gap-3", msg.role === "user" && "flex-row-reverse")}
            >
              <div
                className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                  msg.role === "assistant" ? "bg-primary/15" : "bg-accent/15"
                )}
              >
                {msg.role === "assistant" ? (
                  <Bot className="w-4 h-4 text-primary" />
                ) : (
                  <User className="w-4 h-4 text-accent" />
                )}
              </div>
              <div
                className={cn(
                  "max-w-[70%] rounded-xl px-4 py-3",
                  msg.role === "assistant"
                    ? "glass-subtle text-foreground"
                    : "bg-primary/15 border border-primary/20 text-foreground"
                )}
              >
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                {msg.streaming && (
                  <span className="inline-block w-2 h-4 bg-primary/60 animate-pulse ml-0.5" />
                )}
                <p className="text-[10px] text-muted-foreground mt-1">
                  {msg.timestamp.toLocaleTimeString()}
                </p>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="p-4 border-t border-white/5">
          <form
            onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
            className="flex gap-2"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Message your agent..."
              className="bg-background/50 border-white/10 focus:border-primary/50 flex-1"
              disabled={isStreaming}
            />
            <Button
              type="submit"
              disabled={!input.trim() || isStreaming}
              className="gradient-primary text-primary-foreground"
            >
              {isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </form>
        </div>
      </GlassCard>
    </div>
  );
};

export default AgentChat;
