import { describe, expect, it } from "vitest";
import { dedupeRun, type DedupeInput, type HistoryEntry } from "@/modules/pipeline/dedupe";

function lead(over: Partial<DedupeInput> & { dedupeKey: string }): DedupeInput {
  return {
    phoneNorm: "",
    partnerId: "current-partner",
    matchMethod: "state_fallback",
    ...over,
  };
}

describe("DED-01: prior-run match carries the original partner + first-matched date", () => {
  const history = new Map<string, HistoryEntry>([
    [
      "142 garden state ave|08034",
      { partnerId: "p-josh", matchMethod: "zip", firstMatchedAt: "2026-06-01T00:00:00Z", phoneNorm: "8565550142" },
    ],
  ]);

  it("DED-01: a repeat lead is flagged previously_matched with the original partner", () => {
    const [r] = dedupeRun([lead({ dedupeKey: "142 garden state ave|08034" })], history);
    expect(r.previouslyMatched).toBe(true);
    expect(r.partnerId).toBe("p-josh");
    expect(r.originalPartnerId).toBe("p-josh");
    expect(r.matchMethod).toBe("zip");
    expect(r.firstMatchedAt).toBe("2026-06-01T00:00:00Z");
  });

  it("PRN-05: coverage changed since first match → still routes to the ORIGINAL partner", () => {
    // Current-run candidate assignment is a DIFFERENT partner (new coverage) — must be ignored.
    const [r] = dedupeRun(
      [lead({ dedupeKey: "142 garden state ave|08034", partnerId: "p-new-coverage" })],
      history,
    );
    expect(r.partnerId).toBe("p-josh"); // original wins; history is never rewritten
  });
});

describe("DED-01: phone is a secondary confirm, never a primary key", () => {
  const history = new Map<string, HistoryEntry>([
    [
      "1 main st|29601",
      { partnerId: "p-randy", matchMethod: "state_fallback", firstMatchedAt: "2026-06-01T00:00:00Z", phoneNorm: "8645550135" },
    ],
  ]);

  it("sets phoneConfirmed when the phone also matches", () => {
    const [r] = dedupeRun([lead({ dedupeKey: "1 main st|29601", phoneNorm: "8645550135" })], history);
    expect(r).toMatchObject({ previouslyMatched: true, phoneConfirmed: true });
  });

  it("still matches on the key even when the phone differs (phone only confirms)", () => {
    const [r] = dedupeRun([lead({ dedupeKey: "1 main st|29601", phoneNorm: "9999999999" })], history);
    expect(r.previouslyMatched).toBe(true);
    expect(r.phoneConfirmed).toBe(false);
  });

  it("a matching phone with a DIFFERENT address is NOT a match (never primary)", () => {
    const [r] = dedupeRun([lead({ dedupeKey: "999 other rd|29601", phoneNorm: "8645550135" })], history);
    expect(r.previouslyMatched).toBe(false);
    expect(r.partnerId).toBe("current-partner");
  });
});

describe("DED: within-run duplicates and pass-through", () => {
  it("collapses a within-run duplicate to the first occurrence (deterministic by order)", () => {
    const results = dedupeRun(
      [
        lead({ dedupeKey: "5 oak st|10001", partnerId: "p-a", matchMethod: "zip" }),
        lead({ dedupeKey: "5 oak st|10001", partnerId: "p-b", matchMethod: "state_fallback" }),
      ],
      new Map(),
    );
    expect(results[0]).toMatchObject({ previouslyMatched: false, partnerId: "p-a" });
    expect(results[1]).toMatchObject({ previouslyMatched: true, partnerId: "p-a", duplicateOfIndex: 0 });
  });

  it("DED-03: returns every lead including unmatched (null partner) and removed", () => {
    const results = dedupeRun(
      [
        lead({ dedupeKey: "10 elm st|60614", partnerId: null, matchMethod: "none" }),
        lead({ dedupeKey: "11 elm st|60614", partnerId: "p-x", matchMethod: "state_fallback" }),
      ],
      new Map(),
    );
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ previouslyMatched: false, partnerId: null });
  });

  it("a new lead reports firstMatchedAt=null so the caller can stamp it (PRN-01 purity)", () => {
    const [r] = dedupeRun([lead({ dedupeKey: "7 pine st|19103" })], new Map());
    expect(r).toMatchObject({ previouslyMatched: false, firstMatchedAt: null, originalPartnerId: null });
  });

  it("does NOT merge degenerate keys (missing address or zip)", () => {
    const results = dedupeRun(
      [lead({ dedupeKey: "|29601" }), lead({ dedupeKey: "|29601" })],
      new Map(),
    );
    expect(results[0].previouslyMatched).toBe(false);
    expect(results[1].previouslyMatched).toBe(false); // not a duplicate — degenerate key
  });
});

describe("PRN-01: dedupe determinism", () => {
  it("same inputs ⇒ identical results", () => {
    const leads = [lead({ dedupeKey: "5 oak st|10001" }), lead({ dedupeKey: "5 oak st|10001" })];
    expect(dedupeRun(leads, new Map())).toEqual(dedupeRun(leads, new Map()));
  });
});
