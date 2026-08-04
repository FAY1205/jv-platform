import { describe, it, expect } from "vitest";
import { coerceAiEnabled } from "@/modules/ai/settings";

describe("SET-11 ai settings coercion", () => {
  it("SET-11: assistant is OFF unless explicitly enabled", () => {
    expect(coerceAiEnabled(undefined)).toBe(false);
    expect(coerceAiEnabled(true)).toBe(true);
    expect(coerceAiEnabled("yes")).toBe(false);
  });
});
