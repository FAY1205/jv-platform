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
    expect(result.pattern?.id).toBe("dq_ls1_is_it_listed_yes");
    expect(result.match).toBeDefined();
    // The span points back into the original notes.
    expect(notes.slice(result.match!.start, result.match!.end)).toBe(result.match!.text);
    expect(result.match!.text.toLowerCase()).toContain("true");
  });

  it("MLS-05: the span highlights the real vendor-A listing line", () => {
    const notes = "Reason For Selling: Inherited\n\nListed? Yes\n\nHow Soon to Sell: ASAP";
    const result = evaluate(notes, DEFAULT_MLS_PATTERNS);
    expect(result.verdict).toBe("removed");
    expect(result.pattern?.id).toBe("dq_ls1_listed_yes");
    expect(notes.slice(result.match!.start, result.match!.end)).toBe(result.match!.text);
    expect(result.match!.text).toBe("Listed? Yes");
  });
});

describe("MLS-02: the engine still supports keep-override (v2 seeds none)", () => {
  // The v2 seed set is disqualify-only by owner decision (2026-07-15) — free-text
  // overrides caused false keeps. The ENGINE capability must stay intact and tested
  // so re-adding an override later is a data-only change to the patterns table.
  it("MLS-02: an explicit keep-override beats a co-occurring disqualify", () => {
    const patterns = [
      ...DEFAULT_MLS_PATTERNS,
      {
        id: "ko_test_off_market",
        type: "keep_override" as const,
        regex: String.raw`\boff[ \t]+market\b`,
        label: "off market",
      },
    ];
    const result = evaluate("Listed? Yes — correction: seller took it off market", patterns);
    expect(result).toMatchObject({ verdict: "kept", reason: "keep_override" });
    expect(result.pattern?.id).toBe("ko_test_off_market");
  });
});

describe("PRN-04: v2 patterns never use \\s (which crosses newlines)", () => {
  it("PRN-04: no seed pattern contains \\s", () => {
    // A `\s*` gap would let a listing question bind to an answer on a LATER line —
    // the exact bug that removed leads whose blank question was followed by prose.
    for (const p of DEFAULT_MLS_PATTERNS) {
      expect(p.regex).not.toMatch(/\\s/);
    }
  });
});

describe("PRN-01: the code seed order matches the DB load order", () => {
  it("PRN-01: DEFAULT_MLS_PATTERNS is sorted by id, matching loadRunRules' ORDER BY pattern_key", () => {
    // The engine is first-match-wins and PERSISTS the winning pattern id + span (MLS-05),
    // so ORDER IS A DECISION INPUT. The golden replays THIS array's order; production
    // replays the DB's `ORDER BY pattern_key` (src/modules/run/rules.ts). They agree today
    // only because this array happens to be alphabetical. buildRulesSnapshot sorts by id
    // before hashing, so the rulesHash is order-blind and CANNOT catch a divergence —
    // add a pattern out of order and the golden would keep passing while production
    // recorded a different mlsPatternKey for the same lead. This guard is what catches it.
    const ids = DEFAULT_MLS_PATTERNS.map((p) => p.id);
    expect(ids).toEqual([...ids].sort());
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
