import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { leadWhere, leadChildWhere, tenantWhere, type ScopeContext } from "@/lib/scope";
import { computeRunSummary, type RunSummary } from "../analytics/run-summary";
import { recode } from "../pipeline/recode";
import type { ExportLead, PartnerInfo } from "../export/render";
import { currentStatus, SEED_LEAD_STATUSES } from "./statuses";

// ─────────────────────────────────────────────────────────────────────────────
// Partner portal scoped reads (PTL-02/03/04). Every query goes through the scope
// guard (PRN-08): a partner sees ONLY their own leads (leadWhere) and their own
// leads' status history (leadChildWhere). Kept leads only — removed leads are never
// a partner's. TST-01/08 prove the isolation live.
// ─────────────────────────────────────────────────────────────────────────────

export const PARTNER_LEADS_PAGE_SIZE = 50;

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
  previouslyMatched: boolean;
}

export interface PartnerLeadPage {
  leads: PartnerLeadRow[];
  page: number;
  pageSize: number;
  total: number;
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
    .where(and(leadChildWhere(schema.leadStatusHistory, scope, db), inArray(schema.leadStatusHistory.leadId, leadIds)));
  for (const r of rows) {
    const list = map.get(r.leadId) ?? [];
    list.push({ status: r.status, createdAt: r.createdAt.toISOString() });
    map.set(r.leadId, list);
  }
  return map;
}

/** Server-side paginated list of the partner's own kept leads (PTL-02, FEP-03). */
export async function listPartnerLeads(scope: ScopeContext, page = 1): Promise<PartnerLeadPage> {
  const db = getDb();
  const pageSize = PARTNER_LEADS_PAGE_SIZE;
  const current = Math.max(1, Math.floor(page) || 1);
  const offset = (current - 1) * pageSize;
  const baseWhere = and(leadWhere(scope), eq(schema.leads.mlsStatus, "kept"));

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
        previouslyMatched: schema.leads.previouslyMatched,
      })
      .from(schema.leads)
      .where(baseWhere)
      .orderBy(desc(schema.leads.createdAt))
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
    previouslyMatched: r.previouslyMatched,
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
  previouslyMatched: boolean;
  status: string;
  history: { status: string; changedAt: string }[];
  availableStatuses: string[];
}

/** A single owned lead + its status history (PTL-02/03). Null if not the partner's. */
export async function getPartnerLeadDetail(scope: ScopeContext, refId: string): Promise<PartnerLeadDetail | null> {
  const db = getDb();
  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(and(leadWhere(scope), eq(schema.leads.refId, refId), eq(schema.leads.mlsStatus, "kept")));
  if (!lead) return null;

  const hist = await db
    .select({ status: schema.leadStatusHistory.status, createdAt: schema.leadStatusHistory.createdAt })
    .from(schema.leadStatusHistory)
    .where(and(leadChildWhere(schema.leadStatusHistory, scope, db), eq(schema.leadStatusHistory.leadId, lead.id)))
    .orderBy(desc(schema.leadStatusHistory.createdAt));
  const history = hist.map((h) => ({ status: h.status, changedAt: h.createdAt.toISOString() }));

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
    receivedAt: (lead.firstMatchedAt ?? lead.createdAt).toISOString(),
    previouslyMatched: lead.previouslyMatched,
    status: currentStatus(history.map((h) => ({ status: h.status, createdAt: h.changedAt }))),
    history,
    availableStatuses: [...SEED_LEAD_STATUSES],
  };
}

export interface PartnerExportData {
  exportLeads: ExportLead[];
  partners: Map<string, PartnerInfo>;
  summary: RunSummary;
}

/** All of the partner's kept leads assembled for the Excel export (PTL-04). Scoped. */
export async function getPartnerExportData(scope: ScopeContext): Promise<PartnerExportData> {
  const db = getDb();
  const [leadRows, partnerRows, recodeRows] = await Promise.all([
    db.select().from(schema.leads).where(and(leadWhere(scope), eq(schema.leads.mlsStatus, "kept"))),
    db
      .select({ id: schema.partners.id, name: schema.partners.name, refId: schema.partners.refId, color: schema.partners.color })
      .from(schema.partners)
      .where(tenantWhere(schema.partners, scope)),
    db
      .select({ matchPattern: schema.campaignRecodes.matchPattern, code: schema.campaignRecodes.code })
      .from(schema.campaignRecodes)
      .where(tenantWhere(schema.campaignRecodes, scope)),
  ]);

  const partners = new Map<string, PartnerInfo>(
    partnerRows.map((p) => [p.id, { id: p.id, name: p.name, refId: p.refId, color: p.color }]),
  );
  const summary = computeRunSummary(
    leadRows.map((l) => ({ mlsStatus: l.mlsStatus, matchMethod: l.matchMethod, partnerId: l.partnerId, previouslyMatched: l.previouslyMatched })),
  );
  const exportLeads: ExportLead[] = leadRows.map((l) => ({
    leadRefId: l.refId,
    campaign: recode(l.campaign ?? "", recodeRows),
    dateCreated: l.dateCreated ?? "",
    notes: l.notes ?? "",
    address: l.address ?? "",
    city: l.city ?? "",
    state: l.state ?? "",
    zip: l.zip ?? "",
    sellerFirst: l.sellerFirst ?? "",
    sellerLast: l.sellerLast ?? "",
    phone: l.phone ?? "",
    email: l.email ?? "",
    reasonForSelling: l.reasonForSelling ?? "",
    motivation: l.motivation ?? "",
    timeToSell: l.timeToSell ?? "",
    partnerId: l.partnerId,
    previouslyMatched: l.previouslyMatched,
    possibleMlsListing: l.possibleMlsListing,
  }));

  return { exportLeads, partners, summary };
}
