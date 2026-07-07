import { describe, expect, it } from "vitest";
import { evaluate, isValidPatternRegex } from "@/modules/pipeline/mls";
import { DEFAULT_MLS_PATTERNS } from "@/modules/pipeline/mls-patterns";
import { MLS_CORPUS } from "../fixtures/mls-corpus";

describe("TST-02: MLS corpus", () => {
  for (const c of MLS_CORPUS) {
    it(`${c.id} → ${c.expected} (${c.why})`, () => {
      const result = evaluate(c.notes, DEFAULT_MLS_PATTERNS);
      expect(result.verdict).toBe(c.expected);
    });
  }
});

describe("MLS-03: default keep", () => {
  it("keeps blank notes with reason blank_default", () => {
    expect(evaluate("", DEFAULT_MLS_PATTERNS)).toMatchObject({ verdict: "kept", reason: "blank_default" });
    expect(evaluate("   ", DEFAULT_MLS_PATTERNS)).toMatchObject({ verdict: "kept", reason: "blank_default" });
    expect(evaluate(null, DEFAULT_MLS_PATTERNS)).toMatchObject({ verdict: "kept", reason: "blank_default" });
  });

  it("keeps notes with no listing signal as no_match_default", () => {
    expect(evaluate("seller motivated, cash preferred", DEFAULT_MLS_PATTERNS)).toMatchObject({
      verdict: "kept",
      reason: "no_match_default",
    });
  });
});

describe("MLS-05: removed leads retain the matched pattern + span", () => {
  it("returns the deciding pattern and the highlighted text span", () => {
    const notes = "Is it Listed? : true If Yes, MLS Date Active :";
    const result = evaluate(notes, DEFAULT_MLS_PATTERNS);
    expect(result.verdict).toBe("removed");
    expect(result.reason).toBe("disqualify");
    expect(result.pattern?.id).toBe("dq_is_listed_yes");
    expect(result.match).toBeDefined();
    // The span points back into the original notes.
    expect(notes.slice(result.match!.start, result.match!.end)).toBe(result.match!.text);
    expect(result.match!.text.toLowerCase()).toContain("true");
  });

  it("keep-override records the negative pattern that saved the lead", () => {
    const result = evaluate("Listed on MLS ? No, MLS Date Active: 3/2/25", DEFAULT_MLS_PATTERNS);
    expect(result).toMatchObject({ verdict: "kept", reason: "keep_override" });
    expect(result.pattern?.id).toBe("ko_listed_on_mls_no");
  });
});

describe("PRN-01: determinism", () => {
  it("returns identical results for identical inputs", () => {
    const notes = "currently on market with agent";
    expect(evaluate(notes, DEFAULT_MLS_PATTERNS)).toEqual(evaluate(notes, DEFAULT_MLS_PATTERNS));
  });
});

describe("MLS-04: pattern regex validation", () => {
  it("accepts every seed pattern", () => {
    for (const p of DEFAULT_MLS_PATTERNS) {
      expect(isValidPatternRegex(p.regex, p.flags)).toBe(true);
    }
  });

  it("rejects a malformed regex", () => {
    expect(isValidPatternRegex("(unclosed")).toBe(false);
  });
});
