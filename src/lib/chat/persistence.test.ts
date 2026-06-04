import { beforeEach, describe, expect, it } from "vitest";
import {
  CHAT_STORAGE_KEY,
  SESSION_STORAGE_KEY,
  buildConversationState,
  createConversation,
  loadStoredConversationState,
  parseStoredConversations,
  sanitizeStoredMessages,
  serializeConversations,
} from "./persistence";
import type { ChatMessage } from "./types";

const message = (id: string, content: string, timestamp = "2026-06-03T00:00:00.000Z"): ChatMessage => ({
  id,
  role: "user",
  content,
  timestamp: new Date(timestamp),
});

describe("chat conversation persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("serializes and restores conversation dates and message dates", () => {
    const conversation = createConversation({
      id: "conv-a",
      messages: [message("m1", "Plan a trip")],
      sessionId: "session-a",
      now: new Date("2026-06-03T01:00:00.000Z"),
      personaSignature: {
        agentName: "Ron",
        files: [{ path: ".hermes/SOUL.md", exists: true, hash: "abc" }],
        capturedAt: new Date("2026-06-03T01:01:00.000Z"),
      },
    });

    const restored = parseStoredConversations(serializeConversations([conversation]));

    expect(restored).toHaveLength(1);
    expect(restored[0].messages[0].timestamp).toBeInstanceOf(Date);
    expect(restored[0].createdAt).toBeInstanceOf(Date);
    expect(restored[0].personaSignature?.capturedAt).toBeInstanceOf(Date);
    expect(restored[0].sessionId).toBe("session-a");
  });

  it("caps stored messages per conversation", () => {
    const conversation = createConversation({
      id: "conv-a",
      messages: [
        message("m1", "one"),
        message("m2", "two"),
        message("m3", "three"),
      ],
    });

    const restored = parseStoredConversations(serializeConversations([conversation], 2));

    expect(restored[0].messages.map((m) => m.id)).toEqual(["m2", "m3"]);
  });

  it("migrates legacy single-chat localStorage into one conversation", () => {
    window.localStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify([{ ...message("m1", "Legacy hello"), timestamp: "2026-06-03T00:00:00.000Z" }]),
    );
    window.localStorage.setItem(SESSION_STORAGE_KEY, "legacy-session");

    const state = loadStoredConversationState({ autoResumeSession: true });

    expect(state.conversations).toHaveLength(1);
    expect(state.conversations[0].messages[0].content).toBe("Legacy hello");
    expect(state.conversations[0].sessionId).toBe("legacy-session");
    expect(state.activeConversationId).toBe(state.conversations[0].id);
  });

  it("does not select an archived conversation as active", () => {
    const archived = {
      ...createConversation({ id: "archived", messages: [message("m1", "old")] }),
      archivedAt: new Date("2026-06-03T02:00:00.000Z"),
    };
    const active = createConversation({ id: "active", messages: [message("m2", "new")] });

    const state = buildConversationState([archived, active], "archived");

    expect(state.activeConversationId).toBe("active");
  });
});

describe("sanitizeStoredMessages", () => {
  it("removes install-demo WhatsApp user prompt and following assistant reply", () => {
    const cleaned = sanitizeStoredMessages([
      message("u1", "Set up WhatsApp so I can message you from WhatsApp."),
      { id: "a1", role: "assistant", content: "WhatsApp setup is complete.", timestamp: new Date() },
      message("u2", "Real user question"),
    ]);
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0].content).toBe("Real user question");
  });
});
