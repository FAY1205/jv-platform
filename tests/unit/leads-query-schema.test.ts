import { describe, expect, it } from "vitest";
import { LeadsQuerySchema } from "@/modules/leads/schema";

// ADM/FEP-03: the global leads list — every query param is Zod-validated and
// normalized so the query layer only ever sees safe, canonical values.

const parse = (input: Record<string, unknown>) => LeadsQuerySchema.parse(input);

describe("LeadsQuerySchema", () => {
  it("applies defaults: page 1, mls all, empty filters", () => {
    expect(parse({})).toEqual({ q: "", page: 1, partnerId: null, state: "", mls: "all" });
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

  it("accepts only a UUID partnerId, else null", () => {
    const uuid = "e2aaef6e-46d6-4e06-a903-4a0f85da68fa";
    expect(parse({ partnerId: uuid }).partnerId).toBe(uuid);
    expect(parse({ partnerId: "not-a-uuid" }).partnerId).toBeNull();
  });

  it("restricts mls to kept | removed | all", () => {
    expect(parse({ mls: "kept" }).mls).toBe("kept");
    expect(parse({ mls: "removed" }).mls).toBe("removed");
    expect(parse({ mls: "everything" }).mls).toBe("all");
  });
});
