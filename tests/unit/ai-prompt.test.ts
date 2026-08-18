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
  it("WP-AI-STYLE: prompt forbids raw paths in prose and bans empty replies", () => {
    const p = buildSystemPrompt();
    expect(p).toMatch(/never write a url/i);
    expect(p).toMatch(/app path \(like \/dashboard\)/i);
    expect(p).toMatch(/at least one sentence/i);
  });
  it("AIS-01: the tone ban-list is in the prompt (no greetings/exclamations/filler/tool narration)", () => {
    const p = buildSystemPrompt();
    expect(p).toMatch(/no greetings/i);
    expect(p).toMatch(/no exclamation/i);
    expect(p).toMatch(/filler openers/i);
    expect(p).toMatch(/no narrating which tools you used/i);
    // "Happy to help" may appear ONLY as the quoted ban exemplar, never as guidance.
    expect(p.match(/happy to help/gi) ?? []).toHaveLength(1);
    expect(p).toContain("no filler openers ('Sure', 'Happy to help')");
  });
  it("AIS-01: an empty result is an answer, not an apology", () => {
    const p = buildSystemPrompt();
    expect(p).toMatch(/plainly and confidently/i);
    expect(p).toMatch(/never apologise for it/i);
  });
  it("AIS-02: refusals read as policy, not error or apology (and SEC-05 still holds)", () => {
    const p = buildSystemPrompt();
    expect(p).toMatch(/decline as one plain sentence of policy/i);
    expect(p).toMatch(/never reveal seller contact/i);
  });
  it("AIS-03: the model may not echo internal ids/UUIDs — records are named by reference", () => {
    const p = buildSystemPrompt();
    expect(p).toMatch(/internal id\/UUID/i);
    expect(p).toMatch(/PR-, LD-, IM-, UP-/);
  });
  it("AIS-09: the upload screen fact matches ADR-0039/ING-08 (no remap-and-confirm flow)", () => {
    const p = buildSystemPrompt("upload");
    expect(p).not.toMatch(/review-and-confirm/i);
    expect(p).not.toMatch(/mapping step/i);
    expect(p).toMatch(/rejected/i);
    // The copy names the absence explicitly, so "remapping" appears only under a negation.
    expect(p).toMatch(/there is no in-app remapping/i);
  });
  it("C-45: the primitives block separates the vocabulary the model kept conflating", () => {
    const p = buildSystemPrompt();
    // leads in vs distributed
    expect(p).toMatch(/leads in = every row/i);
    expect(p).toMatch(/distributed = the kept leads actually routed/i);
    // removed vs unmatched vs voided — three distinct definitions in one block
    expect(p).toMatch(/removed = dropped by the mls filter/i);
    expect(p).toMatch(/unmatched = kept, but no partner covers/i);
    expect(p).toMatch(/voided = a whole import recalled/i);
    // ASN-01 precedence, stated as a rule the model may assert
    expect(p).toMatch(/zip override beats state rule/i);
    // Hot is a scoring band, not a status
    expect(p).toMatch(/hot is a scoring band \(38\+ of 50/i);
    expect(p).toMatch(/not a lead status/i);
    // partner roster status vs per-lead status
    expect(p).toMatch(/partner status is a roster state/i);
    expect(p).toMatch(/lead status is a partner's progress on one lead/i);
    // held vs distributed
    expect(p).toMatch(/held = a brand-new import inside its 5-minute window/i);
  });

  it("C-45: the data-efficiency block bans redundant calls and over-broad tools", () => {
    const p = buildSystemPrompt();
    expect(p).toMatch(/reuse tool results already in this conversation/i);
    expect(p).toMatch(/never call the same tool twice for the same range/i);
    expect(p).toMatch(/one tool call when one suffices/i);
    expect(p).toMatch(/get_partner_performance, not the whole-workspace dashboard stats/i);
    expect(p).toMatch(/ask ONE short question and stop/);
  });

  it("C-45: the new blocks are STATIC — the skeleton is identical with or without a screen", () => {
    // Provider prompt caching only pays off if the per-request delta is the single screen
    // line; a primitives/efficiency block that varied by screen would break the cache prefix.
    const base = buildSystemPrompt();
    expect(buildSystemPrompt("leads").startsWith(base)).toBe(true);
    expect(buildSystemPrompt("coverage").startsWith(base)).toBe(true);
  });

  it("C-45: the settings screen catalog no longer promises a usage panel (dropped 2026-08-19)", () => {
    expect(SCREENS.settings).toMatch(/enable switch and provider api key/i);
    expect(SCREENS.settings).not.toMatch(/usage/i);
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
    expect(isInternalPath("/leads?open=LD-26-90011")).toBe(true); // P-1 deep link (query string, not a path segment)
    expect(isInternalPath("/partners/8a3d2f1e-0000-4000-8000-000000000000")).toBe(true);
    expect(isInternalPath("/coverage")).toBe(true); // bare prefix must still match via `$`
    expect(isInternalPath("https://evil.example/x")).toBe(false);
    expect(isInternalPath("//evil.example")).toBe(false);
    expect(isInternalPath("/dev/emails")).toBe(false);
    expect(isInternalPath("/leadsX")).toBe(false);
    expect(isInternalPath("/settingsfoo")).toBe(false);
  });
});
