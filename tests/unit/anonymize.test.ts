import { describe, expect, it } from "vitest";
import { evaluate } from "@/modules/pipeline/mls";
import { DEFAULT_MLS_PATTERNS } from "@/modules/pipeline/mls-patterns";
import { anonymizeRow } from "../../scripts/anonymize";

// The anonymizer turns a real InvestorFuse row into a committable, PII-free fixture row.
// It MUST preserve every field that drives a pipeline decision (Campaign, State, Zip Code,
// and the MLS listing answer in Notes) so the eventual TST-05 golden matches the owner's
// hand-verified real week — while scrubbing all seller PII (SEC-05) and the free-text /
// Comments columns that can carry names, phones and emails.

const realRow: Record<string, string> = {
  Campaign: "Real Estate Bees",
  "Street Address": "142 Garden State Ave",
  City: "Cherry Hill",
  State: "NJ",
  "Zip Code": "08034",
  "Seller First Name": "Jane",
  "Seller Last Name": "Doe",
  "Seller Email": "jane.doe@gmail.com",
  "Seller Phone": "(856) 555-0100",
  "Seller Street Address": "9 Private Ln",
  Notes: "Is it Listed? : Yes  If Yes, MLS Date Active :\nSeller Jane can be reached at 856-555-0100; owned since 2019.",
  Comments: "jane.doe@gmail.com / Mobile : (856) 555-0100 / No Answer/No VM - null",
};

describe("SEC-05: anonymizeRow scrubs seller PII", () => {
  it("replaces name, email, phone and seller street with non-real values", () => {
    const anon = anonymizeRow(realRow, 7);
    expect(anon["Seller First Name"]).not.toBe("Jane");
    expect(anon["Seller Last Name"]).not.toBe("Doe");
    expect(anon["Seller Email"]).not.toContain("jane.doe@gmail.com");
    expect(anon["Seller Email"]).toMatch(/@example\.(test|com)$/);
    expect(anon["Seller Phone"]).not.toBe("(856) 555-0100");
    expect(anon["Seller Street Address"]).not.toBe("9 Private Ln");
  });

  it("drops Comments entirely (raw-only column, carries PII)", () => {
    expect(anonymizeRow(realRow, 7).Comments).toBe("");
  });

  it("replaces the property Street Address deterministically (same n ⇒ same output)", () => {
    const a = anonymizeRow(realRow, 7);
    const b = anonymizeRow(realRow, 7);
    expect(a["Street Address"]).not.toBe("142 Garden State Ave");
    expect(a["Street Address"]).toBe(b["Street Address"]);
  });
});

describe("TST-05: anonymizeRow preserves decision inputs", () => {
  it("keeps Campaign, City, State and the property Zip Code verbatim", () => {
    const anon = anonymizeRow(realRow, 7);
    expect(anon.Campaign).toBe("Real Estate Bees");
    expect(anon.City).toBe("Cherry Hill");
    expect(anon.State).toBe("NJ");
    expect(anon["Zip Code"]).toBe("08034");
  });

  it("keeps the MLS listing line in Notes but strips the PII-bearing free text", () => {
    const anon = anonymizeRow(realRow, 7);
    expect(anon.Notes).toContain("Is it Listed? : Yes");
    expect(anon.Notes).not.toContain("Jane");
    expect(anon.Notes).not.toContain("856-555-0100");
  });

  it("preserves the MLS verdict: anonymized Notes evaluates like the real Notes", () => {
    const anon = anonymizeRow(realRow, 7);
    expect(evaluate(anon.Notes, DEFAULT_MLS_PATTERNS).verdict).toBe(
      evaluate(realRow.Notes, DEFAULT_MLS_PATTERNS).verdict,
    );
  });

  it("a note with no listing question becomes blank (still MLS-kept)", () => {
    const row = { ...realRow, Notes: "### Negotiation points: owner Jane wants a fast close." };
    const anon = anonymizeRow(row, 3);
    expect(anon.Notes).toBe("");
    expect(anon.Notes).not.toContain("Jane");
    expect(evaluate(anon.Notes, DEFAULT_MLS_PATTERNS).verdict).toBe("kept");
  });
});
