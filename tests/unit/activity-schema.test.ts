import { describe, it, expect } from "vitest";
import { ActivityQuerySchema } from "@/modules/activity/schema";
import { randomUUID } from "node:crypto";

// ACT-01: the admin activity filter contract. Everything normalizes to safe canonical
// values so the query layer never sees raw input; invalid shapes degrade, never 400.
const parse = (o: unknown) => ActivityQuerySchema.parse(o);

describe("ActivityQuerySchema (ACT-01)", () => {
  it("ACT-01: fills safe defaults for an empty query", () => {
    expect(parse({})).toEqual({ page: 1, pageSize: 20, category: "all", actor: "", q: "", dateFrom: "", dateTo: "", dir: "desc" });
  });

  it("ACT-01: whitelists pageSize to {10,20,50}", () => {
    expect(parse({ pageSize: "10" }).pageSize).toBe(10);
    expect(parse({ pageSize: "50" }).pageSize).toBe(50);
    expect(parse({ pageSize: "37" }).pageSize).toBe(20);
  });

  it("ACT-04: category accepts security/data, else falls back to all", () => {
    expect(parse({ category: "security" }).category).toBe("security");
    expect(parse({ category: "data" }).category).toBe("data");
    expect(parse({ category: "nope" }).category).toBe("all");
  });

  it("ACT-01: keeps a valid actor uuid, drops anything else", () => {
    const id = randomUUID();
    expect(parse({ actor: id }).actor).toBe(id);
    expect(parse({ actor: "not-a-uuid" }).actor).toBe("");
  });

  it("ACT-01: dir is asc or desc (default desc); dates must be yyyy-mm-dd", () => {
    expect(parse({ dir: "asc" }).dir).toBe("asc");
    expect(parse({ dir: "sideways" }).dir).toBe("desc");
    expect(parse({ dateFrom: "2026-07-01", dateTo: "bad" })).toMatchObject({ dateFrom: "2026-07-01", dateTo: "" });
  });

  it("ACT-01: trims + caps the search string", () => {
    expect(parse({ q: "  partner.created  " }).q).toBe("partner.created");
    expect(parse({ q: "x".repeat(200) }).q.length).toBe(80);
  });
});
