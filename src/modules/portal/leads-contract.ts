import { SEED_LEAD_STATUSES } from "./statuses";

// ─────────────────────────────────────────────────────────────────────────────
// Client-safe portal-leads contract (hotfix for the WP-PW-3 bundle leak).
// The desktop Leads table ("use client") needs the sort/status whitelists and the
// page types, but `./queries` imports `@/db` → `postgres` → node `fs`, which a
// client bundle cannot resolve. Same rule as run/void-window.ts (WP-J1): anything
// a "use client" component imports BY VALUE must live in a module with no DB
// import chain. `./queries` re-exports these so server callers are unchanged.
// ─────────────────────────────────────────────────────────────────────────────

export const PARTNER_LEADS_PAGE_SIZE = 50;

// WP-PW-3: server-side sort + status filter for the desktop Leads table.
// `sort`/`dir` are DISPLAY-ONLY — they flow ONLY through the whitelist map in
// `./queries` (never a raw param into a `where`). Portal leads are always
// mlsStatus="kept", so the status vocabulary is the seeded 6.
export const PORTAL_LEAD_SORT_FIELDS = ["received", "status", "city", "state", "ref"] as const;
export type PortalLeadSort = (typeof PORTAL_LEAD_SORT_FIELDS)[number];
export const PORTAL_STATUS_FILTERS = SEED_LEAD_STATUSES;

export interface PartnerLeadRow {
  refId: string;
  sellerFirst: string;
  sellerLast: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  receivedAt: string;
  status: string;
  /** Scoring (SCR). Portal leads are always kept, so a hot group shows the target mark. */
  scoreTotal: number | null;
  scoreGroup: "hot" | "warm" | "nurture" | null;
}

export interface PartnerLeadPage {
  leads: PartnerLeadRow[];
  page: number;
  pageSize: number;
  total: number;
}
