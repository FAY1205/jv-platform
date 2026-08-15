import { z } from "zod";
import { pageParam, pageSizeParam, dateParam } from "@/lib/query-params";
import { SEED_LEAD_STATUSES } from "@/modules/portal/statuses";

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

const csv = (v: unknown, allowed: readonly string[]): string[] => {
  const raw = typeof v === "string" ? v.split(",") : Array.isArray(v) ? v.map(String) : [];
  return raw.map((s) => s.trim()).filter((s) => allowed.includes(s));
};

export const LeadsQuerySchema = z.object({
  q: z.unknown().optional().transform((v) => (typeof v === "string" ? v.trim().slice(0, 120) : "")),
  page: pageParam(),
  pageSize: pageSizeParam(),
  partnerId: z.unknown().optional().transform((v) => (typeof v === "string" && UUID_RE.test(v) ? v : v === "unmatched" ? "unmatched" : null)),
  state: z.unknown().optional().transform((v) => (typeof v === "string" && /^[a-z]{2}$/i.test(v.trim()) ? v.trim().toUpperCase() : "")),
  /** Multi-select workflow-status + "Removed MLS" filter (comma-separated). */
  statuses: z.unknown().optional().transform((v) => csv(v, LEAD_STATUS_FILTERS)),
  /** Hot-leads-only filter (SCR). Shows only kept leads whose score group is Hot. */
  hot: z.unknown().optional().transform((v) => v === "1" || v === "true" || v === true),
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

export const BoardQuerySchema = z.object({
  /** One of the six workflow statuses → load more for that column only; else the whole board. */
  status: z.unknown().optional().transform((v) => ((SEED_LEAD_STATUSES as readonly string[]).includes(v as string) ? (v as string) : null)),
  page: pageParam(),
  partnerId: z.unknown().optional().transform((v) => (typeof v === "string" && UUID_RE.test(v) ? v : v === "unmatched" ? "unmatched" : null)),
  hot: z.unknown().optional().transform((v) => v === "1" || v === "true" || v === true),
});

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
