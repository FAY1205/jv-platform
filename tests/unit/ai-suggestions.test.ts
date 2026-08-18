import { describe, it, expect } from "vitest";
import { suggestionsFor } from "@/modules/ai/suggestions";
import { SCREEN_KEYS } from "@/modules/ai/prompt";

describe("contextual suggestions (owner: chips change with the screen)", () => {
  it("dashboard gets performance/coverage asks", () => {
    expect(suggestionsFor("dashboard")).toContain("Which states have no coverage?");
  });
  it("import screens ask about the last import", () => {
    expect(suggestionsFor("import_detail")).toContain("Why were leads removed from this import?");
  });
  it("unknown/undefined screens get the generic set (3-4 chips, always includes explain)", () => {
    const s = suggestionsFor(undefined);
    expect(s.length).toBeGreaterThanOrEqual(3);
    expect(s.length).toBeLessThanOrEqual(4);
    expect(s).toContain("Explain this screen");
  });

  it("AIS-07: every screen has chips — 2-4, question form, ≤41 chars, 'Explain this screen' last", () => {
    for (const key of SCREEN_KEYS) {
      const s = suggestionsFor(key);
      expect(s.length, key).toBeGreaterThanOrEqual(2);
      expect(s.length, key).toBeLessThanOrEqual(4);
      expect(s[s.length - 1], key).toBe("Explain this screen");
      for (const chip of s.slice(0, -1)) {
        expect(chip.length, `${key}: ${chip}`).toBeLessThanOrEqual(41);
        expect(chip.endsWith("?"), `${key}: ${chip}`).toBe(true);
      }
    }
  });

  it("AIS-07: activity/rules/upload have their OWN chips, not a silent GENERIC fallback", () => {
    const generic = suggestionsFor(undefined);
    for (const key of ["activity", "rules", "upload"] as const) {
      expect(suggestionsFor(key), key).not.toBe(generic); // reference-equality guard
    }
    expect(suggestionsFor("rules")).toContain("What makes a lead Hot?");
    expect(suggestionsFor("upload")).toContain("What happens after I upload a file?");
    // Activity has no audit-trail tool yet (WP-AI-TOOL-ACTIVITY) — its chips ride real ones.
    expect(suggestionsFor("activity")).toContain("What happened in the last import?");
  });
});
