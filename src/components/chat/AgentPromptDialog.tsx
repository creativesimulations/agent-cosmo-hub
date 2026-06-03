import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, MessageSquareText, Send, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAgentPrompt, useRespondToAgentPrompt } from "@/contexts/AgentPromptContext";
import { cn } from "@/lib/utils";

const AgentPromptDialog = () => {
  const { pending } = useAgentPrompt();
  const respond = useRespondToAgentPrompt();
  const [answer, setAnswer] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    setAnswer("");
    setNow(Date.now());
  }, [pending?.id]);

  useEffect(() => {
    if (!pending) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pending]);

  const secondsLeft = useMemo(() => {
    if (!pending) return 0;
    const elapsed = Math.floor((now - pending.createdAt) / 1000);
    return Math.max(0, pending.timeoutSeconds - elapsed);
  }, [now, pending]);

  if (!pending) return null;

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    respond(trimmed);
  };

  const urgent = secondsLeft <= 30;

  return (
    <Dialog open={!!pending} onOpenChange={(open) => { if (!open) respond(null); }}>
      <DialogContent className="glass-strong border-white/10 max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <MessageSquareText className="w-5 h-5 text-primary" />
            Ronbot needs your input
          </DialogTitle>
          <DialogDescription>
            The agent is paused during setup and is waiting for you to choose before it continues.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className={cn(
            "rounded-lg border p-3 text-sm",
            urgent ? "border-warning/40 bg-warning/10" : "border-primary/20 bg-primary/5",
          )}>
            <div className="flex items-start gap-2">
              {urgent ? (
                <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              )}
              <div className="space-y-1">
                <p className="font-medium text-foreground">{pending.prompt}</p>
                <p className="text-xs text-muted-foreground">
                  Hermes may auto-decide if no answer arrives. Estimated time left: {secondsLeft}s.
                </p>
              </div>
            </div>
          </div>

          {pending.options.length > 0 ? (
            <div className="grid gap-2">
              {pending.options.map((option) => (
                <Button
                  key={`${pending.id}-${option.value}`}
                  type="button"
                  variant="outline"
                  className="h-auto justify-start gap-3 p-3 text-left"
                  onClick={() => submit(option.value)}
                >
                  <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary/10 px-2 text-xs font-semibold text-primary">
                    {option.value}
                  </span>
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium text-foreground">{option.label}</span>
                    {option.description && (
                      <span className="block text-xs text-muted-foreground">{option.description}</span>
                    )}
                  </span>
                </Button>
              ))}
            </div>
          ) : (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                submit(answer);
              }}
            >
              <Input
                autoFocus
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder="Type your answer..."
              />
              <Button type="submit" disabled={!answer.trim()}>
                <Send className="w-4 h-4 mr-1.5" />
                Send
              </Button>
            </form>
          )}

          {pending.context && (
            <details className="rounded-lg border border-white/10 bg-background/40 p-3">
              <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-muted-foreground">
                Agent context
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-foreground/80">
                {pending.context}
              </pre>
            </details>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => respond(null)}>
            <X className="w-4 h-4 mr-1.5" />
            Dismiss
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AgentPromptDialog;
