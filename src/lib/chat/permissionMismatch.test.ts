import { describe, expect, it } from "vitest";
import { analyzePermissionMismatch } from "./permissionMismatch";
import { DEFAULT_PERMISSIONS } from "@/lib/permissions";

const baseActivity = { shell: 0, fileWrite: 0, fileRead: 0, internet: 0, script: 0 };

describe("analyzePermissionMismatch", () => {
  it("flags denial while internet is Allow", () => {
    const perms = { ...DEFAULT_PERMISSIONS, internet: "allow" as const };
    const out = analyzePermissionMismatch(
      "I cannot access the internet from this environment.",
      perms,
      baseActivity,
      0,
    );
    expect(out?.kind).toBe("internet");
    expect(out?.agentSetting).toBe("Allow");
  });

  it("flags Ask bypass when activity ran with no approval prompt", () => {
    const perms = { ...DEFAULT_PERMISSIONS, shell: "ask" as const };
    const out = analyzePermissionMismatch(
      "All done.",
      perms,
      { ...baseActivity, shell: 2 },
      0,
    );
    expect(out?.kind).toBe("shellNoPrompt");
    expect(out?.detail).toMatch(/2 calls/);
  });

  it("does not flag Ask bypass when an approval prompt was seen", () => {
    const perms = { ...DEFAULT_PERMISSIONS, shell: "ask" as const };
    const out = analyzePermissionMismatch(
      "All done.",
      perms,
      { ...baseActivity, shell: 2 },
      1,
    );
    expect(out).toBeUndefined();
  });
});
