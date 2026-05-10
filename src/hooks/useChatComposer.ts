import type { KeyboardEvent } from "react";

export const PERSONALITY_PREFIX =
  "I'd like to adjust your personality. Please update your SOUL.md";

type UseChatComposerArgs = {
  input: string;
  setInput: (value: string) => void;
  sendMessage: (prompt: string) => Promise<void>;
  agentConnected: boolean;
  backgroundMode: boolean;
  setBackgroundMode: (on: boolean) => void;
  markPersonalityDraftSent: () => void;
};

export function useChatComposer({
  input,
  setInput,
  sendMessage,
  agentConnected,
  backgroundMode,
  setBackgroundMode,
  markPersonalityDraftSent,
}: UseChatComposerArgs) {
  const handleSend = async () => {
    if (!input.trim() || !agentConnected) return;
    let text = input;
    if (backgroundMode) {
      text = `/background ${text}`;
      setBackgroundMode(false);
    }
    const wasPersonalityDraft = text.trimStart().startsWith(PERSONALITY_PREFIX);
    setInput("");
    await sendMessage(text);
    if (wasPersonalityDraft) markPersonalityDraftSent();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return { handleSend, handleKeyDown };
}
