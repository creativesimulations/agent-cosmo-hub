import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, MessageSquareText, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAgentPrompt, useRespondToAgentPrompt } from "@/contexts/AgentPromptContext";
import { cn } from "@/lib/utils";

/**
 * Non-blocking prompt surfaced in the chat composer area while Hermes waits
 * on stdin (clarify, wizard questions, numbered choices). Does not replace chat.
 */
const AgentPromptBar = () => {
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
    <div
      className={cn(
        "mb-2 rounded-lg border p-3 text-sm",
        urgent ? "border-warning/40 bg-warning/10" : "border-primary/25 bg-primary/5",
      )}
      role="region"
      aria-label="Agent is waiting for your answer"
    >
      <div className="flex items-start gap-2">
        {urgent ? (
          <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
        ) : (
          <MessageSquareText className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        )}
        <div className="flex-1 space-y-2 min-w-0">
          <p className="font-medium text-foreground">{pending.prompt}</p>
          <p className="text-xs text-muted-foreground">
            Reply here to continue this turn. If you do not answer, Hermes may auto-decide in about {secondsLeft}s.
          </p>

          {pending.options.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {pending.options.map((option) => (
                <Button
                  key={`${pending.id}-${option.value}`}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-auto max-w-full justify-start gap-2 py-2 text-left"
                  onClick={() => submit(option.value)}
                >
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
                    {option.value}
                  </span>
                  <span>
                    <span className="block text-xs font-medium">{option.label}</span>
                    {option.description && (
                      <span className="block text-[10px] text-muted-foreground">{option.description}</span>
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
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder="Your answer…"
                className="h-9"
              />
              <Button type="submit" size="sm" disabled={!answer.trim()}>
                <Send className="w-3.5 h-3.5 mr-1" />
                Send
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default AgentPromptBar;
