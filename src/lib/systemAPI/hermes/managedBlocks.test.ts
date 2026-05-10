import { describe, expect, it } from "vitest";
import {
  PERMS_BEGIN,
  PERMS_END,
  stripManagedBlock,
  buildManagedBlockYaml,
} from "./managedBlocks";

describe("managedBlocks", () => {
  it("stripManagedBlock removes region between sentinels", () => {
    const yaml = `model: x\n${PERMS_BEGIN}\nold\n${PERMS_END}\ntrailer`;
    const out = stripManagedBlock(yaml, PERMS_BEGIN, PERMS_END);
    expect(out).not.toContain("old");
    expect(out).toContain("model: x");
    expect(out).toContain("trailer");
  });

  it("buildManagedBlockYaml inserts inner lines with sentinels", () => {
    const base = "model: openrouter/auto\n";
    const next = buildManagedBlockYaml(base, PERMS_BEGIN, PERMS_END, ["permissions:", "  shell: allow"]);
    expect(next).toContain(PERMS_BEGIN);
    expect(next).toContain(PERMS_END);
    expect(next).toContain("permissions:");
    expect(next).toContain("shell: allow");
  });
});
