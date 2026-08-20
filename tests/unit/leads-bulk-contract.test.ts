import { describe, expect, it } from "vitest";
import {
  BulkFilterSchema,
  BulkSelectionSchema,
  BULK_REFS_MAX,
  BULK_SKIPPED_REFS_MAX,
  LeadsQuerySchema,
  canonicalBulkFilters,
  DEFAULT_STATUS_FILTERS,
} from "@/modules/leads/schema";
import { bulkFilterBody, leadsQueryParams, type LeadsFilterState } from "@/modules/leads/filter-wire";
import { describeFilters } from "@/modules/leads/filter-describe";

// WP-N6 T-6 — the write-side contract. The point of these tests is the DIVERGENCE from the
// read contract: the leads LIST degrades a bad filter to "no filter", and every case below
// that the list would degrade must 400 here instead. Each strictness assertion is paired with
// the list's own behaviour on the same input, so the divergence is visible rather than
// asserted in isolation — loosen `BulkFilterSchema` and the pair stops matching.

const EMPTY: LeadsFilterState = {
  q: "", partnerId: "", state: "", source: "", statuses: [], hot: false, tags: [], dateFrom: "", dateTo: "",
};
const UUID = "11111111-2222-3333-4444-555555555555";

describe("N6-01: BulkSelectionSchema", () => {
  it("N6-01: the refs arm accepts lead references and rejects anything else", () => {
    expect(BulkSelectionSchema.safeParse({ mode: "refs", leadRefs: ["LD-26-70001"] }).success).toBe(true);
    expect(BulkSelectionSchema.safeParse({ mode: "refs", leadRefs: [UUID] }).success).toBe(false);
    expect(BulkSelectionSchema.safeParse({ mode: "refs", leadRefs: [] }).success).toBe(false);
  });

  it("N6-01: the refs arm is bounded at the existing assign-bulk ceiling", () => {
    const refs = (n: number) => Array.from({ length: n }, (_, i) => `LD-26-7${String(i).padStart(4, "0")}`);
    expect(BulkSelectionSchema.safeParse({ mode: "refs", leadRefs: refs(BULK_REFS_MAX) }).success).toBe(true);
    expect(BulkSelectionSchema.safeParse({ mode: "refs", leadRefs: refs(BULK_REFS_MAX + 1) }).success).toBe(false);
    expect(BULK_REFS_MAX).toBe(200);
    expect(BULK_SKIPPED_REFS_MAX).toBe(500);
  });

  it("N6-01: the two arms are exclusive — a filter selection cannot smuggle an id list", () => {
    expect(
      BulkSelectionSchema.safeParse({ mode: "filter", filters: {}, leadRefs: ["LD-26-70001"] }).success,
    ).toBe(false);
    expect(BulkSelectionSchema.safeParse({ mode: "everything" }).success).toBe(false);
  });
});

describe("N6-02: the write filter is strict where the read filter degrades", () => {
  /** What the LIST does with the same value — the contract this one deliberately diverges from. */
  const asRead = (params: Record<string, unknown>) => LeadsQuerySchema.parse(params);

  it("N6-02: a malformed state 400s here and degrades to 'no filter' on the list", () => {
    expect(BulkFilterSchema.safeParse({ state: "Arizona" }).success).toBe(false);
    expect(asRead({ state: "Arizona" }).state).toBe(""); // the read contract, unchanged
    expect(BulkFilterSchema.parse({ state: "az" }).state).toBe("AZ");
  });

  it("N6-02: an unknown status 400s here and is silently dropped by the list", () => {
    expect(BulkFilterSchema.safeParse({ statuses: ["Nope"] }).success).toBe(false);
    expect(asRead({ statuses: "Nope" }).statuses).toEqual([]);
  });

  it("N6-02: a non-real date 400s here and degrades on the list", () => {
    expect(BulkFilterSchema.safeParse({ dateFrom: "2026-02-31" }).success).toBe(false);
    expect(asRead({ dateFrom: "2026-02-31" }).dateFrom).toBeUndefined();
    expect(BulkFilterSchema.safeParse({ dateFrom: "2026-02-28" }).success).toBe(true);
  });

  it("N6-02: `hot` must be a boolean here — the URL's '1' is a READ affordance", () => {
    expect(BulkFilterSchema.safeParse({ hot: "1" }).success).toBe(false);
    expect(asRead({ hot: "1" }).hot).toBe(true);
    expect(BulkFilterSchema.parse({ hot: true }).hot).toBe(true);
  });

  it("N6-02: a tag id that isn't a uuid 400s here and is filtered out by the list", () => {
    expect(BulkFilterSchema.safeParse({ tags: ["not-a-uuid"] }).success).toBe(false);
    expect(asRead({ tags: "not-a-uuid" }).tags).toEqual([]);
  });

  it("N6-02: a key the filter doesn't own is a 400, not an ignored field", () => {
    // `page`/`pageSize`/`sort` are position, not filter — they must never reach a resolver.
    for (const key of ["page", "pageSize", "sort", "dir", "viewMode", "tenantId"]) {
      expect(BulkFilterSchema.safeParse({ [key]: 1 }).success, key).toBe(false);
    }
  });

  it("N6-02: the canonical empties round-trip — an unset control is not a malformed value", () => {
    const parsed = BulkFilterSchema.parse({ q: "", partnerId: "", state: "", source: "", dateFrom: "", dateTo: "" });
    expect(canonicalBulkFilters(parsed)).toEqual(EMPTY);
    expect(BulkFilterSchema.parse({ partnerId: "unmatched" }).partnerId).toBe("unmatched");
    expect(BulkFilterSchema.safeParse({ partnerId: "nope" }).success).toBe(false);
  });
});

describe("N6-50: one serializer for the list query and the bulk filter body", () => {
  const filters: LeadsFilterState = {
    ...EMPTY,
    q: "smith",
    partnerId: UUID,
    state: "TX",
    source: "Weekly",
    statuses: ["New", "Contacted"],
    hot: true,
    tags: [UUID],
    dateFrom: "2026-01-01",
    dateTo: "2026-02-01",
  };

  it("N6-50: every field the GET sends is a field the bulk body sends", () => {
    const params = leadsQueryParams(filters, { sort: "received", dir: "desc", page: 1, pageSize: 20 });
    const body = bulkFilterBody(filters);
    expect(params.get("q")).toBe("smith");
    expect(params.get("statuses")).toBe("New,Contacted");
    expect(params.get("hot")).toBe("1");
    // The bulk body is the SAME state in the write contract's shape, and it parses.
    expect(BulkFilterSchema.parse(body)).toMatchObject({
      q: "smith", partnerId: UUID, state: "TX", source: "Weekly", hot: true,
      statuses: ["New", "Contacted"], tags: [UUID], dateFrom: "2026-01-01", dateTo: "2026-02-01",
    });
  });

  it("N6-50: filters that are OFF are omitted from both, never sent as empty strings", () => {
    const params = leadsQueryParams(EMPTY, { sort: "received", dir: "desc", page: 2, pageSize: 50 });
    expect(params.has("state")).toBe(false);
    expect(params.has("hot")).toBe(false);
    expect(params.get("page")).toBe("2");
    const body = bulkFilterBody(EMPTY);
    expect(body).toEqual({ statuses: [] });
    expect(BulkFilterSchema.safeParse(body).success).toBe(true);
  });
});

describe("N6-53: the filter, named in words", () => {
  it("N6-53: names each active clause, resolving ids through the rosters it is given", () => {
    const words = describeFilters(
      { ...EMPTY, state: "TX", hot: true, tags: [UUID], partnerId: "p1" },
      { partners: new Map([["p1", "Alpha (JV-001)"]]), tags: new Map([[UUID, "Probate"]]) },
    );
    expect(words).toBe("partner Alpha (JV-001) · TX · Hot only · tagged Probate");
  });

  it("N6-53: an unknown id degrades to the id — an active filter is never invisible", () => {
    expect(describeFilters({ ...EMPTY, tags: [UUID] })).toBe(`tagged ${UUID}`);
  });

  it("N6-53: the DEFAULT status selection is not a clause (nobody chose it)", () => {
    expect(describeFilters({ ...EMPTY, statuses: [...DEFAULT_STATUS_FILTERS] })).toBe("");
    expect(describeFilters({ ...EMPTY, statuses: ["Dead"] })).toBe("status Dead");
  });

  it("N6-53: no filters means no words, so the caller can say 'the current view' instead", () => {
    expect(describeFilters(EMPTY)).toBe("");
  });
});
