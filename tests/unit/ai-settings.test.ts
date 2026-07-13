import { describe, it, expect } from "vitest";
import { coerceAiEnabled, coerceCapUsd } from "@/modules/ai/settings";

describe("SET-11 ai settings coercion", () => {
  it("SET-11: assistant is OFF unless explicitly enabled", () => {
    expect(coerceAiEnabled(undefined)).toBe(false);
    expect(coerceAiEnabled(true)).toBe(true);
    expect(coerceAiEnabled("yes")).toBe(false);
  });
  it("SET-11: cap defaults to $10 and rejects junk", () => {
    expect(coerceCapUsd(undefined)).toBe(10);
    expect(coerceCapUsd(25)).toBe(25);
    expect(coerceCapUsd(-3)).toBe(10);
    expect(coerceCapUsd("50")).toBe(10);
  });
});
