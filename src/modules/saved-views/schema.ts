import { z } from "zod";
import { LeadsQuerySchema, DEFAULT_STATUS_FILTERS } from "@/modules/leads/schema";

// WP-SV-1 (SV-01/SV-02) — the saved-view contracts.
//
// The filters BLOB is the interesting one. A saved view stores the leads page's whole filter
// state as jsonb, and the one rule that keeps that safe is: it is never stored blind. The
// schema below is COMPOSED from `LeadsQuerySchema` (the list's own query validators) by
// `.pick()` — not re-derived — so there is exactly ONE definition of what `state`, `statuses`,
// `tags` or a date range mean. A filter the list would normalize is normalized identically on
// the way into storage, a filter the list would drop is dropped, and a key the list has never
// heard of is STRIPPED by the object schema before it reaches Postgres.
//
// Two consequences of that composition are deliberate:
//
//   • FIELD-level input degrades rather than 400s (the list's contract: "a filter UI should
//     degrade, not error"). `?state=Arizona` becomes no state filter here exactly as it does
//     on the list. What DOES 400 is a blob that isn't an object at all, or a body carrying a
//     key the API doesn't own — see CreateSavedViewSchema's strictness below.
//   • The stored shape is CANONICAL, so two clients that describe the same view produce the
//     same bytes, which is what makes `savedViewKey` (SV-04) a trustworthy divergence oracle.
//
// NOT in the blob, on purpose: `page`/`pageSize` (transient position, never a filter) and
// `sort`/`dir`. Sorting is a column-header gesture, not a filter — a saved view that silently
// re-ordered the table would be a second, invisible thing the name doesn't say. Recorded
// decision; if operators ask for it, it is an additive key, and old blobs degrade to the
// default because every field here is optional.

/** SV-01: a view name is a short human label (column is text; this is the contract). */
export const SAVED_VIEW_NAME_MAX = 60;

export const SavedViewNameSchema = z.string().trim().min(1).max(SAVED_VIEW_NAME_MAX);

/** The leads page's own filter validators, reused verbatim (SV-02). */
const LeadsFilterState = LeadsQuerySchema.pick({
  q: true,
  partnerId: true,
  state: true,
  source: true,
  statuses: true,
  hot: true,
  tags: true,
  dateFrom: true,
  dateTo: true,
});

/** SV-01: list vs board rides in the blob because applying a view REPLACES the whole filter
 *  state, and the mode is part of "what I was looking at". Same degrade-to-default shape as
 *  lib/preferences' `parsePreferences` — an unknown mode is the list, never an error. */
// The literal union mirrors `LeadsViewPref` (lib/preferences) rather than importing it: that
// module is the client-side preferences STORE ("use client"), and a server-side Zod contract
// must not pull it in. The annotation is what keeps the union from widening to `string`.
const viewModeParam = z
  .unknown()
  .optional()
  .transform((v): "list" | "board" => (v === "board" ? "board" : "list"));

/**
 * SV-02 — the stored blob. `z.object` strips unknown keys; the trailing transform normalizes
 * the two nullable/optional shapes the QUERY validators produce (`partnerId: null`,
 * `dateFrom: undefined`) into the empty strings the leads page's `Filters` state uses, so a
 * view round-trips into the UI with no adapter in between — and so JSON.stringify of two
 * equal states can never differ by `null` vs `""` vs absent.
 */
export const SavedViewFiltersSchema = LeadsFilterState.extend({ viewMode: viewModeParam }).transform((f) => ({
  q: f.q,
  partnerId: f.partnerId ?? "",
  state: f.state,
  source: f.source,
  statuses: f.statuses,
  hot: f.hot,
  tags: f.tags,
  dateFrom: f.dateFrom ?? "",
  dateTo: f.dateTo ?? "",
  viewMode: f.viewMode,
}));

export type SavedViewFilters = z.infer<typeof SavedViewFiltersSchema>;

/** The leads page's opening state (all workflow statuses, Removed MLS off — owner decision),
 *  in blob shape. The one place the "nothing saved yet" view is spelled out. */
export const EMPTY_SAVED_VIEW_FILTERS: SavedViewFilters = {
  q: "",
  partnerId: "",
  state: "",
  source: "",
  statuses: [...DEFAULT_STATUS_FILTERS],
  hot: false,
  tags: [],
  dateFrom: "",
  dateTo: "",
  viewMode: "list",
};

/**
 * SV-04 — the divergence oracle. A canonical string for a filter state: array fields are
 * SORTED, so "Contacted then New" and "New then Contacted" are one view (the pills commit in
 * click order, which is not information). Pure: same input ⇒ same output, so the "modified"
 * indicator is a comparison, never a heuristic.
 */
export function savedViewKey(f: SavedViewFilters): string {
  return JSON.stringify([
    f.q,
    f.partnerId,
    f.state,
    f.source,
    [...f.statuses].sort(),
    f.hot,
    [...f.tags].sort(),
    f.dateFrom,
    f.dateTo,
    f.viewMode,
  ]);
}

/**
 * POST /api/saved-views. STRICT: `tenantId`/`userId` are the caller's identity, taken from the
 * server scope and never from a body, so a request that tries to name one is a 400 rather than
 * a silently-ignored field (SV-02 — "enforce user_id from scope, never client").
 */
export const CreateSavedViewSchema = z.strictObject({
  name: SavedViewNameSchema,
  filters: SavedViewFiltersSchema,
});

/**
 * PATCH /api/saved-views/[id] — rename and/or re-save the filters. The OVERWRITE path of
 * "Save current filters…" is this, addressed by id: POST always creates (and 409s on a
 * duplicate name), so nothing about the API is ambiguous about whether a row was replaced.
 */
export const UpdateSavedViewSchema = z
  .strictObject({
    name: SavedViewNameSchema.optional(),
    filters: SavedViewFiltersSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to change.");

export type CreateSavedViewInput = z.infer<typeof CreateSavedViewSchema>;
export type UpdateSavedViewInput = z.infer<typeof UpdateSavedViewSchema>;
