import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, partnerOwnsLead, leadWhere, type ScopeContext } from "@/lib/scope";
import { SEED_LEAD_STATUSES, currentStatus } from "@/modules/portal/statuses";
import type { ScoreGroup, ScoreStatus, ScoreBreakdown } from "@/modules/pipeline/score";
import type { LeadsQuery } from "./schema";

/** Currently-unmatched = kept, not pipeline-routed, not yet manually assigned.
 *  Exported for the bulk-assign command's shared eligibility guard (S6/ASN-03). */
export function unmatchedWhere(scope: ScopeContext): SQL {
  return and(
    tenantWhere(schema.leads, scope),
    isNull(schema.leads.deletedAt),
    eq(schema.leads.mlsStatus, "kept"),
    isNull(schema.leads.partnerId),
    isNull(schema.leads.manualPartnerId),
  )!;
}

// The global admin leads list (ADM). Tenant-scoped through the guard (PRN-08),
// server-side paginated (FEP-03), filterable. Admin-only — the route enforces
// role; partners have their own scoped portal list.

export interface GlobalLeadRow {
  refId: string;
  seller: string;
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  campaign: string | null;
  mlsStatus: "kept" | "removed";
  /** Derived: "Removed MLS" for removed leads, else the current workflow status. */
  status: string;
  /** Scoring (SCR). Group is null when the lead couldn't be scored (incomplete). */
  scoreTotal: number | null;
  scoreGroup: "hot" | "warm" | "nurture" | null;
  partner: { id: string; name: string; refId: string; color: string } | null;
  receivedAt: string;
  /** Last activity (latest status change or manual assignment), or null. */
  modifiedAt: string | null;
}

export interface GlobalLeadsPage {
  leads: GlobalLeadRow[];
  page: number;
  pageSize: number;
  total: number;
}

// Correlated latest-status subquery — the current workflow status + when it last
// changed, per lead. Indexed by lead_status_history(lead_id).
// Scope-aware builders (ADR-0013 defence-in-depth, WP-F1): each caller passes the
// live ScopeContext so the subqueries below carry their own explicit tenant predicate.
function latestStatus(scope: ScopeContext) {
  // self-scoped (ADR-0013 defence-in-depth): correlation key leads.id is globally unique, but
  // carry an explicit tenant predicate too so no single dropped predicate can widen scope.
  return sql`(select status from lead_status_history where lead_id = ${schema.leads.id} and ${tenantWhere(schema.leadStatusHistory, scope)} order by created_at desc limit 1)`;
}
function latestAt(scope: ScopeContext) {
  // self-scoped (ADR-0013 defence-in-depth): correlation key leads.id is globally unique, but
  // carry an explicit tenant predicate too so no single dropped predicate can widen scope.
  return sql`(select created_at from lead_status_history where lead_id = ${schema.leads.id} and ${tenantWhere(schema.leadStatusHistory, scope)} order by created_at desc limit 1)`;
}
// The displayed status: removed leads read "Removed MLS"; else current or New.
function statusExpr(scope: ScopeContext) {
  return sql<string>`case when ${schema.leads.mlsStatus} = 'removed' then 'Removed MLS' else coalesce(${latestStatus(scope)}, 'New') end`;
}
function modifiedExpr(scope: ScopeContext) {
  return sql<Date | null>`coalesce(${latestAt(scope)}, ${schema.leads.manualAssignedAt})`;
}
export async function listLeads(scope: ScopeContext, query: LeadsQuery): Promise<GlobalLeadsPage> {
  const db = getDb();
  const offset = (query.page - 1) * query.pageSize;

  const conds: SQL[] = [tenantWhere(schema.leads, scope), isNull(schema.leads.deletedAt) as unknown as SQL];
  if (query.partnerId === "unmatched") {
    conds.push(and(eq(schema.leads.mlsStatus, "kept"), isNull(schema.leads.partnerId), isNull(schema.leads.manualPartnerId))!);
  } else if (query.partnerId) {
    conds.push(partnerOwnsLead(query.partnerId)); // effective owner
  }
  if (query.state) conds.push(eq(schema.leads.state, query.state));
  if (query.source) conds.push(eq(schema.leads.campaign, query.source));
  // Hot filter (SCR): kept leads only — an MLS-removed lead is never treated as hot.
  if (query.hot) conds.push(and(eq(schema.leads.scoreGroup, "hot"), eq(schema.leads.mlsStatus, "kept"))!);
  if (query.dateFrom) conds.push(gte(schema.leads.createdAt, new Date(`${query.dateFrom}T00:00:00Z`)));
  if (query.dateTo) conds.push(lte(schema.leads.createdAt, new Date(`${query.dateTo}T23:59:59Z`)));
  // Built once per call so the status filter, sort column, and select projection below
  // all share the identical scope-aware subqueries (ADR-0013 defence-in-depth, WP-F1).
  const sExpr = statusExpr(scope);
  const mExpr = modifiedExpr(scope);

  if (query.statuses.length > 0) {
    conds.push(or(...query.statuses.map((s) => sql`${sExpr} = ${s}`))!);
  }
  if (query.q) {
    const like = `%${query.q}%`;
    const textMatch = or(
      ilike(schema.leads.sellerFirst, like), ilike(schema.leads.sellerLast, like),
      ilike(schema.leads.address, like), ilike(schema.leads.city, like),
      ilike(schema.leads.zip, like), ilike(schema.leads.refId, like),
    );
    if (textMatch) conds.push(textMatch);
  }
  const where = and(...conds);

  const sortCol =
    query.sort === "lead" ? schema.leads.refId :
    query.sort === "modified" ? mExpr :
    query.sort === "seller" ? sql`lower(${schema.leads.sellerLast})` :
    schema.leads.createdAt;
  const dirFn = query.dir === "asc" ? asc : desc;

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        refId: schema.leads.refId,
        sellerFirst: schema.leads.sellerFirst,
        sellerLast: schema.leads.sellerLast,
        address: schema.leads.address,
        city: schema.leads.city,
        state: schema.leads.state,
        zip: schema.leads.zip,
        campaign: schema.leads.campaign,
        mlsStatus: schema.leads.mlsStatus,
        scoreTotal: schema.leads.scoreTotal,
        scoreGroup: schema.leads.scoreGroup,
        createdAt: schema.leads.createdAt,
        status: sExpr,
        modifiedAt: mExpr,
        pId: schema.partners.id,
        pName: schema.partners.name,
        pRef: schema.partners.refId,
        pColor: schema.partners.color,
      })
      .from(schema.leads)
      // Effective owner = manual assignment if present, else the pipeline routing.
      // R-65: the partner must be same-tenant too — a mis-set partner_id must resolve to NULL
      // (no partner shown), never surface another tenant's partner name/colour (leftJoin).
      .leftJoin(
        schema.partners,
        and(
          eq(schema.partners.id, sql`coalesce(${schema.leads.manualPartnerId}, ${schema.leads.partnerId})`),
          eq(schema.partners.tenantId, scope.tenantId),
        ),
      )
      .where(where)
      .orderBy(dirFn(sortCol), desc(schema.leads.createdAt))
      .limit(query.pageSize)
      .offset(offset),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.leads).where(where),
  ]);

  return {
    leads: rows.map((r) => ({
      refId: r.refId,
      seller: `${r.sellerFirst ?? ""} ${r.sellerLast ?? ""}`.trim() || "—",
      address: r.address ?? "—",
      city: r.city,
      state: r.state,
      zip: r.zip,
      campaign: r.campaign,
      mlsStatus: r.mlsStatus,
      status: r.status,
      scoreTotal: r.scoreTotal,
      scoreGroup: r.scoreGroup,
      partner: r.pId ? { id: r.pId, name: r.pName!, refId: r.pRef!, color: r.pColor! } : null,
      receivedAt: r.createdAt.toISOString(),
      modifiedAt: r.modifiedAt ? new Date(r.modifiedAt).toISOString() : null,
    })),
    page: query.page,
    pageSize: query.pageSize,
    total: Number(totalRows[0]?.n ?? 0),
  };
}

/** Distinct lead sources (campaigns) for the filter dropdown. */
export async function listLeadSources(scope: ScopeContext): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .selectDistinct({ campaign: schema.leads.campaign })
    .from(schema.leads)
    .where(and(tenantWhere(schema.leads, scope), isNull(schema.leads.deletedAt)))
    .orderBy(schema.leads.campaign);
  return rows.map((r) => r.campaign).filter((c): c is string => Boolean(c));
}

// ── Admin lead detail (ADM) — powers the Leads dialog ────────────────────────
// Unlike the partner detail (portal/queries), this returns removed leads too and
// exposes the manual-assignment overlay + a full activity timeline. Admin scope
// sees the whole tenant; still routed through leadWhere for PRN-08.

export interface AdminLeadPartner {
  id: string;
  name: string;
  refId: string;
  color: string;
}

export interface AdminLeadActivity {
  kind: "imported" | "routed" | "assigned" | "status";
  at: string;
  label: string;
  actor: string | null;
  status?: string;
}

export interface AdminLeadDetail {
  refId: string;
  seller: { first: string; last: string; phone: string; email: string };
  address: string;
  city: string;
  state: string;
  zip: string;
  campaign: string;
  notes: string;
  reasonForSelling: string;
  motivation: string;
  timeToSell: string;
  mlsStatus: "kept" | "removed";
  mlsReason: string;
  /** Derived: "Removed MLS" for removed leads, else the current workflow status. */
  status: string;
  /** Scoring (SCR) — breakdown + total for the dialog; null total when incomplete. */
  score: { total: number | null; group: ScoreGroup | null; status: ScoreStatus; breakdown: ScoreBreakdown | null };
  editable: boolean;
  receivedAt: string;
  modifiedAt: string | null;
  /** Effective owner = manual assignment if present, else pipeline routing. */
  partner: AdminLeadPartner | null;
  assignment: {
    manual: boolean;
    assignedAt: string | null;
    matchMethod: string;
    /** The exact ZIP5 or state the router matched on (leads.matched_on); null when unknown. */
    matchedOn: string | null;
    /** The pipeline-routed partner, shown when a manual assignment overrode it. */
    original: AdminLeadPartner | null;
  };
  availableStatuses: string[];
  activity: AdminLeadActivity[];
}

export async function getAdminLeadDetail(scope: ScopeContext, refId: string): Promise<AdminLeadDetail | null> {
  const db = getDb();
  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(and(leadWhere(scope), eq(schema.leads.refId, refId), isNull(schema.leads.deletedAt)));
  if (!lead) return null;

  const effPartnerId = lead.manualPartnerId ?? lead.partnerId;
  const wantIds = [effPartnerId, lead.partnerId].filter((v): v is string => Boolean(v));
  const partnerRows = wantIds.length
    ? await db
        .select({ id: schema.partners.id, name: schema.partners.name, refId: schema.partners.refId, color: schema.partners.color })
        .from(schema.partners)
        .where(and(tenantWhere(schema.partners, scope), inArray(schema.partners.id, wantIds)))
    : [];
  const pMap = new Map(partnerRows.map((p) => [p.id, p]));
  const effPartner = effPartnerId ? pMap.get(effPartnerId) ?? null : null;
  const origPartner = lead.partnerId ? pMap.get(lead.partnerId) ?? null : null;

  const hist = await db
    .select({ status: schema.leadStatusHistory.status, at: schema.leadStatusHistory.createdAt, actor: schema.users.email })
    .from(schema.leadStatusHistory)
    .leftJoin(schema.users, eq(schema.users.id, schema.leadStatusHistory.changedByUserId))
    .where(and(tenantWhere(schema.leadStatusHistory, scope), eq(schema.leadStatusHistory.leadId, lead.id)))
    .orderBy(asc(schema.leadStatusHistory.createdAt));

  let manualActor: string | null = null;
  if (lead.manualAssignedBy) {
    const [u] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(and(tenantWhere(schema.users, scope), eq(schema.users.id, lead.manualAssignedBy)));
    manualActor = u?.email ?? null;
  }

  const workflowStatus = currentStatus(hist.map((h) => ({ status: h.status, createdAt: h.at.toISOString() })));
  const derivedStatus = lead.mlsStatus === "removed" ? "Removed MLS" : workflowStatus;

  // Build the activity timeline (newest first). All entries come from authoritative
  // columns — no reliance on the events jsonb.
  const activity: AdminLeadActivity[] = [];
  activity.push({
    kind: "imported",
    at: lead.createdAt.toISOString(),
    actor: null,
    label: lead.campaign ? `Imported · ${lead.campaign}` : "Imported",
  });
  const routedAt = (lead.firstMatchedAt ?? lead.createdAt).toISOString();
  if (lead.mlsStatus === "removed") {
    activity.push({ kind: "routed", at: routedAt, actor: null, label: lead.mlsReason ? `Removed from MLS · ${lead.mlsReason}` : "Removed from MLS" });
  } else if (origPartner) {
    activity.push({ kind: "routed", at: routedAt, actor: null, label: `Routed to ${origPartner.name} via ${lead.matchMethod}` });
  } else {
    activity.push({ kind: "routed", at: routedAt, actor: null, label: "Unmatched — no coverage" });
  }
  if (lead.manualAssignedAt && effPartner) {
    activity.push({
      kind: "assigned",
      at: lead.manualAssignedAt.toISOString(),
      actor: manualActor,
      label: `Assigned to ${effPartner.name}`,
    });
  }
  for (const h of hist) {
    activity.push({ kind: "status", status: h.status, at: h.at.toISOString(), actor: h.actor, label: `Status set to ${h.status}` });
  }
  activity.sort((a, b) => b.at.localeCompare(a.at));

  const modifiedAt = hist.length ? hist[hist.length - 1].at : lead.manualAssignedAt;

  return {
    refId: lead.refId,
    seller: { first: lead.sellerFirst ?? "", last: lead.sellerLast ?? "", phone: lead.phone ?? "", email: lead.email ?? "" },
    address: lead.address ?? "",
    city: lead.city ?? "",
    state: lead.state ?? "",
    zip: lead.zip ?? "",
    campaign: lead.campaign ?? "",
    notes: lead.notes ?? "",
    reasonForSelling: lead.reasonForSelling ?? "",
    motivation: lead.motivation ?? "",
    timeToSell: lead.timeToSell ?? "",
    mlsStatus: lead.mlsStatus,
    mlsReason: lead.mlsReason ?? "",
    status: derivedStatus,
    score: {
      total: lead.scoreTotal,
      group: lead.scoreGroup,
      status: lead.scoreStatus,
      breakdown: (lead.scoreBreakdown as ScoreBreakdown | null) ?? null,
    },
    editable: lead.mlsStatus === "kept",
    receivedAt: lead.createdAt.toISOString(),
    modifiedAt: modifiedAt ? modifiedAt.toISOString() : null,
    partner: effPartner,
    assignment: {
      manual: Boolean(lead.manualPartnerId),
      assignedAt: lead.manualAssignedAt ? lead.manualAssignedAt.toISOString() : null,
      matchMethod: lead.matchMethod,
      matchedOn: lead.matchedOn ?? null,
      original: lead.manualPartnerId ? origPartner : null,
    },
    availableStatuses: [...SEED_LEAD_STATUSES],
    activity,
  };
}

/** Count of currently-unmatched leads (the backlog) — drives the nav badge and
 *  the dashboard alert. Excludes leads already routed manually. */
export async function unmatchedCount(scope: ScopeContext): Promise<number> {
  const db = getDb();
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.leads).where(unmatchedWhere(scope));
  return Number(row?.n ?? 0);
}

/** Total lead count for the workspace — drives the Leads nav badge. Tenant-scoped (PRN-08),
 *  excluding soft-deleted rows to match the /leads list total (every sibling read does). */
export async function leadsCount(scope: ScopeContext): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.leads)
    .where(and(tenantWhere(schema.leads, scope), isNull(schema.leads.deletedAt)));
  return Number(row?.n ?? 0);
}

export interface UnmatchedStateStats {
  total: number;
  byState: { state: string; count: number }[];
}

/** Bounded per-state unmatched aggregate (F-11) — feeds the stats row + state map.
 *  Currently-unmatched only (kept, no pipeline partner, no manual overlay). The lead
 *  rows themselves come from the paginated /api/leads?partnerId=unmatched (WS-3). */
// ── Coverage backfill (S6 / ASN-03) ───────────────────────────────────────────
// "Which partner would TODAY'S coverage route each unmatched lead to?" — zip
// override first, then state rule, the same generic precedence the pipeline uses
// (ASN-02: no per-partner special-casing). Read-only derivation; assignment goes
// through the bulk-assign command's additive overlay (PRN-05).

export interface CoverageMatch {
  partnerId: string;
  refId: string;
  name: string;
  color: string;
  count: number;
}

/** The effective coverage partner per unmatched lead: live zip override (DM-06:
 *  effective_to IS NULL) beats state rule; leads nothing covers drop out. */
function coverageMatchRows(scope: ScopeContext) {
  const db = getDb();
  const zipCov = db
    .select({ zip5: schema.coverageZips.zip5, zipPartnerId: schema.coverageZips.partnerId })
    .from(schema.coverageZips)
    .where(and(tenantWhere(schema.coverageZips, scope), isNull(schema.coverageZips.effectiveTo)))
    .as("zip_cov");
  const effectivePartner = sql<string>`coalesce(${zipCov.zipPartnerId}, ${schema.stateRules.partnerId})`;
  return { zipCov, effectivePartner, db };
}

/** Per-partner counts of unmatched leads their current coverage would take. */
export async function unmatchedCoverageMatches(scope: ScopeContext): Promise<CoverageMatch[]> {
  const { zipCov, effectivePartner, db } = coverageMatchRows(scope);
  const rows = await db
    .select({ partnerId: effectivePartner, count: sql<number>`count(*)::int` })
    .from(schema.leads)
    .leftJoin(zipCov, eq(zipCov.zip5, schema.leads.zip))
    .leftJoin(
      schema.stateRules,
      and(tenantWhere(schema.stateRules, scope), eq(schema.stateRules.state, sql`upper(trim(${schema.leads.state}))`)),
    )
    .where(and(unmatchedWhere(scope), sql`${effectivePartner} is not null`))
    .groupBy(sql`1`)
    .orderBy(sql`count(*) desc`, sql`1`);
  if (rows.length === 0) return [];
  const partners = await db
    .select({ id: schema.partners.id, refId: schema.partners.refId, name: schema.partners.name, color: schema.partners.color })
    .from(schema.partners)
    .where(
      and(
        tenantWhere(schema.partners, scope),
        inArray(schema.partners.id, rows.map((r) => r.partnerId)),
        ne(schema.partners.status, "revoked"),
        isNull(schema.partners.deletedAt),
      ),
    );
  const byId = new Map(partners.map((p) => [p.id, p]));
  // A match whose partner is no longer active/present is dropped — assignment would
  // reject it anyway (InvalidAssignTargetError), so don't offer it.
  return rows.flatMap((r) => {
    const p = byId.get(r.partnerId);
    return p ? [{ partnerId: p.id, refId: p.refId, name: p.name, color: p.color, count: Number(r.count) }] : [];
  });
}

/** The refIds of unmatched leads a specific partner's current coverage would take. */
export async function unmatchedCoverageLeadRefs(scope: ScopeContext, partnerId: string): Promise<string[]> {
  const { zipCov, effectivePartner, db } = coverageMatchRows(scope);
  const rows = await db
    .select({ refId: schema.leads.refId })
    .from(schema.leads)
    .leftJoin(zipCov, eq(zipCov.zip5, schema.leads.zip))
    .leftJoin(
      schema.stateRules,
      and(tenantWhere(schema.stateRules, scope), eq(schema.stateRules.state, sql`upper(trim(${schema.leads.state}))`)),
    )
    .where(and(unmatchedWhere(scope), sql`${effectivePartner} = ${partnerId}`))
    .orderBy(schema.leads.refId);
  return rows.map((r) => r.refId);
}

export async function unmatchedStateStats(scope: ScopeContext): Promise<UnmatchedStateStats> {
  const db = getDb();
  const rows = await db
    .select({
      state: sql<string>`coalesce(nullif(trim(upper(${schema.leads.state})), ''), '—')`,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.leads)
    .where(unmatchedWhere(scope))
    .groupBy(sql`1`)
    .orderBy(sql`count(*) desc`, sql`1`);
  const byState = rows.map((r) => ({ state: r.state, count: Number(r.count) }));
  return { total: byState.reduce((s, r) => s + r.count, 0), byState };
}
