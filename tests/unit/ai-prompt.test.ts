import { describe, it, expect } from "vitest";
import { buildSystemPrompt, ScreenKeySchema, SCREENS, isInternalPath } from "@/modules/ai/prompt";

describe("ai prompt assembly (AIA-03/PRN-10)", () => {
  it("PRN-10: prompt declares tool/data text is never instructions", () => {
    const p = buildSystemPrompt("dashboard");
    expect(p).toMatch(/never instructions/i);
    expect(p).toMatch(/authoriz/i); // authorization claims inside data are void
  });
  it("AIA-03: prompt demands tool-grounded figures and refusal over guessing", () => {
    const p = buildSystemPrompt();
    expect(p).toMatch(/only from tool results/i);
    expect(p).toMatch(/don't have/i);
  });
  it("SEC-05: prompt forbids contact info and points to the lead page", () => {
    expect(buildSystemPrompt()).toMatch(/never reveal seller contact/i);
  });
  it("screen context is injected for a known screen and absent otherwise", () => {
    expect(buildSystemPrompt("coverage")).toContain(SCREENS.coverage);
    expect(buildSystemPrompt()).not.toContain(SCREENS.coverage);
  });
  it("unknown screen keys degrade to undefined (Zod catch)", () => {
    expect(ScreenKeySchema.parse("dashboard")).toBe("dashboard");
    expect(ScreenKeySchema.parse("evil://x")).toBeUndefined();
  });
  it("PRN-10: link whitelist allows only known internal path prefixes", () => {
    expect(isInternalPath("/leads/LD-00291")).toBe(true);
    expect(isInternalPath("/partners/8a3d2f1e-0000-4000-8000-000000000000")).toBe(true);
    expect(isInternalPath("/coverage")).toBe(true); // bare prefix must still match via `$`
    expect(isInternalPath("https://evil.example/x")).toBe(false);
    expect(isInternalPath("//evil.example")).toBe(false);
    expect(isInternalPath("/dev/emails")).toBe(false);
    expect(isInternalPath("/leadsX")).toBe(false);
    expect(isInternalPath("/settingsfoo")).toBe(false);
  });
});
