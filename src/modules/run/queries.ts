import { and, eq, ne, gte, isNull, lte, desc, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, leadWhere, type ScopeContext } from "@/lib/scope";
import { computeRunSummary } from "../analytics/run-summary";
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

export interface RunListPage {
  runs: RunListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ListRunsPageOpts {
  page?: number;
  pageSize?: number;
  /** Processed-date bounds (YYYY-MM-DD, inclusive) — validated at the route boundary. */
  dateFrom?: string;
  dateTo?: string;
}

/** Server-side paginated + date-filtered imports list (T4, FEP-03 — the seeded year
 *  put 365 rows in the unpaginated list). The WHERE is shared by the row select and
 *  the count(*) so `total` always matches the filter (count-consistency). Tenant-
 *  scoped via the guard (PRN-08). `listRuns` above remains the unpaged read (AI tool). */
export async function listRunsPage(scope: ScopeContext, opts: ListRunsPageOpts = {}): Promise<RunListPage> {
  const db = getDb();
  const page = Math.max(1, Math.floor(opts.page ?? 1) || 1);
  const pageSize = opts.pageSize === 10 || opts.pageSize === 50 ? opts.pageSize : 20;

  const conds: SQL[] = [tenantWhere(schema.uploads, scope)];
  // Date bounds mirror the leads list (UTC day bounds, inclusive).
  if (opts.dateFrom) conds.push(gte(schema.uploads.createdAt, new Date(`${opts.dateFrom}T00:00:00Z`)));
  if (opts.dateTo) conds.push(lte(schema.uploads.createdAt, new Date(`${opts.dateTo}T23:59:59Z`)));
  const where = and(...conds);

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        refId: schema.uploads.refId,
        filename: schema.uploads.filename,
        status: schema.uploads.status,
        rowCount: schema.uploads.rowCount,
        createdAt: schema.uploads.createdAt,
      })
      .from(schema.uploads)
      .where(where)
      .orderBy(desc(schema.uploads.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(schema.uploads).where(where),
  ]);

  return {
    runs: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    page,
    pageSize,
    total: Number(totalRows[0]?.total ?? 0),
  };
}

/** ADR-0038: the most recent non-voided upload with the same file fingerprint, if any —
 *  powers the identical-file re-upload warn-and-confirm. Tenant-scoped (PRN-08). */
export async function findDuplicateUpload(
  scope: ScopeContext,
  contentHash: string,
): Promise<{ refId: string; createdAt: string } | null> {
  const db = getDb();
  const [row] = await db
    .select({ refId: schema.uploads.refId, createdAt: schema.uploads.createdAt })
    .from(schema.uploads)
    .where(
      and(
        tenantWhere(schema.uploads, scope),
        eq(schema.uploads.contentHash, contentHash),
        ne(schema.uploads.status, "voided"), // a voided run was recalled — re-upload is expected
      ),
    )
    .orderBy(desc(schema.uploads.createdAt))
    .limit(1);
  return row ? { refId: row.refId, createdAt: row.createdAt.toISOString() } : null;
}

export async function getRunDetail(scope: ScopeContext, ref: string): Promise<RunDetail | null> {
  const db = getDb();

  const [upload] = await db
    .select()
    .from(schema.uploads)
    .where(and(tenantWhere(schema.uploads, scope), eq(schema.uploads.refId, ref)));
  if (!upload) return null;

  const [leadRows, partnerRows] = await Promise.all([
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
        possibleMlsListing: schema.leads.possibleMlsListing,
      })
      .from(schema.leads)
      .where(and(leadWhere(scope), eq(schema.leads.uploadId, upload.id))),
    db
      .select({ id: schema.partners.id, name: schema.partners.name, refId: schema.partners.refId, color: schema.partners.color })
      .from(schema.partners)
      .where(and(tenantWhere(schema.partners, scope), isNull(schema.partners.deletedAt))),
  ]);

  const partners: Record<string, PartnerView> = {};
  for (const p of partnerRows) partners[p.id] = { id: p.id, name: p.name, refId: p.refId, color: p.color };

  const summary = computeRunSummary(
    leadRows.map((l) => ({
      mlsStatus: l.mlsStatus,
      matchMethod: l.matchMethod,
      partnerId: l.partnerId,
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
    campaign: l.campaign ?? "",
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
