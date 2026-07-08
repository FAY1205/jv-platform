import { and, eq, isNull, desc } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, leadWhere, type ScopeContext } from "@/lib/scope";
import { computeRunSummary } from "../analytics/run-summary";
import { recode } from "../pipeline/recode";
import type { RunListItem, PartnerView, RunLeadView, RunDetail } from "./view-types";

export type { RunListItem, PartnerView, RunLeadView, RunDetail } from "./view-types";

// ─────────────────────────────────────────────────────────────────────────────
// Scoped read queries for the run views (WP-019/021). Every query passes through
// the scoping guard (PRN-08); computed stats come only from analytics (PRN-15).
// ─────────────────────────────────────────────────────────────────────────────

export async function listRuns(scope: ScopeContext): Promise<RunListItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      refId: schema.uploads.refId,
      filename: schema.uploads.filename,
      status: schema.uploads.status,
      rowCount: schema.uploads.rowCount,
      createdAt: schema.uploads.createdAt,
    })
    .from(schema.uploads)
    .where(tenantWhere(schema.uploads, scope))
    .orderBy(desc(schema.uploads.createdAt));
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export async function getRunDetail(scope: ScopeContext, ref: string): Promise<RunDetail | null> {
  const db = getDb();

  const [upload] = await db
    .select()
    .from(schema.uploads)
    .where(and(tenantWhere(schema.uploads, scope), eq(schema.uploads.refId, ref)));
  if (!upload) return null;

  const [leadRows, partnerRows, recodeRows] = await Promise.all([
    db
      .select({
        refId: schema.leads.refId,
        campaign: schema.leads.campaign,
        address: schema.leads.address,
        city: schema.leads.city,
        state: schema.leads.state,
        zip: schema.leads.zip,
        sellerFirst: schema.leads.sellerFirst,
        sellerLast: schema.leads.sellerLast,
        partnerId: schema.leads.partnerId,
        matchMethod: schema.leads.matchMethod,
        mlsStatus: schema.leads.mlsStatus,
        mlsPatternKey: schema.leads.mlsPatternKey,
        previouslyMatched: schema.leads.previouslyMatched,
        possibleMlsListing: schema.leads.possibleMlsListing,
      })
      .from(schema.leads)
      .where(and(leadWhere(scope), eq(schema.leads.uploadId, upload.id))),
    db
      .select({ id: schema.partners.id, name: schema.partners.name, refId: schema.partners.refId, color: schema.partners.color })
      .from(schema.partners)
      .where(and(tenantWhere(schema.partners, scope), isNull(schema.partners.deletedAt))),
    db
      .select({ matchPattern: schema.campaignRecodes.matchPattern, code: schema.campaignRecodes.code })
      .from(schema.campaignRecodes)
      .where(tenantWhere(schema.campaignRecodes, scope)),
  ]);

  const partners: Record<string, PartnerView> = {};
  for (const p of partnerRows) partners[p.id] = { id: p.id, name: p.name, refId: p.refId, color: p.color };

  const summary = computeRunSummary(
    leadRows.map((l) => ({
      mlsStatus: l.mlsStatus,
      matchMethod: l.matchMethod,
      partnerId: l.partnerId,
      previouslyMatched: l.previouslyMatched,
    })),
  );

  const distribution = summary.perPartner
    .map((pp) => {
      const p = partners[pp.partnerId];
      return p ? { partnerId: pp.partnerId, count: pp.count, name: p.name, refId: p.refId, color: p.color } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const leads: RunLeadView[] = leadRows.map((l) => ({
    refId: l.refId,
    campaignCode: recode(l.campaign ?? "", recodeRows),
    address: l.address ?? "",
    city: l.city ?? "",
    state: l.state ?? "",
    zip: l.zip ?? "",
    sellerFirst: l.sellerFirst ?? "",
    sellerLast: l.sellerLast ?? "",
    partnerId: l.partnerId,
    matchMethod: l.matchMethod,
    mlsStatus: l.mlsStatus,
    mlsPatternKey: l.mlsPatternKey,
    previouslyMatched: l.previouslyMatched,
    possibleMlsListing: l.possibleMlsListing,
  }));

  return {
    upload: { refId: upload.refId, filename: upload.filename, status: upload.status, rowCount: upload.rowCount, createdAt: upload.createdAt.toISOString(), voidReason: upload.voidReason },
    summary,
    distribution,
    partners,
    leads,
  };
}
