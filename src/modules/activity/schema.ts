import { z } from "zod";
import { pageParam, pageSizeParam } from "@/lib/query-params";

// ACT-01: admin activity list query params. Zod normalizes everything to canonical values
// so the query layer never sees raw input; invalid shapes degrade to safe defaults (never 400).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ACTIVITY_CATEGORY_FILTERS = ["all", "security", "data"] as const;
export type ActivityCategoryFilter = (typeof ACTIVITY_CATEGORY_FILTERS)[number];

const dateOr = (v: unknown): string => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

export const ActivityQuerySchema = z.object({
  page: pageParam(),
  pageSize: pageSizeParam(),
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
