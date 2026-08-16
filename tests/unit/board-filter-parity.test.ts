import { describe, expect, it } from "vitest";
import { BoardQuerySchema, LeadsQuerySchema } from "@/modules/leads/schema";

// WP-UX-3 (audit 2.3) — filter parity. The board's q/state/source/date validators ARE
// the list's (`LeadsQuerySchema.shape.*`), so `?q=` can never mean two things across
// the two endpoints; these tests pin the composition, not a re-implementation.

describe("Board filter parity (WP-UX-3)", () => {
  it("UX3-02: q/state/source/date parse with the LIST's degrade semantics", () => {
    const q = BoardQuerySchema.parse({
      q: "  Whitfield  ",
      state: "az",
      source: " Zillow FSBO ",
      dateFrom: "2026-08-01",
      dateTo: "2026-02-31", // impossible date → degrades to no filter, like the list
    });
    expect(q.q).toBe("Whitfield");
    expect(q.state).toBe("AZ");
    expect(q.source).toBe("Zillow FSBO");
    expect(q.dateFrom).toBe("2026-08-01");
    expect(q.dateTo).toBeUndefined();

    // Garbage degrades, never 400s (the board contract).
    const junk = BoardQuerySchema.parse({ q: 42, state: "Arizona", source: null, dateFrom: "nope" });
    expect(junk.q).toBe("");
    expect(junk.state).toBe("");
    expect(junk.source).toBe("");
    expect(junk.dateFrom).toBeUndefined();
  });

  it("UX3-03: statuses stays LIST-only — the board's columns are the status filter", () => {
    const parsed = BoardQuerySchema.parse({ statuses: "New,Contacted" });
    expect("statuses" in parsed).toBe(false);
    // …while the list still owns it.
    expect(LeadsQuerySchema.parse({ statuses: "New,Contacted" }).statuses).toEqual(["New", "Contacted"]);
  });
});
