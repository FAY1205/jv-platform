import { z } from "zod";

// ACT-01: admin activity list query params. Zod normalizes everything to canonical values
// so the query layer never sees raw input; invalid shapes degrade to safe defaults (never 400).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ACTIVITY_CATEGORY_FILTERS = ["all", "security", "data"] as const;
export type ActivityCategoryFilter = (typeof ACTIVITY_CATEGORY_FILTERS)[number];

const dateOr = (v: unknown): string => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

export const ActivityQuerySchema = z.object({
  page: z.unknown().optional().transform((v) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= 1 ? n : 1;
  }),
  /** Rows per page — whitelisted to {10,20,50} (mirrors Pagination.PAGE_SIZES), default 20. */
  pageSize: z.unknown().optional().transform((v) => {
    const n = Math.floor(Number(v));
    return n === 10 || n === 50 ? n : 20;
  }),
  category: z.unknown().optional().transform((v): ActivityCategoryFilter =>
    v === "security" || v === "data" ? v : "all",
  ),
  actor: z.unknown().optional().transform((v) => (typeof v === "string" && UUID_RE.test(v) ? v : "")),
  q: z.unknown().optional().transform((v) => (typeof v === "string" ? v.trim().slice(0, 80) : "")),
  dateFrom: z.unknown().optional().transform(dateOr),
  dateTo: z.unknown().optional().transform(dateOr),
  dir: z.unknown().optional().transform((v) => (v === "asc" ? "asc" : "desc")),
});

export type ActivityQuery = z.infer<typeof ActivityQuerySchema>;
