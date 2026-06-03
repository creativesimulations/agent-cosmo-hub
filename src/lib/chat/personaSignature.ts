import { systemAPI } from "@/lib/systemAPI";
import { resolveHomePath } from "./persistence";
import type { ChatPersonaSignature } from "./types";

const PERSONA_FILES = [
  ".hermes/SOUL.md",
  ".hermes/PERSONALITY.md",
  ".hermes/AGENTS.md",
  ".hermes/memories/MEMORY.md",
  ".hermes/memories/USER.md",
];

export const hashText = (text: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const capturePersonaSignature = async (): Promise<ChatPersonaSignature | undefined> => {
  if (typeof window === "undefined" || !window.electronAPI) return undefined;
  const files = await Promise.all(
    PERSONA_FILES.map(async (relative) => {
      const fullPath = await resolveHomePath(relative);
      if (!fullPath) return { path: relative, exists: false };
      const result = await window.electronAPI!.readFile(fullPath).catch(() => null);
      if (!result?.success || typeof result.content !== "string") {
        return { path: relative, exists: false };
      }
      return {
        path: relative,
        exists: true,
        hash: hashText(result.content),
      };
    }),
  );

  const agentName = await systemAPI.getAgentName().catch(() => null);
  return {
    agentName,
    files,
    capturedAt: new Date(),
  };
};

export const personaSignaturesMatch = (
  a?: ChatPersonaSignature,
  b?: ChatPersonaSignature,
): boolean => {
  if (!a || !b) return true;
  if ((a.agentName || null) !== (b.agentName || null)) return false;
  const bByPath = new Map(b.files.map((file) => [file.path, file]));
  return a.files.every((file) => {
    const other = bByPath.get(file.path);
    return Boolean(other) && file.exists === other.exists && (file.hash || "") === (other.hash || "");
  });
};
