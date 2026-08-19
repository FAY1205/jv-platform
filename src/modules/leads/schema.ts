import { z } from "zod";
import { pageParam, pageSizeParam, dateParam } from "@/lib/query-params";
import { SEED_LEAD_STATUSES } from "@/modules/portal/statuses";
import { tagsParam } from "@/modules/tags/schema";
import { BOARD_MAX_PAGE } from "./board";

// Global leads list query params (ADM). Zod-normalizes everything to canonical
// values so the query layer never sees raw user input; invalid shapes fall back
// to safe defaults instead of erroring — a filter UI should degrade, not 400.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The 6 workflow statuses + the read-only "Removed MLS" verdict (filterable).
export const LEAD_STATUS_FILTERS = ["New", "Contacted", "Appointment", "Under contract", "Closed", "Dead", "Removed MLS"] as const;
export type LeadStatusFilter = (typeof LEAD_STATUS_FILTERS)[number];

// The leads list opens with every workflow status selected but "Removed MLS" off, so
// MLS-filtered leads don't clutter the default view (owner decision). Clearing the
// status filter (selecting none) falls back to showing everything.
export const DEFAULT_STATUS_FILTERS = LEAD_STATUS_FILTERS.filter((s) => s !== "Removed MLS");

/** True when a status selection equals the default (all workflow statuses, no Removed MLS). */
export function isDefaultStatuses(statuses: readonly string[]): boolean {
  return (
    statuses.length === DEFAULT_STATUS_FILTERS.length &&
    DEFAULT_STATUS_FILTERS.every((s) => statuses.includes(s))
  );
}

// Sortable columns (owner note): Lead (by reference number), Seller, Received, Modified.
// Partner and Status are deliberately NOT sortable.
const SORT_FIELDS = ["lead", "received", "modified", "seller"] as const;
export type LeadSortField = (typeof SORT_FIELDS)[number];

/**
 * How many comma-separated segments a csv param is split into before ANY validation
 * (audit-tenancy F-1, the `tagsParam` treatment applied one param over). The allow-list below
 * bounds the RESULT, but not the parse: `?statuses=` accepts an arbitrary query string from an
 * untrusted URL, and `"a,".repeat(500_000).split(",")` materialises half a million strings
 * before `includes()` ever runs. A generous multiple of the longest allow-list, so a
 * legitimate request can never reach the bound.
 */
const CSV_MAX_SEGMENTS = 64;

/** A comma-separated (or array) param narrowed to an allow-list. Bounded split, de-duplicated,
 *  and bounded on the array branch too — a crafted URL cannot widen the IN-list either. */
const csv = (v: unknown, allowed: readonly string[]): string[] => {
  const raw =
    typeof v === "string"
      ? // The limit argument bounds the ARRAY, not just the result — the whole point.
        v.split(",", CSV_MAX_SEGMENTS)
      : Array.isArray(v)
        ? v.slice(0, CSV_MAX_SEGMENTS).map(String)
        : [];
  const seen = new Set<string>();
  for (const s of raw) {
    const value = s.trim();
    if (allowed.includes(value)) seen.add(value);
  }
  return [...seen];
};

/**
 * `?partnerId=` — a partner UUID, or the "unmatched" sentinel the query layer treats specially;
 * anything else degrades to null (no partner filter) rather than 400-ing.
 *
 * N3C-05/C-69: extracted so the LIST endpoint, the BOARD endpoint and the /leads server shell
 * (which now accepts ?partnerId= for the partner-detail "View all in Leads →" deep link) all
 * validate the param through ONE definition — a crafted URL cannot mean one thing to the page
 * and another to the API it calls, and the shell never hand-rolls its own UUID check.
 */
export const partnerIdParam = () =>
  z.unknown().optional().transform((v) => (typeof v === "string" && UUID_RE.test(v) ? v : v === "unmatched" ? "unmatched" : null));

export const LeadsQuerySchema = z.object({
  q: z.unknown().optional().transform((v) => (typeof v === "string" ? v.trim().slice(0, 120) : "")),
  page: pageParam(),
  pageSize: pageSizeParam(),
  partnerId: partnerIdParam(),
  state: z.unknown().optional().transform((v) => (typeof v === "string" && /^[a-z]{2}$/i.test(v.trim()) ? v.trim().toUpperCase() : "")),
  /** Multi-select workflow-status + "Removed MLS" filter (comma-separated). */
  statuses: z.unknown().optional().transform((v) => csv(v, LEAD_STATUS_FILTERS)),
  /** Hot-leads-only filter (SCR). Shows only kept leads whose score group is Hot. */
  hot: z.unknown().optional().transform((v) => v === "1" || v === "true" || v === true),
  /** TAG-03: OR / any-of tag filter (comma-separated tag ids). Shared parser with the
   *  board, so `?tags=` means exactly one thing across both endpoints. */
  tags: tagsParam(),
  /** Lead-source / campaign exact match. */
  source: z.unknown().optional().transform((v) => (typeof v === "string" ? v.trim().slice(0, 80) : "")),
  // D3: the shared dateParam() (lib/query-params) — same YYYY-MM-DD shape check plus
  // the round-trip guard ("2026-02-31" degrades to no-filter instead of flowing into
  // the query layer); invalid/missing → undefined (was ""), same falsy contract.
  dateFrom: dateParam(),
  dateTo: dateParam(),
  sort: z.unknown().optional().transform((v) => (SORT_FIELDS.includes(v as LeadSortField) ? (v as LeadSortField) : "received")),
  dir: z.unknown().optional().transform((v) => (v === "asc" ? "asc" : "desc")),
});

export type LeadsQuery = z.infer<typeof LeadsQuerySchema>;

// ── Board view (KAN-02) — GET /api/leads/board query params ───────────────────
// The board carries over exactly two of the list's filters (KAN-09: partner + hot);
// `status` narrows the response to ONE column's next page ("Load more"), `page` is
// that column's 1-based page. Same graceful contract as the list: a nonsense param
// degrades to the default instead of 400-ing.

export const BoardQuerySchema = z
  .object({
    /** One of the six workflow statuses → load more for that column only; else the whole board.
     *  Anything else (including the read-only "Removed MLS" verdict) degrades to null: the
     *  removed verdict is not a column and can never become one (KAN-08). */
    status: z.unknown().optional().transform((v) => ((SEED_LEAD_STATUSES as readonly string[]).includes(v as string) ? (v as string) : null)),
    // Clamped (tenancy F-4): an absurd `?page=1e308` would otherwise multiply into a
    // non-finite offset and blow up in the driver instead of degrading.
    page: pageParam({ max: BOARD_MAX_PAGE }),
    partnerId: partnerIdParam(),
    hot: z.unknown().optional().transform((v) => v === "1" || v === "true" || v === true),
    /** KAN-09 + TAG-03: shared parser with the list (one meaning for `?tags=`). */
    tags: tagsParam(),
    /** WP-UX-3 (audit 2.3): the board carries the WHOLE list filter set — the two views are
     *  one filter bar, so nothing on screen is silently ignored when the mode flips. The
     *  field schemas are the LIST's own (`LeadsQuerySchema.shape.*`, the SV-02 composition
     *  precedent) — `?q=`/`?state=` can never mean two things across the two endpoints.
     *  `statuses` stays list-only on purpose: the board's columns ARE the status filter. */
    q: LeadsQuerySchema.shape.q,
    state: LeadsQuerySchema.shape.state,
    source: LeadsQuerySchema.shape.source,
    dateFrom: LeadsQuerySchema.shape.dateFrom,
    dateTo: LeadsQuerySchema.shape.dateTo,
  })
  // `page` is a per-COLUMN cursor: it only means anything alongside `status` (pr F-1).
  // Without one it is normalized away, so `?page=3` returns page 1 of every column and
  // the echoed `page` stays truthful rather than paging all six columns at once.
  .transform((q) => (q.status ? q : { ...q, page: 1 }));

export type BoardQuery = z.infer<typeof BoardQuerySchema>;

// ── Admin lead edit (ADM) — PATCH /api/leads/[ref] input contract ──────────────
// Canonical field corrections + an optional partner re-routing intent. The partner
// discriminated union mirrors PartnerEdit in modules/leads/commands: "unassign"
// clears the manual overlay (PRN-05-safe; the command rejects it for pipeline-routed
// leads). Lives here (not in the route) so it is unit-testable without Next server deps.

const editStr = (max: number) => z.string().trim().max(max).optional();

export const EditLeadSchema = z.object({
  fields: z
    .object({
      sellerFirst: editStr(120),
      sellerLast: editStr(120),
      phone: editStr(40),
      email: editStr(160),
      address: editStr(200),
      city: editStr(120),
      state: z.string().trim().regex(/^[A-Za-z]{0,2}$/).transform((s) => s.toUpperCase()).optional(),
      zip: editStr(12),
      campaign: editStr(80),
      reasonForSelling: editStr(400),
      motivation: editStr(400),
      timeToSell: editStr(120),
      notes: editStr(4000),
    })
    .default({}),
  partner: z
    .discriminatedUnion("action", [
      z.object({ action: z.literal("keep") }),
      z.object({ action: z.literal("set"), partnerId: z.string().uuid() }),
      z.object({ action: z.literal("revert") }),
      z.object({ action: z.literal("unassign") }),
    ])
    .default({ action: "keep" }),
});

export type EditLeadInputShape = z.infer<typeof EditLeadSchema>;
