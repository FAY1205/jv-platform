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

// ─────────────────────────────────────────────────────────────────────────────
// C-41a: the ONE canonical shape of a portal-leads read — key AND url from the same
// normalized params, so every caller of /api/portal/leads (the mobile card list, the
// desktop table, the dashboard's recent-leads preview) that is asking the SAME question
// lands on the SAME cache entry.
//
// Before this, three callers asked the same default question three different ways:
// ["portal-leads", filterKey, page] → ?page=1, ["portal-leads-desktop", …] → the full
// sort/dir/pageSize url, and ["portal-leads", 1] → ?page=1 — so a dashboard → leads
// navigation refetched, and a desktop first paint fetched twice (the media query resolves
// to `false` during hydration, mounting the mobile list before the swap).
//
// Pure, DB-free and React-free by design: this module is imported by "use client"
// components AND by ./queries on the server.
// ─────────────────────────────────────────────────────────────────────────────

/** The default page size for every portal-leads read. Deliberately equal to the shared
 *  `DEFAULT_PAGE_SIZE` of the Pagination primitive — restated here (not imported) because
 *  `@/components` is a client barrel this server-reachable module must not pull in.
 *  A unit test pins the two together. */
export const PORTAL_LEADS_DEFAULT_PAGE_SIZE = 20;

/** Everything that distinguishes one portal-leads read from another. */
export interface PortalLeadsParams {
  page: number;
  pageSize: number;
  sort: PortalLeadSort;
  dir: "asc" | "desc";
  /** Selected status filters; `[]` = every status. Normalized to a stable order. */
  statuses: string[];
  /** Committed (debounced) free-text search; `""` = none. */
  q: string;
}

/** The default view — page 1, newest first. What the dashboard preview asks for, and what
 *  both leads lists open on. */
export const PORTAL_LEADS_DEFAULTS: PortalLeadsParams = {
  page: 1,
  pageSize: PORTAL_LEADS_DEFAULT_PAGE_SIZE,
  sort: "received",
  dir: "desc",
  statuses: [],
  q: "",
};

/** Normalize a partial read into the canonical params. Sorting `statuses` and trimming `q`
 *  here (not at each call site) is what makes two callers that chose the same filters in a
 *  different ORDER share one cache entry. */
export function portalLeadsParams(overrides: Partial<PortalLeadsParams> = {}): PortalLeadsParams {
  const p = { ...PORTAL_LEADS_DEFAULTS, ...overrides };
  return { ...p, statuses: [...p.statuses].sort(), q: p.q.trim() };
}

/** The canonical TanStack query key. Takes ALREADY-normalized params (from
 *  `portalLeadsParams`) so the key can never disagree with the url below. */
export function portalLeadsKey(p: PortalLeadsParams): readonly unknown[] {
  return ["portal-leads", { page: p.page, pageSize: p.pageSize, sort: p.sort, dir: p.dir, statuses: p.statuses.join(","), q: p.q }] as const;
}

/** The canonical request url — fixed param order, filters omitted when empty. */
export function portalLeadsUrl(p: PortalLeadsParams): string {
  const params = new URLSearchParams({ page: String(p.page), pageSize: String(p.pageSize), sort: p.sort, dir: p.dir });
  if (p.statuses.length) params.set("status", p.statuses.join(","));
  if (p.q) params.set("q", p.q);
  return `/api/portal/leads?${params.toString()}`;
}
