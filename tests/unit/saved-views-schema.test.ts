import { describe, it, expect } from "vitest";
import {
  SavedViewFiltersSchema, CreateSavedViewSchema, UpdateSavedViewSchema,
  EMPTY_SAVED_VIEW_FILTERS, savedViewKey, SAVED_VIEW_NAME_MAX,
} from "@/modules/saved-views/schema";
import { DEFAULT_STATUS_FILTERS } from "@/modules/leads/schema";

// WP-SV-1 / SV-02 — the filters BLOB contract. The whole point of the schema is that a saved
// view can never store something the leads page can't apply: it is COMPOSED from the leads
// list's own query validators (never a second, drifting copy of them), so a filter that the
// list would degrade degrades identically on the way into storage.

const A = "11111111-2222-3333-4444-555555555555";
const B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("SV-02: the saved-view filters blob", () => {
  it("SV-02: parses the full leads filter state incl. the view mode", () => {
    const parsed = SavedViewFiltersSchema.parse({
      q: "  cactus  ",
      partnerId: A,
      state: "az",
      source: "Lead Source 1",
      statuses: "New,Contacted",
      hot: true,
      tags: `${A},${B}`,
      dateFrom: "2026-01-01",
      dateTo: "2026-02-01",
      viewMode: "board",
    });
    expect(parsed).toEqual({
      q: "cactus",
      partnerId: A,
      state: "AZ", // normalized by the list's own validator, not a copy of it
      source: "Lead Source 1",
      statuses: ["New", "Contacted"],
      hot: true,
      tags: [A, B],
      dateFrom: "2026-01-01",
      dateTo: "2026-02-01",
      viewMode: "board",
    });
  });

  it("SV-02: unknown keys are STRIPPED — a blob is never stored blind", () => {
    const parsed = SavedViewFiltersSchema.parse({
      q: "x",
      evil: "<script>",
      pageSize: 10_000,
      sort: "seller",
      nested: { deep: [1, 2, 3] },
    });
    expect(Object.keys(parsed).sort()).toEqual(
      ["dateFrom", "dateTo", "hot", "partnerId", "q", "source", "state", "statuses", "tags", "viewMode"],
    );
    expect(JSON.stringify(parsed)).not.toContain("script");
  });

  it("SV-02: a non-object blob is REJECTED (not coerced into an empty view)", () => {
    for (const bad of ["nope", 42, null, [], true]) {
      expect(SavedViewFiltersSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("SV-02: garbage FIELD values degrade exactly as the leads list degrades them", () => {
    // The list's contract is "a filter UI degrades, it does not 400" — inherited here on
    // purpose, so a view can hold nothing the list would reject.
    const parsed = SavedViewFiltersSchema.parse({
      q: 123,
      partnerId: "not-a-uuid",
      state: "Arizona",
      statuses: ["New", "Bogus"],
      hot: "maybe",
      tags: "not-a-uuid,also-bad",
      dateFrom: "2026-02-31", // round-trip guard in dateParam()
      viewMode: "chart",
    });
    expect(parsed).toEqual({
      q: "", partnerId: "", state: "", source: "", statuses: ["New"], hot: false,
      tags: [], dateFrom: "", dateTo: "", viewMode: "list",
    });
  });

  it("SV-02: the client's own empty-state shape round-trips unchanged", () => {
    expect(SavedViewFiltersSchema.parse(EMPTY_SAVED_VIEW_FILTERS)).toEqual(EMPTY_SAVED_VIEW_FILTERS);
    expect(EMPTY_SAVED_VIEW_FILTERS.statuses).toEqual([...DEFAULT_STATUS_FILTERS]);
  });

  it("SV-02: the 'unmatched' partner sentinel survives (it is not a uuid)", () => {
    expect(SavedViewFiltersSchema.parse({ partnerId: "unmatched" }).partnerId).toBe("unmatched");
  });
});

describe("SV-04: savedViewKey — the divergence oracle", () => {
  const base = { ...EMPTY_SAVED_VIEW_FILTERS, tags: [A, B], statuses: ["New", "Contacted"] };

  it("SV-04: equal filter states produce equal keys regardless of ARRAY ORDER", () => {
    const shuffled = { ...base, tags: [B, A], statuses: ["Contacted", "New"] };
    expect(savedViewKey(shuffled)).toBe(savedViewKey(base));
  });

  it("SV-04: any single field change produces a different key", () => {
    const variants = [
      { ...base, q: "x" }, { ...base, partnerId: A }, { ...base, state: "AZ" },
      { ...base, source: "s" }, { ...base, hot: true }, { ...base, tags: [A] },
      { ...base, statuses: ["New"] }, { ...base, dateFrom: "2026-01-01" },
      { ...base, dateTo: "2026-01-01" }, { ...base, viewMode: "board" as const },
    ];
    for (const v of variants) expect(savedViewKey(v), JSON.stringify(v)).not.toBe(savedViewKey(base));
  });
});

describe("SV-02: the create/update body contracts", () => {
  it("SV-01: a name is trimmed, required, and capped at 60", () => {
    expect(CreateSavedViewSchema.parse({ name: "  Hot in AZ  ", filters: {} }).name).toBe("Hot in AZ");
    expect(CreateSavedViewSchema.safeParse({ name: "   ", filters: {} }).success).toBe(false);
    expect(CreateSavedViewSchema.safeParse({ name: "x".repeat(SAVED_VIEW_NAME_MAX + 1), filters: {} }).success).toBe(false);
    expect(CreateSavedViewSchema.safeParse({ name: "x".repeat(SAVED_VIEW_NAME_MAX), filters: {} }).success).toBe(true);
  });

  it("SV-02: create is STRICT — a stray key (incl. a smuggled user_id) is a 400, never stored", () => {
    for (const bad of [
      { name: "v" }, // filters missing
      { name: "v", filters: {}, userId: A },
      { name: "v", filters: {}, user_id: A },
      { name: "v", filters: {}, tenantId: A },
      { filters: {} },
    ]) {
      expect(CreateSavedViewSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("SV-02: update takes a rename and/or a re-save, but never nothing", () => {
    expect(UpdateSavedViewSchema.safeParse({ name: "New name" }).success).toBe(true);
    expect(UpdateSavedViewSchema.safeParse({ filters: { hot: true } }).success).toBe(true);
    expect(UpdateSavedViewSchema.safeParse({}).success).toBe(false);
    expect(UpdateSavedViewSchema.safeParse({ name: "n", userId: A }).success).toBe(false);
    // …and the blob it carries is the same validated one. An OMITTED `statuses` means "no
    // status filter" (the list's own meaning of an absent param) — not the page's opening
    // default, which only `EMPTY_SAVED_VIEW_FILTERS` spells out.
    const parsed = UpdateSavedViewSchema.parse({ filters: { hot: true, evil: 1 } });
    expect(parsed.filters).toEqual({ ...EMPTY_SAVED_VIEW_FILTERS, hot: true, statuses: [] });
  });
});
