import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, partnerOwnsLead, leadWhere, type ScopeContext } from "@/lib/scope";
import { groupUnmatchedByState, type UnmatchedGroup } from "./unmatched";
import { SEED_LEAD_STATUSES, currentStatus } from "@/modules/portal/statuses";
import type { LeadsQuery } from "./schema";

/** Currently-unmatched = kept, not pipeline-routed, not yet manually assigned. */
function unmatchedWhere(scope: ScopeContext): SQL {
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

export const LEADS_PAGE_SIZE = 50;

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
const LATEST_STATUS = sql`(select status from lead_status_history where lead_id = ${schema.leads.id} order by created_at desc limit 1)`;
const LATEST_AT = sql`(select created_at from lead_status_history where lead_id = ${schema.leads.id} order by created_at desc limit 1)`;
// The displayed status: removed leads read "Removed MLS"; else current or New.
const STATUS_EXPR = sql<string>`case when ${schema.leads.mlsStatus} = 'removed' then 'Removed MLS' else coalesce(${LATEST_STATUS}, 'New') end`;
const MODIFIED_EXPR = sql<Date | null>`coalesce(${LATEST_AT}, ${schema.leads.manualAssignedAt})`;
const STATUS_ORDER = sql`case ${STATUS_EXPR} when 'New' then 0 when 'Contacted' then 1 when 'Appointment' then 2 when 'Under contract' then 3 when 'Closed' then 4 when 'Dead' then 5 else 6 end`;

export async function listLeads(scope: ScopeContext, query: LeadsQuery): Promise<GlobalLeadsPage> {
  const db = getDb();
  const offset = (query.page - 1) * LEADS_PAGE_SIZE;

  const conds: SQL[] = [tenantWhere(schema.leads, scope), isNull(schema.leads.deletedAt) as unknown as SQL];
  if (query.partnerId === "unmatched") {
    conds.push(and(eq(schema.leads.mlsStatus, "kept"), isNull(schema.leads.partnerId), isNull(schema.leads.manualPartnerId))!);
  } else if (query.partnerId) {
    conds.push(partnerOwnsLead(query.partnerId)); // effective owner
  }
  if (query.state) conds.push(eq(schema.leads.state, query.state));
  if (query.source) conds.push(eq(schema.leads.campaign, query.source));
  if (query.dateFrom) conds.push(gte(schema.leads.createdAt, new Date(`${query.dateFrom}T00:00:00Z`)));
  if (query.dateTo) conds.push(lte(schema.leads.createdAt, new Date(`${query.dateTo}T23:59:59Z`)));
  if (query.statuses.length > 0) {
    conds.push(or(...query.statuses.map((s) => sql`${STATUS_EXPR} = ${s}`))!);
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
    query.sort === "modified" ? MODIFIED_EXPR :
    query.sort === "status" ? STATUS_ORDER :
    query.sort === "partner" ? sql`${schema.partners.name}` :
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
        createdAt: schema.leads.createdAt,
        status: STATUS_EXPR,
        modifiedAt: MODIFIED_EXPR,
        pId: schema.partners.id,
        pName: schema.partners.name,
        pRef: schema.partners.refId,
        pColor: schema.partners.color,
      })
      .from(schema.leads)
      // Effective owner = manual assignment if present, else the pipeline routing.
      .leftJoin(schema.partners, eq(schema.partners.id, sql`coalesce(${schema.leads.manualPartnerId}, ${schema.leads.partnerId})`))
      .where(where)
      .orderBy(dirFn(sortCol), desc(schema.leads.createdAt))
      .limit(LEADS_PAGE_SIZE)
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
      partner: r.pId ? { id: r.pId, name: r.pName!, refId: r.pRef!, color: r.pColor! } : null,
      receivedAt: r.createdAt.toISOString(),
      modifiedAt: r.modifiedAt ? new Date(r.modifiedAt).toISOString() : null,
    })),
    page: query.page,
    pageSize: LEADS_PAGE_SIZE,
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
  editable: boolean;
  receivedAt: string;
  modifiedAt: string | null;
  /** Effective owner = manual assignment if present, else pipeline routing. */
  partner: AdminLeadPartner | null;
  assignment: {
    manual: boolean;
    reason: string;
    assignedAt: string | null;
    matchMethod: string;
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
      label: lead.manualReason ? `Assigned to ${effPartner.name} · ${lead.manualReason}` : `Assigned to ${effPartner.name}`,
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
    editable: lead.mlsStatus === "kept",
    receivedAt: lead.createdAt.toISOString(),
    modifiedAt: modifiedAt ? modifiedAt.toISOString() : null,
    partner: effPartner,
    assignment: {
      manual: Boolean(lead.manualPartnerId),
      reason: lead.manualReason ?? "",
      assignedAt: lead.manualAssignedAt ? lead.manualAssignedAt.toISOString() : null,
      matchMethod: lead.matchMethod,
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

/** The unmatched inbox: gap leads grouped by state (biggest gap first). */
export async function listUnmatched(scope: ScopeContext): Promise<UnmatchedGroup[]> {
  const db = getDb();
  const rows = await db
    .select({
      refId: schema.leads.refId,
      sellerFirst: schema.leads.sellerFirst,
      sellerLast: schema.leads.sellerLast,
      address: schema.leads.address,
      city: schema.leads.city,
      state: schema.leads.state,
      zip: schema.leads.zip,
      campaign: schema.leads.campaign,
      createdAt: schema.leads.createdAt,
    })
    .from(schema.leads)
    .where(unmatchedWhere(scope))
    .orderBy(desc(schema.leads.createdAt));

  return groupUnmatchedByState(
    rows.map((r) => ({
      refId: r.refId,
      seller: `${r.sellerFirst ?? ""} ${r.sellerLast ?? ""}`.trim() || "—",
      address: r.address ?? "—",
      city: r.city,
      state: r.state,
      zip: r.zip,
      campaign: r.campaign,
      receivedAt: r.createdAt.toISOString(),
    })),
  );
}
