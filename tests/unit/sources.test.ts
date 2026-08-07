import { describe, expect, it } from "vitest";
import {
  detectProfile,
  createNextVersion,
  applyProfile,
  findRowErrors,
  GENERIC_PROFILE,
  type SourceProfile,
} from "@/modules/sources";

const STRICT_PROFILE: SourceProfile = { ...GENERIC_PROFILE, strictness: "strict" };

describe("TST-11: source format drift", () => {
  it("exact signature auto-applies", () => {
    const r = detectProfile(GENERIC_PROFILE.headerSignature, [GENERIC_PROFILE]);
    expect(r.status).toBe("exact");
    expect(r.profile?.id).toBe("generic");
  });

  it("added column passes a flexible profile", () => {
    const headers = [...GENERIC_PROFILE.headerSignature, "County"];
    expect(detectProfile(headers, [GENERIC_PROFILE]).status).toBe("exact");
  });

  it("added column blocks a strict profile with a diff", () => {
    const headers = [...STRICT_PROFILE.headerSignature, "County"];
    const r = detectProfile(headers, [STRICT_PROFILE]);
    expect(r.status).toBe("drift");
    expect(r.diff?.added).toContain("county");
  });

  it("renamed column → drift with a proposed rename (never silent re-guess)", () => {
    const headers = GENERIC_PROFILE.headerSignature.map((h) =>
      h === "Time to Sell" ? "Timeline to Sell" : h,
    );
    const r = detectProfile(headers, [GENERIC_PROFILE]);
    expect(r.status).toBe("drift");
    expect(r.diff?.renamed).toEqual([{ from: "time to sell", to: "timeline to sell" }]);
  });

  it("missing Zip hard-blocks (required column genuinely absent)", () => {
    const headers = GENERIC_PROFILE.headerSignature.filter((h) => h !== "Zip");
    const r = detectProfile(headers, [GENERIC_PROFILE]);
    expect(r.status).toBe("missing_required");
    expect(r.missingRequired).toContain("zip");
  });

  it("renamed Zip → drift proposing a remap, not a hard block", () => {
    const headers = GENERIC_PROFILE.headerSignature.map((h) => (h === "Zip" ? "Postal Code" : h));
    const r = detectProfile(headers, [GENERIC_PROFILE]);
    expect(r.status).toBe("drift");
    expect(r.missingRequired).toContain("zip");
    expect(r.diff?.renamed).toEqual([{ from: "zip", to: "postal code" }]);
  });

  it("unknown format → inline mapping", () => {
    expect(detectProfile(["Foo", "Bar", "Baz"], [GENERIC_PROFILE]).status).toBe("unknown");
    expect(detectProfile(GENERIC_PROFILE.headerSignature, []).status).toBe("unknown");
  });

  // R-34: detection ranks by fit ratio with a total tie-break on profile id, so the
  // winner is a pure function of the inputs — never of candidate (DB row) order.
  it("TST-11: equal-overlap candidates resolve to a stable winner regardless of order", () => {
    const a: SourceProfile = {
      id: "a-profile", name: "A", version: 1, headerSignature: ["Name", "Zip"],
      mapping: {}, requiredColumns: [], strictness: "flexible",
    };
    const b: SourceProfile = {
      id: "b-profile", name: "B", version: 1, headerSignature: ["Phone", "Email"],
      mapping: {}, requiredColumns: [], strictness: "flexible",
    };
    const headers = ["Name", "Zip", "Phone", "Email"]; // both fit 1.0 — a true tie
    expect(detectProfile(headers, [a, b]).profile?.id).toBe("a-profile");
    expect(detectProfile(headers, [b, a]).profile?.id).toBe("a-profile");
  });

  it("TST-11: an exact smaller-signature match beats a larger-signature partial overlap", () => {
    const small: SourceProfile = {
      id: "small-exact", name: "Small", version: 1, headerSignature: ["Name", "Zip"],
      mapping: {}, requiredColumns: [], strictness: "flexible",
    };
    const large: SourceProfile = {
      id: "large-partial", name: "Large", version: 1,
      headerSignature: ["Name", "Zip", "Phone", "Email", "Address", "City"],
      mapping: {}, requiredColumns: [], strictness: "flexible",
    };
    // Upload matches ALL of small (fit 1.0) but only 3/6 of large (fit 0.5).
    // Absolute overlap would pick large (3 > 2) and report drift — the R-34 bug.
    const r = detectProfile(["Name", "Zip", "Phone"], [large, small]);
    expect(r.profile?.id).toBe("small-exact");
    expect(r.status).toBe("exact"); // flexible: the extra column is allowed
  });

  it("confirmed drift creates profile v+1 without mutating the original (DM-08)", () => {
    const next = createNextVersion(GENERIC_PROFILE, {
      headerSignature: [...GENERIC_PROFILE.headerSignature, "County"],
      mapping: GENERIC_PROFILE.mapping,
    });
    expect(next.version).toBe(2);
    expect(GENERIC_PROFILE.version).toBe(1);
  });
});

describe("ING-03: apply profile maps canonical fields and preserves raw", () => {
  const row = {
    Campaign: "Lead Zolo",
    Address: "142 Garden State Ave",
    City: "Cherry Hill",
    State: "NJ",
    Zip: "08034",
    Notes: "off market",
    County: "Camden",
  };

  it("maps mapped columns and keeps the full source row (DM-02)", () => {
    const applied = applyProfile(row, GENERIC_PROFILE);
    expect(applied.canonical.campaign).toBe("Lead Zolo");
    expect(applied.canonical.address).toBe("142 Garden State Ave");
    expect(applied.canonical.zip).toBe("08034");
    expect(applied.canonical.notes).toBe("off market");
    // Unmapped column is absent from canonical but preserved in raw.
    expect("county" in applied.canonical).toBe(false);
    expect(applied.raw).toEqual(row);
  });
});

describe("ING-04: row-level validation", () => {
  it("flags a row missing both Zip and State", () => {
    const applied = applyProfile({ Address: "1 Main St" }, GENERIC_PROFILE);
    expect(findRowErrors(applied)).toHaveLength(1);
  });

  it("accepts a row with a Zip", () => {
    const applied = applyProfile({ Address: "1 Main St", Zip: "08034" }, GENERIC_PROFILE);
    expect(findRowErrors(applied)).toHaveLength(0);
  });
});
