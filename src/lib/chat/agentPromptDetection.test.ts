import { describe, expect, it } from "vitest";
import { detectAgentPrompt } from "./agentPromptDetection";

describe("detectAgentPrompt", () => {
  it("detects setup wizard numbered choices", () => {
    const detected = detectAgentPrompt([
      "Let me set it up! First, I'll run the WhatsApp setup wizard right here.",
      "Good progress! The wizard is asking how you want to use WhatsApp.",
      "Two options:",
      "1. Separate bot number (recommended) — People message the bot's number directly.",
      "2. Personal number (self-chat) — Quicker setup: you message yourself to talk to me.",
      "Which approach sounds better to you?",
    ].join("\n"));

    expect(detected?.inputKind).toBe("choice");
    expect(detected?.options).toHaveLength(2);
    expect(detected?.options[0]).toMatchObject({ value: "1", label: "Separate bot number (recommended)" });
    expect(detected?.prompt).toBe("Which approach sounds better to you?");
  });

  it("detects required setup input prompts", () => {
    const detected = detectAgentPrompt([
      "I'll continue the WhatsApp setup.",
      "The wizard needs your WhatsApp phone number to proceed.",
      "What's your phone number in international format?",
    ].join("\n"));

    expect(detected?.inputKind).toBe("text");
    expect(detected?.options).toEqual([]);
  });

  it("detects choices when Hermes streams them as one wrapped paragraph", () => {
    const detected = detectAgentPrompt(
      "The wizard is asking how you want to use WhatsApp. Two options: 1. Separate bot number - requires a second phone. 2. Personal number - quicker setup. Which approach sounds better to you?",
    );

    expect(detected?.inputKind).toBe("choice");
    expect(detected?.options.map((option) => option.value)).toEqual(["1", "2"]);
  });

  it("ignores already timed-out clarify messages", () => {
    const detected = detectAgentPrompt([
      "Which approach sounds better to you?",
      "(clarify timed out after 120s — agent will decide)",
    ].join("\n"));

    expect(detected).toBeNull();
  });
});
