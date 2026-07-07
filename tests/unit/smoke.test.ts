import { describe, expect, it } from "vitest";
import { APP_NAME, APP_ENVS } from "@/lib/app";

// WP-001: proves the Vitest runner and the "@/*" path alias resolve.
describe("WP-001: toolchain smoke", () => {
  it("resolves the @/ alias and app constants", () => {
    expect(APP_NAME).toBe("TerritoryDesk");
    expect(APP_ENVS).toContain("production");
  });
});
