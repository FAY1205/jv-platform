import { z } from "zod";

// Global leads list query params (ADM). Zod-normalizes everything to canonical
// values so the query layer never sees raw user input; invalid shapes fall back
// to safe defaults instead of erroring — a filter UI should degrade, not 400.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The 6 workflow statuses + the read-only "Removed MLS" verdict (filterable).
export const LEAD_STATUS_FILTERS = ["New", "Contacted", "Appointment", "Under contract", "Closed", "Dead", "Removed MLS"] as const;
export type LeadStatusFilter = (typeof LEAD_STATUS_FILTERS)[number];

const SORT_FIELDS = ["received", "modified", "status", "partner", "seller"] as const;
export type LeadSortField = (typeof SORT_FIELDS)[number];

const csv = (v: unknown, allowed: readonly string[]): string[] => {
  const raw = typeof v === "string" ? v.split(",") : Array.isArray(v) ? v.map(String) : [];
  return raw.map((s) => s.trim()).filter((s) => allowed.includes(s));
};
const dateOr = (v: unknown): string => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

export const LeadsQuerySchema = z.object({
  q: z.unknown().optional().transform((v) => (typeof v === "string" ? v.trim().slice(0, 120) : "")),
  page: z.unknown().optional().transform((v) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= 1 ? n : 1;
  }),
  /** Rows per page — whitelisted to {10,20,50} (mirrors Pagination.PAGE_SIZES), default 20. */
  pageSize: z.unknown().optional().transform((v) => {
    const n = Math.floor(Number(v));
    return n === 10 || n === 50 ? n : 20;
  }),
  partnerId: z.unknown().optional().transform((v) => (typeof v === "string" && UUID_RE.test(v) ? v : v === "unmatched" ? "unmatched" : null)),
  state: z.unknown().optional().transform((v) => (typeof v === "string" && /^[a-z]{2}$/i.test(v.trim()) ? v.trim().toUpperCase() : "")),
  /** Multi-select workflow-status + "Removed MLS" filter (comma-separated). */
  statuses: z.unknown().optional().transform((v) => csv(v, LEAD_STATUS_FILTERS)),
  /** Lead-source / campaign exact match. */
  source: z.unknown().optional().transform((v) => (typeof v === "string" ? v.trim().slice(0, 80) : "")),
  dateFrom: z.unknown().optional().transform(dateOr),
  dateTo: z.unknown().optional().transform(dateOr),
  sort: z.unknown().optional().transform((v) => (SORT_FIELDS.includes(v as LeadSortField) ? (v as LeadSortField) : "received")),
  dir: z.unknown().optional().transform((v) => (v === "asc" ? "asc" : "desc")),
});

export type LeadsQuery = z.infer<typeof LeadsQuerySchema>;
