import { describe, expect, it } from "vitest";
import { APP_ROUTES } from "./appRoutes";

/** Mirrors AppSidebar primary + advanced nav (keep in sync manually). */
const SIDEBAR_ROUTES = [
  "/",
  "/channels",
  "/skills",
  "/settings",
  "/scheduled",
  "/insights",
  "/models",
  "/secrets",
  "/agents",
  "/updates",
  "/backups",
  "/diagnostics",
  "/terminal",
  "/install",
] as const;

describe("APP_ROUTES", () => {
  it("matches AppSidebar navigation paths", () => {
    expect([...APP_ROUTES]).toEqual([...SIDEBAR_ROUTES]);
  });
});
