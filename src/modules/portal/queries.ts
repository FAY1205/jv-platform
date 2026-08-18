import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { leadWhere, leadChildWhere, statusHistoryWhere, ownStatusAuthorScope, tenantWhere, requirePartner, isPartnerStream, type ScopeContext } from "@/lib/scope";
import { releasedLeads } from "../run/hold-filter";
import { computeRunSummary, type RunSummary } from "../analytics/run-summary";
import { partnerPerformanceDetail } from "../analytics/partner-performance";
import { buildPartnerTerritory, type PartnerTerritory } from "../coverage/partner-territory";
import { zipToCounty } from "@/lib/geo/zip-county";
import { deltaOf, type RangeKey } from "../analytics/ranges";
import { toExportLead, type ExportLead, type PartnerInfo } from "../export/render";
import { noteAndTaskActivity, sortNewestFirst, type LeadActivity } from "../leads/timeline";
import { currentStatus, SEED_LEAD_STATUSES } from "./statuses";
import { currentTerritoryQuery } from "../coverage/current-territory";
import {
  PARTNER_LEADS_PAGE_SIZE,
  PORTAL_LEAD_SORT_FIELDS,
  PORTAL_STATUS_FILTERS,
  type PortalLeadSort,
  type PartnerLeadRow,
  type PartnerLeadPage,
} from "./leads-contract";

// Client-safe whitelists/types live in ./leads-contract (no @/db import chain —
// the desktop Leads table imports them by value); re-exported here so server
// callers keep importing from this module unchanged.
export {
  PARTNER_LEADS_PAGE_SIZE,
  PORTAL_LEAD_SORT_FIELDS,
  PORTAL_STATUS_FILTERS,
  type PortalLeadSort,
  type PartnerLeadRow,
  type PartnerLeadPage,
};

// ─────────────────────────────────────────────────────────────────────────────
// Partner portal scoped reads (PTL-02/03/04). Every query goes through the scope
// guard (PRN-08): a partner sees ONLY their own leads (leadWhere) and their own
// leads' status history (leadChildWhere). Kept leads only — removed leads are never
// a partner's. TST-01/08 prove the isolation live.
// ─────────────────────────────────────────────────────────────────────────────

const PORTAL_PAGE_SIZES = [10, 20, 50] as const;

export interface ListPartnerLeadsOpts {
  page?: number;
  pageSize?: number;
  sort?: PortalLeadSort;
  dir?: "asc" | "desc";
  statuses?: readonly string[];
  /** Free-text search over the partner's OWN rows (seller/address/city/zip/ref). */
  q?: string;
}

// Correlated latest-status subquery — the current workflow status per lead. Portal
// leads are always mlsStatus="kept", so there is no mlsStatus branch here (cf. the
// admin status expression in modules/leads/queries.ts, which branches on "removed").
// Scope-aware builders (ADR-0013 defence-in-depth, WP-F1): each caller passes the
// live ScopeContext so the subquery below carries its own explicit tenant predicate.
function latestStatus(scope: ScopeContext) {
  // self-scoped (ADR-0013 defence-in-depth): correlation key leads.id is globally unique, but
  // carry an explicit tenant predicate too so no single dropped predicate can widen scope.
  // R-22: for a partner, the derived status must come only from their OWN org's entries, so a
  // re-routed lead's sort/filter position matches the "New" a fresh owner sees (never the prior
  // partner's). Admin: unscoped. Same predicate statusHistoryWhere applies to the row-level reads.
  const author = ownStatusAuthorScope(scope);
  const authorClause = author ? sql` and ${author}` : sql``;
  // WP-KAN-1a (C-16): `, id desc` matches the admin read's tie-break (leads/queries.ts) and the
  // write path (status-update.ts). Without it, two same-`created_at` entries (one clock tick, or a
  // backfill) let Postgres pick either — so a lead could read one status in the admin list and
  // another in the partner portal. It also lets lead_status_lead_created_idx (0051) satisfy the
  // ordering as a pure index seek (no per-row sort).
  return sql`(select status from lead_status_history where lead_id = ${schema.leads.id} and ${tenantWhere(schema.leadStatusHistory, scope)}${authorClause} order by created_at desc, id desc limit 1)`;
}
function statusExpr(scope: ScopeContext) {
  return sql<string>`coalesce(${latestStatus(scope)}, 'New')`;
}
function statusOrder(scope: ScopeContext) {
  return sql`case ${statusExpr(scope)} when 'New' then 0 when 'Contacted' then 1 when 'Appointment' then 2 when 'Under contract' then 3 when 'Closed' then 4 when 'Dead' then 5 else 6 end`;
}

async function statusMap(
  db: ReturnType<typeof getDb>,
  scope: ScopeContext,
  leadIds: string[],
): Promise<Map<string, { status: string; createdAt: string }[]>> {
  const map = new Map<string, { status: string; createdAt: string }[]>();
  if (leadIds.length === 0) return map;
  const rows = await db
    .select({
      leadId: schema.leadStatusHistory.leadId,
      status: schema.leadStatusHistory.status,
      createdAt: schema.leadStatusHistory.createdAt,
    })
    .from(schema.leadStatusHistory)
    .where(and(statusHistoryWhere(scope, db), inArray(schema.leadStatusHistory.leadId, leadIds)));
  for (const r of rows) {
    const list = map.get(r.leadId) ?? [];
    list.push({ status: r.status, createdAt: r.createdAt.toISOString() });
    map.set(r.leadId, list);
  }
  return map;
}

// T7a: the ONE partner-visible leads predicate — scoped (PRN-08), kept only, not
// soft-deleted (WP-J2 recall), and past the distribution hold for partner requests
// (released; admin scopes stay ungated). Every "which leads can this portal caller
// see" read composes on this so a new read can't drop a predicate.
// ⚠️ SCOPE-GUARD-ADJACENT (pr-review T7a F-3): four partner reads compose on this one
// function — treat edits here with lib/scope.ts (Tier A) ceremony.
function visibleLeadsWhere(scope: ScopeContext) {
  return and(
    leadWhere(scope),
    eq(schema.leads.mlsStatus, "kept"),
    isNull(schema.leads.deletedAt),
    isPartnerStream(scope) ? releasedLeads() : undefined,
  );
}

/** T7a: total visible leads for the shell nav badge — identical semantics to the
 *  unfiltered listPartnerLeads count (PTL-02), without fetching rows. */
export async function countPartnerLeads(scope: ScopeContext): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.leads)
    .where(visibleLeadsWhere(scope));
  return row?.total ?? 0;
}

/** Server-side paginated, sortable, status-filterable list of the partner's own kept
 *  leads (PTL-02, FEP-03; WP-PW-3 Task 1). Back-compat: `opts` fully optional, and the
 *  no-opts call is byte-identical to the pre-WP-PW-3 behavior (received/desc, no
 *  filter, pageSize 50) — existing callers (route default path, portal-scope tests,
 *  void tests) are unaffected. */
export async function listPartnerLeads(scope: ScopeContext, opts: ListPartnerLeadsOpts = {}): Promise<PartnerLeadPage> {
  const db = getDb();
  const pageSize = (PORTAL_PAGE_SIZES as readonly number[]).includes(opts.pageSize as number)
    ? (opts.pageSize as number)
    : PARTNER_LEADS_PAGE_SIZE;
  const current = Math.max(1, Math.floor(opts.page ?? 1) || 1);
  const offset = (current - 1) * pageSize;

  // Whitelist-validated sort + dir (PRN-08: DISPLAY-ONLY, never reaches a `where`).
  // An unmatched/unknown `sort` degrades to "received" — no throw, no scope leak.
  const sort = (PORTAL_LEAD_SORT_FIELDS as readonly string[]).includes(opts.sort as string)
    ? (opts.sort as PortalLeadSort)
    : "received";
  const dir = opts.dir === "asc" ? "asc" : "desc";
  const dirFn = dir === "asc" ? asc : desc;
  // Built once per call so both the sort column and the status filter below share the
  // identical scope-aware subquery (ADR-0013 defence-in-depth, WP-F1).
  const sExpr = statusExpr(scope);
  const sOrder = statusOrder(scope);
  const sortCol =
    sort === "status" ? sOrder :
    sort === "city" ? sql`lower(${schema.leads.city})` :
    sort === "state" ? schema.leads.state :
    sort === "ref" ? schema.leads.refId :
    sql`coalesce(${schema.leads.firstMatchedAt}, ${schema.leads.createdAt})`;

  // Status filter values are whitelisted against the seeded 6 and always BOUND
  // (`${s}`), never string-concatenated.
  const statusFilters = (opts.statuses ?? []).filter((s) => (PORTAL_STATUS_FILTERS as readonly string[]).includes(s));

  // WP-PP-3: free-text search over the partner's own rows — same column set the admin
  // leads query uses (seller/address/city/zip/ref). Bound via ilike (never concatenated),
  // and ANDed INTO the shared scoped baseWhere, so it can only ever narrow the caller's
  // OWN visible set — never widen scope (PRN-08).
  const q = opts.q?.trim();
  const textMatch = q
    ? or(
        ilike(schema.leads.sellerFirst, `%${q}%`),
        ilike(schema.leads.sellerLast, `%${q}%`),
        ilike(schema.leads.address, `%${q}%`),
        ilike(schema.leads.city, `%${q}%`),
        ilike(schema.leads.zip, `%${q}%`),
        ilike(schema.leads.refId, `%${q}%`),
      )
    : undefined;

  // Visibility (scope + kept + WP-J2 soft-delete + distribution hold) comes from the
  // shared visibleLeadsWhere; the status filter and text search are pushed INTO this
  // shared baseWhere so the row select and the count(*) below stay identically
  // scoped/filtered (count-consistency) — never a JS filter-after-fetch.
  const baseWhere = and(
    visibleLeadsWhere(scope),
    statusFilters.length > 0 ? or(...statusFilters.map((s) => sql`${sExpr} = ${s}`)) : undefined,
    textMatch,
  );

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: schema.leads.id,
        refId: schema.leads.refId,
        sellerFirst: schema.leads.sellerFirst,
        sellerLast: schema.leads.sellerLast,
        address: schema.leads.address,
        city: schema.leads.city,
        state: schema.leads.state,
        zip: schema.leads.zip,
        firstMatchedAt: schema.leads.firstMatchedAt,
        createdAt: schema.leads.createdAt,
        scoreTotal: schema.leads.scoreTotal,
        scoreGroup: schema.leads.scoreGroup,
      })
      .from(schema.leads)
      .where(baseWhere)
      .orderBy(dirFn(sortCol), desc(schema.leads.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(schema.leads).where(baseWhere),
  ]);

  const statuses = await statusMap(db, scope, rows.map((r) => r.id));

  const leads: PartnerLeadRow[] = rows.map((r) => ({
    refId: r.refId,
    sellerFirst: r.sellerFirst ?? "",
    sellerLast: r.sellerLast ?? "",
    address: r.address ?? "",
    city: r.city ?? "",
    state: r.state ?? "",
    zip: r.zip ?? "",
    receivedAt: (r.firstMatchedAt ?? r.createdAt).toISOString(),
    status: currentStatus(statuses.get(r.id) ?? []),
    scoreTotal: r.scoreTotal,
    scoreGroup: r.scoreGroup,
  }));

  return { leads, page: current, pageSize, total: totalRows[0]?.total ?? 0 };
}

export interface PartnerLeadDetail {
  refId: string;
  seller: { first: string; last: string; phone: string; email: string };
  address: string;
  city: string;
  state: string;
  zip: string;
  reasonForSelling: string;
  motivation: string;
  timeToSell: string;
  notes: string;
  receivedAt: string;
  status: string;
  history: { status: string; changedAt: string }[];
  /** TSK-06: the unified timeline — the lead's arrival, its (own-org, R-22) status
   *  changes, and this org's notes and task events, newest first. `history` stays as
   *  it was for the existing status list. */
  activity: LeadActivity[];
  availableStatuses: string[];
  /** LST-01: listing-check flag (never affects delivery) + a link to verify. */
  listing: { status: "pending" | "yes" | "no" | "unknown"; link: string | null };
}

/** A single owned lead + its status history (PTL-02/03). Null if not the partner's. */
export async function getPartnerLeadDetail(scope: ScopeContext, refId: string): Promise<PartnerLeadDetail | null> {
  const db = getDb();
  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(and(visibleLeadsWhere(scope), eq(schema.leads.refId, refId)));
  if (!lead) return null;

  // Perf: the status history, the latest listing check, and the note/task timeline all depend only on
  // the lead row, not on each other — one Promise.all instead of a three-step sequential waterfall.
  // Each saved round trip is a full RTT against a distant DB, on the portal's most-clicked interaction.
  const [hist, checkRows, taskNoteActivity] = await Promise.all([
    db
      .select({ status: schema.leadStatusHistory.status, createdAt: schema.leadStatusHistory.createdAt })
      .from(schema.leadStatusHistory)
      .where(and(statusHistoryWhere(scope, db), eq(schema.leadStatusHistory.leadId, lead.id)))
      .orderBy(desc(schema.leadStatusHistory.createdAt)),
    // LST-01: latest listing check for this lead (link comes from the check; the flag lives on the
    // lead). Scoped via leadChildWhere.
    db
      .select({ result: schema.listingChecks.result })
      .from(schema.listingChecks)
      .where(and(leadChildWhere(schema.listingChecks, scope, db), eq(schema.listingChecks.leadId, lead.id)))
      .orderBy(desc(schema.listingChecks.checkedAt))
      .limit(1),
    noteAndTaskActivity(db, scope, lead.id),
  ]);
  const history = hist.map((h) => ({ status: h.status, changedAt: h.createdAt.toISOString() }));
  const check = checkRows[0];
  const listing = { status: lead.possibleMlsListing, link: (check?.result as { link?: string } | null)?.link ?? null };

  const receivedAt = (lead.firstMatchedAt ?? lead.createdAt).toISOString();
  // TSK-06: the partner's timeline. One system anchor — when the lead landed with them —
  // and deliberately NOT the admin feed's routing/assignment entries: the routing method
  // and sibling-partner identities are admin-only (PRN-08), and receivedAt is already in
  // this payload, so the anchor adds nothing new. Status entries keep their actor
  // withheld: R-22 lets an admin-authored entry through to the owner, and the portal has
  // never exposed admin identities. Notes/tasks come from the shared read-model, scoped.
  const activity = sortNewestFirst([
    { kind: "imported" as const, at: receivedAt, actor: null, label: "Lead received" },
    ...hist.map((h) => ({
      kind: "status" as const,
      status: h.status,
      at: h.createdAt.toISOString(),
      actor: null,
      label: `Status set to ${h.status}`,
    })),
    ...taskNoteActivity,
  ]);

  return {
    refId: lead.refId,
    seller: { first: lead.sellerFirst ?? "", last: lead.sellerLast ?? "", phone: lead.phone ?? "", email: lead.email ?? "" },
    address: lead.address ?? "",
    city: lead.city ?? "",
    state: lead.state ?? "",
    zip: lead.zip ?? "",
    reasonForSelling: lead.reasonForSelling ?? "",
    motivation: lead.motivation ?? "",
    timeToSell: lead.timeToSell ?? "",
    notes: lead.notes ?? "",
    receivedAt,
    status: currentStatus(history.map((h) => ({ status: h.status, createdAt: h.changedAt }))),
    history,
    activity,
    availableStatuses: [...SEED_LEAD_STATUSES],
    listing,
  };
}

export interface PartnerDashboardStats {
  range: RangeKey;
  leads: number;
  contacted: number;
  closed: number;
  untouched: number;
  leadsDelta: number | null;
  untouchedDelta: number | null;
  contactedDelta: number | null;
  closedDelta: number | null;
}

/** WP-F.3/WP-PW-2b: the caller's OWN dashboard KPIs + prior-window deltas (PRN-08). Numbers
 *  come from analytics (PRN-15); deltas reuse the one `deltaOf` definition. */
export async function partnerDashboardStats(scope: ScopeContext, range: RangeKey): Promise<PartnerDashboardStats> {
  if (!scope.partnerId) return { range, leads: 0, contacted: 0, closed: 0, untouched: 0, leadsDelta: null, untouchedDelta: null, contactedDelta: null, closedDelta: null };
  const perf = await partnerPerformanceDetail(scope, scope.partnerId, range);
  return {
    range,
    leads: perf.stats.given,
    contacted: perf.stats.contacted,
    closed: perf.stats.closed,
    untouched: perf.stats.untouched,
    leadsDelta: deltaOf(perf.stats.given, perf.prior?.given ?? null),
    untouchedDelta: deltaOf(perf.stats.untouched, perf.prior?.untouched ?? null),
    contactedDelta: deltaOf(perf.stats.contacted, perf.prior?.contacted ?? null),
    closedDelta: deltaOf(perf.stats.closed, perf.prior?.closed ?? null),
  };
}

/** WP-F.3: the caller's OWN state territory, everyone else anonymized (PRN-08). */
export async function partnerTerritory(scope: ScopeContext): Promise<PartnerTerritory> {
  const db = getDb();
  // Sentinel for a scope with no partner: never rendered (consumers gate on a truthy
  // partner.name), so it carries no real color (D4 — keeps app code hex-free, PRN-12).
  const empty = { id: "", name: "", refId: "", color: "" };
  if (!scope.partnerId) return buildPartnerTerritory({ ownStates: [], partner: empty });
  const [partner] = await db
    .select({ id: schema.partners.id, name: schema.partners.name, refId: schema.partners.refId, color: schema.partners.color })
    .from(schema.partners)
    .where(and(tenantWhere(schema.partners, scope), eq(schema.partners.id, scope.partnerId)));
  // WP-E: the partner's own current ZIP coverage → their own counties (only theirs; PRN-08).
  const { stateRules: rules, coverageZips: zips } = await currentTerritoryQuery(db, scope, scope.partnerId);
  return buildPartnerTerritory({
    ownStates: rules.map((r) => r.state),
    ownZips: zips.map((z) => z.zip5),
    partner: partner ?? empty,
    zipToCounty,
  });
}

export interface PartnerExportData {
  exportLeads: ExportLead[];
  partners: Map<string, PartnerInfo>;
  summary: RunSummary;
}

/** All of the partner's kept leads assembled for the Excel export (PTL-04). Scoped.
 *  The Campaign value is blanked and only the caller's own partner row is fetched:
 *  the lead source and sibling-partner identities are admin-only (PRN-08) — the rest
 *  of the portal already withholds both, and the export must not be the exception. */
export async function getPartnerExportData(scope: ScopeContext): Promise<PartnerExportData> {
  const db = getDb();
  const [leadRows, partnerRows] = await Promise.all([
    db.select().from(schema.leads).where(visibleLeadsWhere(scope)),
    db
      .select({ id: schema.partners.id, name: schema.partners.name, refId: schema.partners.refId, color: schema.partners.color })
      .from(schema.partners)
      .where(
        and(
          tenantWhere(schema.partners, scope),
          isPartnerStream(scope) ? eq(schema.partners.id, requirePartner(scope)) : undefined,
        ),
      ),
  ]);

  const partners = new Map<string, PartnerInfo>(
    partnerRows.map((p) => [p.id, { id: p.id, name: p.name, refId: p.refId, color: p.color }]),
  );
  const summary = computeRunSummary(
    leadRows.map((l) => ({ mlsStatus: l.mlsStatus, matchMethod: l.matchMethod, partnerId: l.partnerId })),
  );
  // blankCampaign: lead source stays admin-only — never in a partner-facing export (PRN-08).
  // Shape built by the one serializer (R-11), so the admin/portal contracts can't drift.
  const exportLeads: ExportLead[] = leadRows.map((l) => toExportLead(l, { blankCampaign: true }));

  return { exportLeads, partners, summary };
}
