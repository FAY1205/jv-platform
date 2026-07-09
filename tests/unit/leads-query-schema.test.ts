import { describe, expect, it } from "vitest";
import { LeadsQuerySchema } from "@/modules/leads/schema";

// ADM/FEP-03: the global leads list — every query param is Zod-validated and
// normalized so the query layer only ever sees safe, canonical values.

const parse = (input: Record<string, unknown>) => LeadsQuerySchema.parse(input);

describe("LeadsQuerySchema", () => {
  it("applies defaults: page 1, received-desc sort, empty filters", () => {
    expect(parse({})).toEqual({ q: "", page: 1, partnerId: null, state: "", statuses: [], source: "", dateFrom: "", dateTo: "", sort: "received", dir: "desc" });
  });

  it("coerces page from string and floors invalid values to 1", () => {
    expect(parse({ page: "3" }).page).toBe(3);
    expect(parse({ page: "0" }).page).toBe(1);
    expect(parse({ page: "-2" }).page).toBe(1);
    expect(parse({ page: "abc" }).page).toBe(1);
  });

  it("trims and caps the search text", () => {
    expect(parse({ q: "  main st  " }).q).toBe("main st");
    expect(parse({ q: "x".repeat(300) }).q).toHaveLength(120);
  });

  it("uppercases a 2-letter state and rejects other shapes to empty", () => {
    expect(parse({ state: "nj" }).state).toBe("NJ");
    expect(parse({ state: "New Jersey" }).state).toBe("");
    expect(parse({ state: "1" }).state).toBe("");
  });

  it("accepts a UUID partnerId or the 'unmatched' sentinel, else null", () => {
    const uuid = "e2aaef6e-46d6-4e06-a903-4a0f85da68fa";
    expect(parse({ partnerId: uuid }).partnerId).toBe(uuid);
    expect(parse({ partnerId: "unmatched" }).partnerId).toBe("unmatched");
    expect(parse({ partnerId: "not-a-uuid" }).partnerId).toBeNull();
  });

  it("keeps only valid statuses from a comma list", () => {
    expect(parse({ statuses: "New,Closed,Bogus,Removed MLS" }).statuses).toEqual(["New", "Closed", "Removed MLS"]);
    expect(parse({ statuses: "" }).statuses).toEqual([]);
  });

  it("validates date range as YYYY-MM-DD, else empty", () => {
    expect(parse({ dateFrom: "2026-01-15" }).dateFrom).toBe("2026-01-15");
    expect(parse({ dateFrom: "01/15/2026" }).dateFrom).toBe("");
  });

  it("restricts sort field + direction to known values", () => {
    expect(parse({ sort: "modified", dir: "asc" })).toMatchObject({ sort: "modified", dir: "asc" });
    expect(parse({ sort: "nonsense", dir: "sideways" })).toMatchObject({ sort: "received", dir: "desc" });
  });
});
