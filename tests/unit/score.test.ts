import { describe, expect, it } from "vitest";
import {
  scoreLead,
  extractScoringInput,
  SCORING_VERSION,
  SCORING_SCHEME,
  HOT_THRESHOLD,
  WARM_THRESHOLD,
  OVERLEVERAGED_PENALTY,
  MAX_SCORE,
  type ScoringInput,
} from "@/modules/pipeline/score";

// ─────────────────────────────────────────────────────────────────────────────
// Lead scoring (SCR-01..10, PRN-01). The point tables come from the RESIDI scoring
// workbook; the four "Formula Tests" cases in that workbook are pinned here verbatim
// so the engine can never silently drift from the client-approved scheme. Extraction
// (SCR-10) is tested against the real LeadZolo / Real Estate Bees note templates.
// ─────────────────────────────────────────────────────────────────────────────

/** Build a structured input with sensible non-missing defaults; override per case. */
function input(over: Partial<ScoringInput>): ScoringInput {
  return {
    state: "TX",
    motivation: "Inheritance",
    timeline: "ASAP",
    equity: { kind: "free_and_clear" },
    loanType: "",
    ...over,
  };
}

describe("SCR-07: workbook Formula Tests reproduce exactly", () => {
  it("SCR-07: Hot example → 48/50 hot", () => {
    // TX(10) Inheritance(10) Within 30 days(10) Loan <20% ARV(8) New conventional(10) = 48
    const r = scoreLead(
      input({ state: "TX", motivation: "Inheritance", timeline: "Within 30 days", equity: { kind: "ltv", ratio: 0.1 }, loanType: "New conventional Loan" }),
    );
    expect(r.total).toBe(48);
    expect(r.group).toBe("hot");
    expect(r.status).toBe("complete");
  });

  it("SCR-07: Threshold = 38 → hot (boundary is inclusive)", () => {
    // FL(10) Foreclosure(10) ASAP(10) Loan 50-70% ARV(5) USDA/VA/FHA(3) = 38
    const r = scoreLead(
      input({ state: "FL", motivation: "Foreclosure / Pre-foreclosure", timeline: "ASAP", equity: { kind: "ltv", ratio: 0.6 }, loanType: "USDA/VA/FHA Loans" }),
    );
    expect(r.total).toBe(38);
    expect(r.group).toBe("hot");
  });

  it("SCR-06: Penalty example → 13/50 nurture (−15 applied)", () => {
    // OK(5) Downsizing(7) Within 30 days(10) Loan 80%+ ARV(3) USDA/VA/FHA(3) −15 = 13
    const r = scoreLead(
      input({ state: "OK", motivation: "Downsizing", timeline: "Within 30 days", equity: { kind: "ltv", ratio: 0.85 }, loanType: "USDA/VA/FHA Loans" }),
    );
    expect(r.breakdown.penalty).toBe(-15);
    expect(r.total).toBe(13);
    expect(r.group).toBe("nurture");
  });

  it("SCR-05: Free and clear auto-scores the mortgage criterion", () => {
    // NC(5) Inheritance(10) Within 30 days(10) Free and clear(10) Mortgage blank→auto 10 = 45
    const r = scoreLead(
      input({ state: "NC", motivation: "Inheritance", timeline: "Within 30 days", equity: { kind: "free_and_clear" }, loanType: "" }),
    );
    expect(r.breakdown.mortgage.points).toBe(10);
    expect(r.total).toBe(45);
    expect(r.group).toBe("hot");
  });
});

describe("SCR-01: state tiers", () => {
  it("SCR-01: priority states score 10", () => {
    for (const s of ["AZ", "CA", "TX", "FL", "CO"]) expect(scoreLead(input({ state: s })).breakdown.state.points).toBe(10);
  });
  it("SCR-01: secondary states score 7", () => {
    for (const s of ["HI", "NV", "GA", "NJ", "DC"]) expect(scoreLead(input({ state: s })).breakdown.state.points).toBe(7);
  });
  it("SCR-01: all other states score 5", () => {
    for (const s of ["NY", "PA", "MN", "OH"]) expect(scoreLead(input({ state: s })).breakdown.state.points).toBe(5);
  });
});

describe("SCR-02: motivation (unmapped values fall back to Other = 7)", () => {
  it("SCR-02: high-motivation reasons score 10", () => {
    for (const m of ["Inheritance", "Inherited", "Financial Hardship", "Income loss / Financial hardship", "Emergency Reasons", "Foreclosure / Pre-foreclosure"]) {
      expect(scoreLead(input({ motivation: m })).breakdown.motivation.points).toBe(10);
    }
  });
  it("SCR-02: an unrecognized reason scores 7, never blocks the lead", () => {
    for (const m of ["Relocating", "Divorce", "Church", "Tired Landlord", "Looking For a Quick Sale"]) {
      expect(scoreLead(input({ motivation: m })).breakdown.motivation.points).toBe(7);
    }
  });
  it("SCR-08: a blank motivation is missing → incomplete", () => {
    expect(scoreLead(input({ motivation: "" })).status).toBe("incomplete");
  });
});

describe("SCR-03: timeline", () => {
  it("SCR-03: immediate timelines score 10", () => {
    for (const t of ["ASAP", "Urgent", "Within 30 days", "Within 1-3 months", "Within 3 Months"]) {
      expect(scoreLead(input({ timeline: t })).breakdown.timeline.points).toBe(10);
    }
  });
  it("SCR-03: 3-6 months scores 7", () => {
    for (const t of ["3-6 months", "Within 3-6 months"]) expect(scoreLead(input({ timeline: t })).breakdown.timeline.points).toBe(7);
  });
  it("SCR-03: distant timelines score 3", () => {
    for (const t of ["6 months", "Within 6-12 months", "No hurry", "I'm not in a hurry", "In no rush"]) {
      expect(scoreLead(input({ timeline: t })).breakdown.timeline.points).toBe(3);
    }
  });
  it("SCR-08: an unrecognized or blank timeline is missing → incomplete", () => {
    expect(scoreLead(input({ timeline: "" })).status).toBe("incomplete");
    expect(scoreLead(input({ timeline: "someday maybe" })).status).toBe("incomplete");
  });
});

describe("SCR-04: equity bands from loan-to-value", () => {
  const bands: [number, number][] = [
    [0.1, 8], // < 20%
    [0.5, 5], // 20-70%
    [0.75, 3], // 70-80%
    [0.95, 3], // 80%+
  ];
  it("SCR-04: LTV maps to the right band", () => {
    for (const [ratio, pts] of bands) {
      expect(scoreLead(input({ equity: { kind: "ltv", ratio }, loanType: "New conventional Loan" })).breakdown.equity.points).toBe(pts);
    }
  });
  it("SCR-04: free and clear scores 10", () => {
    expect(scoreLead(input({ equity: { kind: "free_and_clear" } })).breakdown.equity.points).toBe(10);
  });
  it("SCR-08: no equity data → incomplete", () => {
    expect(scoreLead(input({ equity: { kind: "none" } })).status).toBe("incomplete");
  });
});

describe("SCR-05: mortgage (loan type)", () => {
  const cases: [string, number][] = [
    ["New Conventional", 10],
    ["No Mortgage", 10],
    ["HELOC", 5],
    ["Construction loan", 5],
    ["FHA", 3],
    ["VA", 3],
    ["USDA", 3],
    ["Commercial", 0],
    ["Credit Line (Revolving)", 0],
    ["", 0],
  ];
  it("SCR-05: loan type maps to points (unknown/other → 0, still scoreable)", () => {
    for (const [loanType, pts] of cases) {
      // Not free and clear, so the loan type is what's scored.
      expect(scoreLead(input({ equity: { kind: "ltv", ratio: 0.5 }, loanType })).breakdown.mortgage.points).toBe(pts);
    }
  });
  it("SCR-05: 'conventional' does not falsely match the VA loan token", () => {
    expect(scoreLead(input({ equity: { kind: "ltv", ratio: 0.5 }, loanType: "New Conventional" })).breakdown.mortgage.points).toBe(10);
  });
});

describe("SCR-09: determinism (PRN-01)", () => {
  it("SCR-09: same input ⇒ identical result", () => {
    const i = input({ state: "CA", timeline: "Urgent", equity: { kind: "ltv", ratio: 0.42 }, loanType: "FHA" });
    expect(scoreLead(i)).toEqual(scoreLead(i));
  });
  it("exposes the pinned scheme version + thresholds", () => {
    expect(SCORING_VERSION).toBeTruthy();
    expect(HOT_THRESHOLD).toBe(38);
    expect(WARM_THRESHOLD).toBe(25);
  });
});

describe("SCR: the documented scheme (Rules page) matches the engine", () => {
  it("thresholds, penalty and max in the descriptor equal the engine constants", () => {
    expect(SCORING_SCHEME.maxTotal).toBe(MAX_SCORE);
    expect(SCORING_SCHEME.penalty.points).toBe(OVERLEVERAGED_PENALTY);
    const hot = SCORING_SCHEME.groups.find((g) => g.key === "hot")!;
    const warm = SCORING_SCHEME.groups.find((g) => g.key === "warm")!;
    expect(hot.min).toBe(HOT_THRESHOLD);
    expect(warm.min).toBe(WARM_THRESHOLD);
    expect(hot.alerts).toBe(true); // only Hot alerts
    expect(warm.alerts).toBe(false);
  });

  // A representative input for each tier of each criterion; scoreLead must award the
  // exact points the descriptor advertises — the drift lock between docs and engine.
  const reps: Record<string, ((tierIndex: number) => Partial<ScoringInput>)[]> = {
    state: [
      () => ({ state: "TX" }),
      () => ({ state: "GA" }),
      () => ({ state: "NY" }),
    ],
    motivation: [
      () => ({ motivation: "Inheritance" }),
      () => ({ motivation: "Relocating" }),
    ],
    timeline: [
      () => ({ timeline: "ASAP" }),
      () => ({ timeline: "3-6 months" }),
      () => ({ timeline: "No hurry" }),
    ],
    equity: [
      () => ({ equity: { kind: "free_and_clear" } }),
      () => ({ equity: { kind: "ltv", ratio: 0.1 }, loanType: "New Conventional" }),
      () => ({ equity: { kind: "ltv", ratio: 0.5 }, loanType: "New Conventional" }),
      () => ({ equity: { kind: "ltv", ratio: 0.9 }, loanType: "New Conventional" }),
    ],
    mortgage: [
      () => ({ equity: { kind: "ltv", ratio: 0.5 }, loanType: "New Conventional" }),
      () => ({ equity: { kind: "ltv", ratio: 0.5 }, loanType: "HELOC" }),
      () => ({ equity: { kind: "ltv", ratio: 0.5 }, loanType: "FHA" }),
      () => ({ equity: { kind: "ltv", ratio: 0.5 }, loanType: "Commercial" }),
    ],
  };

  it("every descriptor tier awards the points the engine actually computes", () => {
    for (const criterion of SCORING_SCHEME.criteria) {
      criterion.tiers.forEach((tier, i) => {
        const r = scoreLead(input(reps[criterion.key][i](i)));
        expect(r.breakdown[criterion.key].points, `${criterion.key} tier ${i} (${tier.values})`).toBe(tier.points);
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCR-10: extraction from the two real vendor note templates. Equity and mortgage
// are not columns — they live inside the notes blob in vendor-specific formats.
// ─────────────────────────────────────────────────────────────────────────────

const LEADZOLO_FREE_CLEAR = [
  "⚫️ LEAD INFO FROM LEADZOLO",
  "How Soon to Sell: ASAP",
  "Free & Clear? 1",
  "Estimated Value: 349000",
  "Est. Mortgage Balance: 0",
  "Reason For Selling: Relocating",
].join("\n");

const REB_LEVERAGED = [
  "⚫️ REAL ESTATE BEES INCOMING LEAD NOTES",
  " * Sale urgency: Within 30 days",
  " * Reason for selling: Relocation / Moving",
  " * Current debt: 52912",
  " * Market price estimate: 48200",
  " * Loan type: FHA",
].join("\n");

const REB_BLANK_DEBT = [
  " * Sale urgency: Urgent",
  " * Reason for selling: Income loss / Financial hardship",
  " * Current debt:",
  " * Market price estimate: 108350",
  " * Loan type:",
].join("\n");

describe("SCR-10: extraction from vendor note blobs", () => {
  it("SCR-10: LeadZolo free & clear (state MN, ASAP) → 42 hot (Joanna T.)", () => {
    const si = extractScoringInput({ state: "MN", motivation: "Relocating", timeline: "ASAP", notes: LEADZOLO_FREE_CLEAR });
    expect(si.equity).toEqual({ kind: "free_and_clear" });
    const r = scoreLead(si);
    expect(r.total).toBe(42);
    expect(r.group).toBe("hot");
  });

  it("SCR-10: Real Estate Bees leveraged FHA (state PA) → 13 nurture (Donna C.)", () => {
    const si = extractScoringInput({ state: "PA", motivation: "Relocation / Moving", timeline: "Within 30 days", notes: REB_LEVERAGED });
    // 52912/48200 = 1.098 LTV → 80%+ band + FHA → −15 penalty
    expect(si.equity.kind).toBe("ltv");
    expect(si.loanType).toBe("FHA");
    const r = scoreLead(si);
    expect(r.total).toBe(13);
    expect(r.breakdown.penalty).toBe(-15);
    expect(r.group).toBe("nurture");
  });

  it("SCR-10: a blank Current debt line is not treated as $0 — equity missing → incomplete", () => {
    const si = extractScoringInput({ state: "MO", motivation: "Income loss / Financial hardship", timeline: "Urgent", notes: REB_BLANK_DEBT });
    expect(si.equity).toEqual({ kind: "none" });
    expect(scoreLead(si).status).toBe("incomplete");
  });

  it("SCR-10: extraction is pure — same notes ⇒ same signals", () => {
    const args = { state: "MN", motivation: "Relocating", timeline: "ASAP", notes: LEADZOLO_FREE_CLEAR };
    expect(extractScoringInput(args)).toEqual(extractScoringInput(args));
  });
});
