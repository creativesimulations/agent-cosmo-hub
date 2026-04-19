import { useState, useRef, useEffect } from "react";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import { motion } from "framer-motion";
import { MessageSquare, Send, Bot, User, Loader2, AlertCircle, KeyRound } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { systemAPI } from "@/lib/systemAPI";
import { toast } from "@/hooks/use-toast";

const CHAT_STORAGE_KEY = "ainoval-agent-chat-history";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  streaming?: boolean;
}

const loadStoredMessages = (): Message[] => {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.sessionStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as Array<Omit<Message, "timestamp"> & { timestamp: string }>;
    if (!Array.isArray(parsed)) return [];

    return parsed.map((message) => ({
      ...message,
      timestamp: new Date(message.timestamp),
    }));
  } catch {
    return [];
  }
};

const AgentChat = () => {
  const [messages, setMessages] = useState<Message[]>(() => loadStoredMessages());
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const { connected: agentConnected } = useAgentConnection();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    window.sessionStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify(
        messages.map((message) => ({
          ...message,
          timestamp: message.timestamp.toISOString(),
        }))
      )
    );
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || isStreaming || !agentConnected) return;
    const promptText = input.trim();
    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: promptText,
      timestamp: new Date(),
    };
    const placeholderId = `${Date.now()}-r`;
    const placeholder: Message = {
      id: placeholderId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
      streaming: true,
    };
    setMessages((prev) => [...prev, userMsg, placeholder]);
    setInput("");
    setIsStreaming(true);

    try {
      const result = await systemAPI.chatAgent(promptText);
      const reply = result.reply || result.stdout?.trim() || "(no response)";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === placeholderId
            ? { ...m, content: result.success ? reply : `Error: ${result.stderr || reply}`, streaming: false }
            : m,
        ),
      );
      if (!result.success) {
        toast({
          title: "Agent error",
          description: result.stderr?.split("\n")[0] || "Failed to get a reply from the agent.",
          variant: "destructive",
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === placeholderId ? { ...m, content: `Error: ${msg}`, streaming: false } : m,
        ),
      );
      toast({ title: "Agent error", description: msg, variant: "destructive" });
    } finally {
      setIsStreaming(false);
    }
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
        {!agentConnected ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-3">
              <AlertCircle className="w-10 h-10 text-muted-foreground/40 mx-auto" />
              <p className="text-sm text-muted-foreground">No agent connected</p>
              <p className="text-xs text-muted-foreground/60">Install and start an agent to begin chatting</p>
            </div>
          </div>
        ) : (
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex-1 flex items-center justify-center h-full">
                <p className="text-sm text-muted-foreground/40">Send a message to start the conversation</p>
              </div>
            )}
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
        )}

        <div className="p-4 border-t border-white/5">
          <form
            onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
            className="flex gap-2"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={agentConnected ? "Message your agent..." : "Agent not connected"}
              className="bg-background/50 border-white/10 focus:border-primary/50 flex-1"
              disabled={isStreaming || !agentConnected}
            />
            <Button
              type="submit"
              disabled={!input.trim() || isStreaming || !agentConnected}
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
