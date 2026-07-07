import { describe, expect, it } from "vitest";
import { detectProfile, applyProfile, INVESTORFUSE_PROFILE } from "@/modules/sources";

// The real InvestorFuse export: 61 columns, property block (cols 4-7) distinct from the
// seller block (cols 14-17). The territory key is the PROPERTY Zip Code, not Seller Zip Code.
// Canonical `notes` = Notes (col 39) only — Comments (col 40) is raw_json-only (owner-confirmed).

describe("ING-02: InvestorFuse Source Profile v1 — detection", () => {
  it("ING-02: exact 61-header signature auto-applies", () => {
    const r = detectProfile(INVESTORFUSE_PROFILE.headerSignature, [INVESTORFUSE_PROFILE]);
    expect(r.status).toBe("exact");
    expect(r.profile?.id).toBe("investorfuse");
    expect(INVESTORFUSE_PROFILE.headerSignature).toHaveLength(61);
  });

  it("ING-02: extra columns still auto-apply (flexible profile)", () => {
    const headers = [...INVESTORFUSE_PROFILE.headerSignature, "New CRM Column"];
    expect(detectProfile(headers, [INVESTORFUSE_PROFILE]).status).toBe("exact");
  });

  it("ING-08: a renamed header drifts with a proposed rename (never silent re-guess)", () => {
    const headers = INVESTORFUSE_PROFILE.headerSignature.map((h) =>
      h === "Comments" ? "Comment" : h,
    );
    const r = detectProfile(headers, [INVESTORFUSE_PROFILE]);
    expect(r.status).toBe("drift");
    expect(r.diff?.renamed).toEqual([{ from: "comments", to: "comment" }]);
  });

  it("ING-04/08: a missing property Zip Code hard-blocks, naming the column", () => {
    const headers = INVESTORFUSE_PROFILE.headerSignature.filter((h) => h !== "Zip Code");
    const r = detectProfile(headers, [INVESTORFUSE_PROFILE]);
    expect(r.status).toBe("missing_required");
    expect(r.missingRequired).toContain("zip");
  });
});

describe("ING-03: InvestorFuse apply — property keys, notes=Notes, Comments raw-only", () => {
  const row: Record<string, string> = {
    Campaign: "Real Estate Bees",
    "Street Address": "142 Garden State Ave",
    City: "Cherry Hill",
    State: "NJ",
    "Zip Code": "08034",
    "Seller First Name": "Jane",
    "Seller Last Name": "Doe",
    "Seller Email": "jane@example.com",
    "Seller Phone": "(856) 555-0100",
    "Seller Street Address": "9 Other St",
    "Seller City": "Hoboken",
    "Seller State": "NJ",
    "Seller Zip Code": "07030",
    "Reason For Selling": "Relocating",
    Motivation: "High",
    "Time To Sell": "ASAP",
    Notes: "Is it Listed? : No  If Yes, MLS Date Active :",
    Comments: "No Answer/No VM - null",
    "Date Created": "2026-06-30",
  };

  it("ING-03: maps the PROPERTY zip/state/address, not the Seller* variants (ASN territory key)", () => {
    const { canonical } = applyProfile(row, INVESTORFUSE_PROFILE);
    expect(canonical.zip).toBe("08034");
    expect(canonical.state).toBe("NJ");
    expect(canonical.address).toBe("142 Garden State Ave");
  });

  it("ING-03: Seller Zip Code is preserved in raw but never the territory key", () => {
    const { canonical, raw } = applyProfile(row, INVESTORFUSE_PROFILE);
    expect(canonical.zip).not.toBe("07030");
    expect(raw["Seller Zip Code"]).toBe("07030");
  });

  it("notes = Notes (col 39); Comments never enters canonical, only raw_json (DM-02)", () => {
    const { canonical, raw } = applyProfile(row, INVESTORFUSE_PROFILE);
    expect(canonical.notes).toBe("Is it Listed? : No  If Yes, MLS Date Active :");
    expect(Object.values(canonical)).not.toContain("No Answer/No VM - null");
    expect(raw.Comments).toBe("No Answer/No VM - null");
  });

  it("ING-03: maps seller identity + campaign + date created", () => {
    const { canonical } = applyProfile(row, INVESTORFUSE_PROFILE);
    expect(canonical.sellerFirst).toBe("Jane");
    expect(canonical.phone).toBe("(856) 555-0100");
    expect(canonical.email).toBe("jane@example.com");
    expect(canonical.campaign).toBe("Real Estate Bees");
    expect(canonical.dateCreated).toBe("2026-06-30");
  });
});
