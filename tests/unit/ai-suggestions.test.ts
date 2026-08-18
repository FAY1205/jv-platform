import { describe, it, expect } from "vitest";
import { followUpSuggestions, suggestionsFor, EXPLAIN_CHIP } from "@/modules/ai/suggestions";
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

  it("AIS-11: the activity screen leads with its own audit-trail chip (get_recent_activity)", () => {
    expect(suggestionsFor("activity")[0]).toBe("What changed recently?");
  });
});

describe("AIS-10: post-answer follow-up row", () => {
  it("AIS-10: bounded to 3, drawn from the screen's own set, 'Explain this screen' last", () => {
    const row = followUpSuggestions("activity", []);
    expect(row).toHaveLength(3);
    expect(row[row.length - 1]).toBe(EXPLAIN_CHIP);
    for (const q of row) expect(suggestionsFor("activity")).toContain(q);
    // The cap is a cap, not a slice that can behead the escape hatch: activity has 4 chips
    // and the row still ends on EXPLAIN_CHIP.
    expect(suggestionsFor("activity").length).toBeGreaterThan(row.length);
  });

  it("AIS-10: questions already asked this session drop out, case-insensitively", () => {
    const asked = ["  WHICH STATES HAVE NO COVERAGE?  "];
    const row = followUpSuggestions("coverage", asked);
    expect(row).not.toContain("Which states have no coverage?");
    expect(row).toContain("Who covers the most states?");
  });

  it("AIS-10: a screen whose questions are exhausted still offers the escape hatch, then nothing", () => {
    const all = suggestionsFor("coverage");
    expect(followUpSuggestions("coverage", all.filter((q) => q !== EXPLAIN_CHIP))).toEqual([EXPLAIN_CHIP]);
    // Everything asked (including the explainer) → an empty row, which the widget renders as
    // no row at all rather than a bare heading.
    expect(followUpSuggestions("coverage", all)).toEqual([]);
  });

  it("AIS-10: an unknown screen falls back to the generic set, still bounded and explain-last", () => {
    const row = followUpSuggestions(undefined, []);
    expect(row).toHaveLength(3);
    expect(row[2]).toBe(EXPLAIN_CHIP);
  });

  it("AIS-10: every screen produces a valid row from a cold start", () => {
    for (const key of SCREEN_KEYS) {
      const row = followUpSuggestions(key, []);
      expect(row.length, key).toBeGreaterThanOrEqual(2);
      expect(row.length, key).toBeLessThanOrEqual(3);
      expect(row[row.length - 1], key).toBe(EXPLAIN_CHIP);
      expect(new Set(row).size, key).toBe(row.length); // no duplicate rows
    }
  });
});
