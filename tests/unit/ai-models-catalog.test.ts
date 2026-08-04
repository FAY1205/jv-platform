import { describe, it, expect } from "vitest";
import { AI_MODELS, DEFAULT_MODEL, isValidModel, coerceModel } from "@/modules/ai/models-catalog";

describe("ADR-0036 model catalog", () => {
  it("each provider's default is its highest (first) listed tier", () => {
    expect(DEFAULT_MODEL.google).toBe(AI_MODELS.google[0].id);
    expect(DEFAULT_MODEL.openai).toBe(AI_MODELS.openai[0].id);
    expect(DEFAULT_MODEL.anthropic).toBe(AI_MODELS.anthropic[0].id);
  });

  it("the dead Gemini 2.0 model is no longer offered (shut down 2026-06-01)", () => {
    // The catalog type no longer includes the dead id, so a literal `===` won't type-check
    // (that's the guarantee) — widen to string to keep the runtime assertion meaningful.
    expect(AI_MODELS.google.some((m) => (m.id as string) === "gemini-2.0-flash")).toBe(false);
    expect(AI_MODELS.google[0].id).toBe("gemini-3.6-flash");
  });

  it("isValidModel accepts a listed model and rejects a foreign one", () => {
    expect(isValidModel("openai", "gpt-5.6-terra")).toBe(true);
    expect(isValidModel("openai", "gpt-5.6-luna")).toBe(true);
    expect(isValidModel("openai", "gemini-3.6-flash")).toBe(false); // wrong provider
    expect(isValidModel("anthropic", "made-up")).toBe(false);
  });

  it("coerceModel keeps a valid choice, else falls back to the provider default", () => {
    expect(coerceModel("anthropic", "claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5-20251001");
    expect(coerceModel("anthropic", "gpt-5.6-terra")).toBe(DEFAULT_MODEL.anthropic); // foreign → default
    expect(coerceModel("google", null)).toBe(DEFAULT_MODEL.google);
    expect(coerceModel("google", undefined)).toBe(DEFAULT_MODEL.google);
  });
});
