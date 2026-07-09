import { and, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, leadChildWhere, partnerOwnsLead, type ScopeContext } from "@/lib/scope";
import { currentStatus } from "../portal/statuses";
import { groupUnmatchedByState, type UnmatchedGroup } from "./unmatched";
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
  status: string;
  partner: { id: string; name: string; refId: string; color: string } | null;
  receivedAt: string;
}

export interface GlobalLeadsPage {
  leads: GlobalLeadRow[];
  page: number;
  pageSize: number;
  total: number;
}

export async function listLeads(scope: ScopeContext, query: LeadsQuery): Promise<GlobalLeadsPage> {
  const db = getDb();
  const offset = (query.page - 1) * LEADS_PAGE_SIZE;

  const conds: SQL[] = [tenantWhere(schema.leads, scope), isNull(schema.leads.deletedAt) as unknown as SQL];
  if (query.mls !== "all") conds.push(eq(schema.leads.mlsStatus, query.mls));
  if (query.partnerId) conds.push(partnerOwnsLead(query.partnerId)); // effective owner
  if (query.state) conds.push(eq(schema.leads.state, query.state));
  if (query.q) {
    const like = `%${query.q}%`;
    const textMatch = or(
      ilike(schema.leads.sellerFirst, like),
      ilike(schema.leads.sellerLast, like),
      ilike(schema.leads.address, like),
      ilike(schema.leads.city, like),
      ilike(schema.leads.zip, like),
      ilike(schema.leads.refId, like),
    );
    if (textMatch) conds.push(textMatch);
  }
  const where = and(...conds);

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
        campaign: schema.leads.campaign,
        mlsStatus: schema.leads.mlsStatus,
        createdAt: schema.leads.createdAt,
        pId: schema.partners.id,
        pName: schema.partners.name,
        pRef: schema.partners.refId,
        pColor: schema.partners.color,
      })
      .from(schema.leads)
      // Effective owner = manual assignment if present, else the pipeline routing.
      .leftJoin(schema.partners, eq(schema.partners.id, sql`coalesce(${schema.leads.manualPartnerId}, ${schema.leads.partnerId})`))
      .where(where)
      .orderBy(desc(schema.leads.createdAt))
      .limit(LEADS_PAGE_SIZE)
      .offset(offset),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.leads).where(where),
  ]);

  // Current status per lead on this page only (latest history entry, PTL-03).
  const ids = rows.map((r) => r.id);
  const statusByLead = new Map<string, { status: string; createdAt: string }[]>();
  if (ids.length > 0) {
    const history = await db
      .select({
        leadId: schema.leadStatusHistory.leadId,
        status: schema.leadStatusHistory.status,
        createdAt: schema.leadStatusHistory.createdAt,
      })
      .from(schema.leadStatusHistory)
      .where(
        and(
          leadChildWhere(schema.leadStatusHistory, scope, db),
          inArray(schema.leadStatusHistory.leadId, ids),
        ),
      );
    for (const h of history) {
      const list = statusByLead.get(h.leadId) ?? [];
      list.push({ status: h.status, createdAt: h.createdAt.toISOString() });
      statusByLead.set(h.leadId, list);
    }
  }

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
      status: currentStatus(statusByLead.get(r.id) ?? []),
      partner: r.pId ? { id: r.pId, name: r.pName!, refId: r.pRef!, color: r.pColor! } : null,
      receivedAt: r.createdAt.toISOString(),
    })),
    page: query.page,
    pageSize: LEADS_PAGE_SIZE,
    total: Number(totalRows[0]?.n ?? 0),
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
