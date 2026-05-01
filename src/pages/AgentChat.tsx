import { useRef, useEffect, useState } from "react";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import { useChat } from "@/contexts/ChatContext";
import { motion } from "framer-motion";
import { MessageSquare, Send, Bot, User, Loader2, AlertCircle, KeyRound, Trash2, X, RotateCcw, Square, Clock, Network, ShieldAlert, Wrench, Globe } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import CapabilityFixBubble from "@/components/chat/CapabilityFixBubble";
import CapabilityChips from "@/components/chat/CapabilityChips";
import BrowserSetupDialog from "@/components/skills/BrowserSetupDialog";
import { secretsStore } from "@/lib/systemAPI";
import { useSettings } from "@/contexts/SettingsContext";
import { isAnyBackendConfigured } from "@/lib/browserBackends";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

import { IntentCard } from "@/components/intents";

const AgentChat = () => {
  const { connected: agentConnected } = useAgentConnection();
  const {
    messages,
    isStreaming,
    queuedCount,
    unreadCount,
    sessionId,
    liveSubAgentCount,
    sendMessage,
    stop,
    deleteMessage,
    clearAll,
    markChatViewed,
    startNewSession,
    draft,
    setDraft,
    sendIntentResponse,
  } = useChat();
  const input = draft;
  const setInput = setDraft;
  const { settings } = useSettings();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const didInitialScrollRef = useRef(false);
  const [browserSetupOpen, setBrowserSetupOpen] = useState(false);
  const [secretKeys, setSecretKeys] = useState<Set<string>>(new Set());
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Detect whether *any* browser backend is configured to drive the
  // first-run banner. Re-checks when the dialog closes.
  useEffect(() => {
    if (!agentConnected) return;
    let cancelled = false;
    void secretsStore.list().then((r) => {
      if (!cancelled) setSecretKeys(new Set(r.keys || []));
    });
    return () => { cancelled = true; };
  }, [agentConnected, browserSetupOpen]);

  const localChromeManual = settings.capabilityPolicy?.webBrowser === "allow"
    && !["BROWSERBASE_API_KEY", "BROWSER_USE_API_KEY", "CAMOFOX_URL", "FIRECRAWL_API_KEY"]
      .some((k) => secretKeys.has(k));
  const showBrowserBanner = agentConnected
    && !bannerDismissed
    && !isAnyBackendConfigured(secretKeys, { localChromeManual });

  // On first mount, jump (no smooth) to the first unread message — or the
  // last message if everything is already read. After that initial jump,
  // any new message smoothly scrolls the view to the bottom.
  useEffect(() => {
    if (didInitialScrollRef.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      return;
    }
    if (messages.length === 0) return;
    didInitialScrollRef.current = true;
    // unreadCount is captured at mount time; markChatViewed runs in the next
    // effect and will reset it, so read it synchronously here.
    const targetIndex =
      unreadCount > 0 && unreadCount <= messages.length
        ? messages.length - unreadCount
        : messages.length - 1;
    const target = messages[targetIndex];
    const el = target ? messageRefs.current.get(target.id) : null;
    if (el) {
      el.scrollIntoView({ behavior: "auto", block: "start" });
    } else {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "auto" });
    }
    // We intentionally only react to messages.length so the initial jump
    // happens once, even if `unreadCount` updates as a side effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // The page itself is the "viewed" signal — clear unread badge on mount.
  useEffect(() => {
    markChatViewed();
  }, [markChatViewed]);

  // Auto-grow the textarea as the user types, capped to ~8 lines.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [input]);

  const handleSend = async () => {
    // Allow sending while a previous reply is in-flight — the ChatContext
    // worker will queue prompts and process them in strict order.
    if (!input.trim() || !agentConnected) return;
    const text = input;
    setInput("");
    await sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter inserts a newline (default browser behavior).
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="p-6 flex flex-col h-[calc(100vh-2rem)] max-h-screen">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <MessageSquare className="w-6 h-6 text-primary" />
            Agent Chat
          </h1>
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            {sessionId ? (
              <>Resuming session <span className="font-mono text-[11px] text-muted-foreground/80">{sessionId}</span></>
            ) : (
              "Interact directly with your AI agent"
            )}
            {queuedCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 border border-primary/30 text-primary text-[11px]">
                <Clock className="w-3 h-3" />
                {queuedCount} queued
              </span>
            )}
            {liveSubAgentCount > 0 && (
              <button
                type="button"
                onClick={() => { window.location.hash = "#/agents"; }}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/15 border border-accent/30 text-accent text-[11px] hover:bg-accent/25 transition-colors"
                title="Click to open the Sub-agents tab"
              >
                <Network className="w-3 h-3" />
                {liveSubAgentCount} sub-agent{liveSubAgentCount === 1 ? "" : "s"} working…
              </button>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {sessionId && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={startNewSession}
              disabled={isStreaming}
              title="Start a fresh agent session (clears resume id but keeps message history)"
            >
              <RotateCcw className="w-4 h-4 mr-1.5" />
              New session
            </Button>
          )}
          {messages.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="w-4 h-4 mr-1.5" />
                  Clear all
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear conversation?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This deletes every message in this chat from your device. The agent's own session history on disk is not affected. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={clearAll} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Clear all
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {showBrowserBanner && (
        <div className="mb-3 p-3 rounded-lg border border-primary/30 bg-primary/5 flex items-start gap-3">
          <Globe className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">Ron can't browse the web yet</p>
            <p className="text-xs text-muted-foreground">
              Pick a browser backend so Ron can actually load pages. Free options available.
            </p>
          </div>
          <Button size="sm" onClick={() => setBrowserSetupOpen(true)} className="gradient-primary text-primary-foreground shrink-0">
            Set up browser
          </Button>
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            className="text-muted-foreground hover:text-foreground p-1"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

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
                ref={(el) => {
                  if (el) messageRefs.current.set(msg.id, el);
                  else messageRefs.current.delete(msg.id);
                }}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn("flex gap-3 group", msg.role === "user" && "flex-row-reverse")}
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
                    "relative max-w-[70%] rounded-xl px-4 py-3",
                    msg.cancelled
                      ? "glass-subtle text-muted-foreground italic border border-dashed border-white/10"
                      : msg.role === "assistant"
                        ? "glass-subtle text-foreground"
                        : "bg-primary/15 border border-primary/20 text-foreground",
                    msg.queued && "opacity-60",
                  )}
                >
                  {!msg.streaming && (
                    <button
                      type="button"
                      onClick={() => deleteMessage(msg.id)}
                      aria-label="Delete message"
                      className={cn(
                        "absolute -top-2 -right-2 w-6 h-6 rounded-full bg-background/90 border border-white/10 text-muted-foreground hover:text-destructive hover:border-destructive/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center",
                      )}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                  {msg.queued && msg.role === "assistant" && !msg.content && (
                    <p className="text-xs text-muted-foreground italic flex items-center gap-1.5">
                      <Clock className="w-3 h-3" /> Queued — waiting for previous reply…
                    </p>
                  )}
                  {(!msg.queued || msg.role === "user" || msg.content) && (
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  )}
                  {msg.streaming && (
                    <span className="inline-block w-2 h-4 bg-primary/60 animate-pulse ml-0.5" />
                  )}
                  {msg.missingKey && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="mt-2 h-7 text-xs"
                      onClick={() => { window.location.hash = "#/secrets"; }}
                    >
                      <KeyRound className="w-3 h-3 mr-1" />
                      Add {msg.missingKey.envVar}
                    </Button>
                  )}
                  {msg.materializeFailed && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="mt-2 h-7 text-xs"
                      onClick={() => { window.location.hash = "#/diagnostics"; }}
                    >
                      <AlertCircle className="w-3 h-3 mr-1" />
                      Open App Diagnostics
                    </Button>
                  )}
                  {msg.permissionMismatch && (() => {
                    const m = msg.permissionMismatch;
                    const isNoPrompt = m.kind.endsWith("NoPrompt");
                    const labelMap: Record<string, string> = {
                      shellNoPrompt: "Shell command",
                      fileWriteNoPrompt: "File write",
                      fileReadNoPrompt: "File read",
                      internetNoPrompt: "Internet access",
                      scriptNoPrompt: "Script execution",
                      shell: "Shell command",
                      fileWrite: "File write",
                      fileRead: "File read",
                      internet: "Internet access",
                      script: "Script execution",
                    };
                    return (
                      <div className="mt-2 p-2 rounded-md border border-warning/40 bg-warning/10 text-[11px] flex items-start gap-2">
                        <ShieldAlert className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          {isNoPrompt ? (
                            <p className="text-foreground/90">
                              Your <span className="font-semibold">{labelMap[m.kind]}</span> permission is set to{" "}
                              <span className="font-semibold">{m.agentSetting}</span>, but the agent acted without prompting you.
                              {m.detail ? ` ${m.detail}` : ""}{" "}
                              The agent may not honor per-action approval for this category. Switch the setting to{" "}
                              <span className="font-semibold">Deny</span> to block it entirely, or check App Diagnostics for the active permissions block.
                            </p>
                          ) : (
                            <p className="text-foreground/90">
                              The agent reported a permission error for{" "}
                              <span className="font-semibold">{labelMap[m.kind] || m.kind}</span>,
                              but Ronbot's setting for it is{" "}
                              <span className="font-semibold">{m.agentSetting}</span>.
                              The permissions block may not have been applied to the agent.
                            </p>
                          )}
                          <div className="flex gap-3">
                            <button
                              type="button"
                              className="text-warning hover:underline"
                              onClick={() => { window.location.hash = "#/diagnostics"; }}
                            >
                              Open App Diagnostics →
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  {msg.toolUnavailable && (
                    <CapabilityFixBubble hit={msg.toolUnavailable} />
                  )}
                  {msg.usedCapabilities && msg.usedCapabilities.length > 0 && msg.role === "assistant" && !msg.streaming && (
                    <CapabilityChips capabilityIds={msg.usedCapabilities} />
                  )}
                  {msg.diagnostics && (msg.missingKey || msg.materializeFailed || msg.content.startsWith("Error") || msg.content.startsWith("Failed")) && (
                    <details className="mt-2 text-[11px] text-muted-foreground/70">
                      <summary className="cursor-pointer hover:text-muted-foreground">Diagnostics</summary>
                      <pre className="mt-1 p-2 rounded bg-background/40 border border-white/5 font-mono text-[10px] whitespace-pre-wrap">
{msg.diagnostics}
                      </pre>
                    </details>
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
            onSubmit={(e) => { e.preventDefault(); void handleSend(); }}
            className="flex gap-2 items-end"
          >
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                agentConnected
                  ? isStreaming || queuedCount > 0
                    ? "Type to queue another message…  (Shift+Enter for newline)"
                    : "Message your agent…  (Shift+Enter for newline)"
                  : "Agent not connected"
              }
              className="bg-background/50 border-white/10 focus:border-primary/50 flex-1 min-h-[44px] max-h-[200px] resize-none py-2.5"
              rows={1}
              disabled={!agentConnected}
            />
            {(isStreaming || queuedCount > 0) && (
              <Button
                type="button"
                onClick={() => { void stop(); }}
                variant="destructive"
                className="shrink-0 h-[44px]"
                title="Interrupt the agent and discard any queued messages"
              >
                <Square className="w-4 h-4 mr-1.5" />
                Stop
              </Button>
            )}
            <Button
              type="submit"
              disabled={!input.trim() || !agentConnected}
              className="gradient-primary text-primary-foreground shrink-0 h-[44px]"
              title={isStreaming || queuedCount > 0 ? "Queue this message — it will be sent after the current reply" : "Send"}
            >
              {isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </form>
        </div>
      </GlassCard>

      <BrowserSetupDialog
        open={browserSetupOpen}
        onOpenChange={setBrowserSetupOpen}
      />
    </div>
  );
};

export default AgentChat;
