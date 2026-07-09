import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import { buildAnalytics, type AnalyticsResult } from "./overview";
import {
  buildPeriodSummary,
  bucketByWeek,
  type Period,
  type PeriodSummary,
  type WeekBucket,
} from "./periods";
import { campaignQuality, type CampaignQuality } from "./source-quality";
import { rangeWindow, deltaOf, type RangeKey } from "./ranges";
import { DEFAULT_STATUS } from "../portal/statuses";

// ANA-01 read side. Admin-only (the route enforces role); tenant-scoped through
// the guard (PRN-08). Fetches minimal per-lead fields + run/partner metadata and
// hands them to the pure aggregator (PRN-15).

export interface AnalyticsPartnerTotal {
  partnerId: string;
  name: string;
  refId: string;
  color: string;
  count: number;
}

export interface AnalyticsResponse extends Omit<AnalyticsResult, "partnerTotals"> {
  partnerTotals: AnalyticsPartnerTotal[];
  /** Weekly trend series (zero-filled gaps make skipped weeks visible). */
  weekly: WeekBucket[];
  /** Per-campaign volume + removal rate — lead-source quality (ANA-02). */
  campaigns: CampaignQuality[];
}

export async function analyticsOverview(scope: ScopeContext): Promise<AnalyticsResponse> {
  const db = getDb();

  const [leadRows, runRows, partnerRows] = await Promise.all([
    db
      .select({
        uploadId: schema.leads.uploadId,
        mlsStatus: schema.leads.mlsStatus,
        matchMethod: schema.leads.matchMethod,
        partnerId: schema.leads.partnerId,
        mlsReason: schema.leads.mlsReason,
        previouslyMatched: schema.leads.previouslyMatched,
        createdAt: schema.leads.createdAt,
        campaign: schema.leads.campaign,
      })
      .from(schema.leads)
      .where(and(tenantWhere(schema.leads, scope), isNull(schema.leads.deletedAt))),
    db
      .select({ uploadId: schema.uploads.id, refId: schema.uploads.refId, createdAt: schema.uploads.createdAt })
      .from(schema.uploads)
      .where(and(tenantWhere(schema.uploads, scope), eq(schema.uploads.status, "processed"), isNull(schema.uploads.voidedAt))),
    db
      .select({ id: schema.partners.id, name: schema.partners.name, refId: schema.partners.refId, color: schema.partners.color })
      .from(schema.partners)
      .where(and(tenantWhere(schema.partners, scope), isNull(schema.partners.deletedAt))),
  ]);

  const result = buildAnalytics(
    leadRows.map((l) => ({
      uploadId: l.uploadId,
      mlsStatus: l.mlsStatus,
      matchMethod: l.matchMethod,
      partnerId: l.partnerId,
      mlsReason: l.mlsReason,
      previouslyMatched: l.previouslyMatched,
    })),
    runRows.map((r) => ({ uploadId: r.uploadId, refId: r.refId, createdAt: r.createdAt.toISOString() })),
  );

  const partnerById = new Map(partnerRows.map((p) => [p.id, p]));
  const partnerTotals: AnalyticsPartnerTotal[] = result.partnerTotals.map((t) => {
    const p = partnerById.get(t.partnerId);
    return {
      partnerId: t.partnerId,
      name: p?.name ?? "Unknown partner",
      refId: p?.refId ?? "—",
      color: p?.color ?? "var(--text-3)",
      count: t.count,
    };
  });

  const weekly = bucketByWeek(
    leadRows.map((l) => ({
      receivedAt: l.createdAt.toISOString(),
      mlsStatus: l.mlsStatus,
      partnerId: l.partnerId,
      previouslyMatched: l.previouslyMatched,
    })),
  );

  const campaigns = campaignQuality(leadRows.map((l) => ({ campaign: l.campaign, mlsStatus: l.mlsStatus })));

  return { ...result, partnerTotals, weekly, campaigns };
}

/** Period KPIs for the dashboard (week/month/year/all + deltas vs the same
 *  elapsed span of the previous period). `now` is stamped here — the pure math
 *  in periods.ts never reads the clock (PRN-01). */
export async function periodSummary(scope: ScopeContext, period: Period): Promise<PeriodSummary> {
  const db = getDb();
  const leadRows = await db
    .select({
      mlsStatus: schema.leads.mlsStatus,
      partnerId: schema.leads.partnerId,
      previouslyMatched: schema.leads.previouslyMatched,
      createdAt: schema.leads.createdAt,
    })
    .from(schema.leads)
    .where(and(tenantWhere(schema.leads, scope), isNull(schema.leads.deletedAt)));

  return buildPeriodSummary(
    leadRows.map((l) => ({
      receivedAt: l.createdAt.toISOString(),
      mlsStatus: l.mlsStatus,
      partnerId: l.partnerId,
      previouslyMatched: l.previouslyMatched,
    })),
    period,
    new Date(),
  );
}

export interface DashboardStat {
  value: number;
  delta: number | null;
}
export interface DashboardPartnerRow {
  partnerId: string;
  name: string;
  refId: string;
  color: string;
  given: number;
  untouched: number;
  contacted: number;
  closed: number;
  avgContactHours: number | null;
}
export interface DashboardSourceRow {
  campaign: string;
  imported: number;
  removed: number;
  closed: number;
  removalRate: number;
}
export interface DashboardData {
  range: { key: RangeKey; start: string; end: string; bucket: "day" | "month" };
  stats: {
    leadsIn: DashboardStat;
    distributed: DashboardStat;
    removed: DashboardStat;
    unmatched: DashboardStat;
    closed: DashboardStat;
  };
  trend: { bucketStart: string; leadsIn: number; distributed: number; unmatched: number }[];
  partners: DashboardPartnerRow[];
  sources: DashboardSourceRow[];
}

/** Every dashboard number, aggregated in SQL bounded by the selected range (F-10,
 *  PRN-15). `now` is stamped once here; the pure window math lives in ranges.ts.
 *  Distributed uses the effective owner `coalesce(manual_partner_id, partner_id)`
 *  (the WS-0 / ASN-04 rule). Raw SQL embeds `tenantWhere` so scoping stays on the
 *  guard (PRN-08); no table alias is used so the generated column resolves. */
export async function dashboardData(scope: ScopeContext, range: RangeKey): Promise<DashboardData> {
  const db = getDb();
  const w = rangeWindow(range, new Date());
  const start = w.start.toISOString();
  const end = w.end.toISOString();
  // Prior window: use the current start as a no-match sentinel when there is none
  // (all-time), so prior counts read 0; deltas are nulled in JS via deltaOf.
  const pStart = (w.prevStart ?? w.start).toISOString();
  const pEnd = (w.prevEnd ?? w.start).toISOString();
  const noPrior = w.prevStart === null;
  const interval = w.bucket === "day" ? "1 day" : "1 month";
  const trunc = w.bucket; // 'day' | 'month' — from a fixed enum, safe to bind
  const leadTenant = tenantWhere(schema.leads, scope);
  const histTenant = tenantWhere(schema.leadStatusHistory, scope);
  const noteTenant = tenantWhere(schema.leadNotes, scope);
  // Trend spans the FULL selected window for fixed ranges (edges zero-filled);
  // for all-time it falls back to the actual lead date span (F-2).
  const seriesStart = range === "all" ? null : start;
  const seriesEnd = range === "all" ? null : end;

  const [statRes, closedRes, trendRes, partnerRes, partnerMeta, sourceRes] = await Promise.all([
    // ── Flat lead-count stats: current + prior windows in one pass ──
    db.execute(sql`
      select
        count(*) filter (where created_at >= ${start} and created_at < ${end})::int as li,
        count(*) filter (where created_at >= ${start} and created_at < ${end} and mls_status='kept' and coalesce(manual_partner_id, partner_id) is not null)::int as di,
        count(*) filter (where created_at >= ${start} and created_at < ${end} and mls_status='removed')::int as rm,
        count(*) filter (where created_at >= ${start} and created_at < ${end} and mls_status='kept' and coalesce(manual_partner_id, partner_id) is null)::int as un,
        count(*) filter (where created_at >= ${pStart} and created_at < ${pEnd})::int as pli,
        count(*) filter (where created_at >= ${pStart} and created_at < ${pEnd} and mls_status='kept' and coalesce(manual_partner_id, partner_id) is not null)::int as pdi,
        count(*) filter (where created_at >= ${pStart} and created_at < ${pEnd} and mls_status='removed')::int as prm,
        count(*) filter (where created_at >= ${pStart} and created_at < ${pEnd} and mls_status='kept' and coalesce(manual_partner_id, partner_id) is null)::int as pun
      from leads where ${leadTenant} and deleted_at is null
    `),
    // ── Closed = leads whose LATEST Closed status event lands in the window ──
    db.execute(sql`
      with closed as (
        select lead_id, max(created_at) as closed_at
        from lead_status_history where ${histTenant} and status = 'Closed' group by lead_id
      )
      select
        count(*) filter (where closed_at >= ${start} and closed_at < ${end})::int as c,
        count(*) filter (where closed_at >= ${pStart} and closed_at < ${pEnd})::int as pc
      from closed
    `),
    // ── Trend: zero-filled buckets between first & last in-window lead ──
    db.execute(sql`
      with bounds as (
        select
          coalesce(date_trunc(${trunc}, ${seriesStart}::timestamptz), date_trunc(${trunc}, min(created_at))) as lo,
          coalesce(date_trunc(${trunc}, ${seriesEnd}::timestamptz), date_trunc(${trunc}, max(created_at))) as hi
        from leads where ${leadTenant} and deleted_at is null and created_at >= ${start} and created_at < ${end}
      ),
      buckets as (
        select generate_series(bounds.lo, bounds.hi, ${sql.raw(`interval '${interval}'`)}) as b from bounds where bounds.lo is not null
      ),
      agg as (
        select date_trunc(${trunc}, created_at) as b,
          count(*)::int as leads_in,
          count(*) filter (where mls_status='kept' and coalesce(manual_partner_id, partner_id) is not null)::int as distributed,
          count(*) filter (where mls_status='kept' and coalesce(manual_partner_id, partner_id) is null)::int as unmatched
        from leads where ${leadTenant} and deleted_at is null and created_at >= ${start} and created_at < ${end}
        group by 1
      )
      select buckets.b::text as bucket_start,
        coalesce(agg.leads_in, 0)::int as leads_in,
        coalesce(agg.distributed, 0)::int as distributed,
        coalesce(agg.unmatched, 0)::int as unmatched
      from buckets left join agg on agg.b = buckets.b order by buckets.b
    `),
    // ── Partner performance: per-lead history facts → per effective-partner aggregates.
    //    A partner's first "action" = earliest non-New status change OR earliest
    //    partner note (spec/ANA-03: "status change or partner note"). Notes are
    //    filtered to author_role='partner' so admin notes stay invisible (PRN-13);
    //    "untouched" = a given lead with no action at all. ──
    db.execute(sql`
      with status_hist as (
        select lead_id,
          min(created_at) filter (where status <> ${DEFAULT_STATUS}) as status_touch,
          max(created_at) filter (where status = 'Closed') as closed_at
        from lead_status_history where ${histTenant} group by lead_id
      ),
      note_hist as (
        select lead_id, min(created_at) as note_touch
        from lead_notes where ${noteTenant} and author_role = 'partner' group by lead_id
      ),
      facts as (
        select coalesce(leads.manual_partner_id, leads.partner_id) as pid,
          leads.created_at as received_at,
          least(sh.status_touch, nh.note_touch) as first_touch_at,
          sh.closed_at
        from leads
        left join status_hist sh on sh.lead_id = leads.id
        left join note_hist nh on nh.lead_id = leads.id
        where ${leadTenant} and leads.deleted_at is null and leads.mls_status='kept'
          and coalesce(leads.manual_partner_id, leads.partner_id) is not null
      )
      select pid::text as pid,
        count(*) filter (where received_at >= ${start} and received_at < ${end})::int as given,
        count(*) filter (where received_at >= ${start} and received_at < ${end} and first_touch_at is null)::int as untouched,
        count(*) filter (where first_touch_at >= ${start} and first_touch_at < ${end})::int as contacted,
        count(*) filter (where closed_at >= ${start} and closed_at < ${end})::int as closed,
        avg(extract(epoch from (first_touch_at - received_at)) / 3600.0)
          filter (where first_touch_at >= ${start} and first_touch_at < ${end}) as avg_contact_hours
      from facts group by pid
      order by given desc, contacted desc, pid
    `),
    // ── Partner metadata for name/ref/color ──
    db
      .select({ id: schema.partners.id, name: schema.partners.name, refId: schema.partners.refId, color: schema.partners.color })
      .from(schema.partners)
      .where(and(tenantWhere(schema.partners, scope), isNull(schema.partners.deletedAt))),
    // ── Source performance ──
    db.execute(sql`
      with closed as (
        select lead_id, max(created_at) filter (where status='Closed') as closed_at
        from lead_status_history where ${histTenant} group by lead_id
      )
      select coalesce(nullif(trim(leads.campaign), ''), 'Unattributed') as campaign,
        count(*) filter (where leads.created_at >= ${start} and leads.created_at < ${end})::int as imported,
        count(*) filter (where leads.created_at >= ${start} and leads.created_at < ${end} and leads.mls_status='removed')::int as removed,
        count(*) filter (where closed.closed_at >= ${start} and closed.closed_at < ${end})::int as closed
      from leads left join closed on closed.lead_id = leads.id
      where ${leadTenant} and leads.deleted_at is null
      group by 1 order by imported desc, campaign
    `),
  ]);

  const s = (statRes as unknown as Record<string, number>[])[0] ?? {};
  const cl = (closedRes as unknown as Record<string, number>[])[0] ?? { c: 0, pc: 0 };
  const stat = (cur: unknown, prev: unknown): DashboardStat => {
    const c = Number(cur ?? 0);
    return { value: c, delta: noPrior ? null : deltaOf(c, Number(prev ?? 0)) };
  };

  const metaById = new Map(
    (partnerMeta as { id: string; name: string; refId: string; color: string }[]).map((p) => [p.id, p]),
  );
  const partners: DashboardPartnerRow[] = (
    partnerRes as unknown as { pid: string; given: number; untouched: number; contacted: number; closed: number; avg_contact_hours: number | null }[]
  ).map((r) => {
    const meta = metaById.get(r.pid);
    return {
      partnerId: r.pid,
      name: meta?.name ?? "Unknown partner",
      refId: meta?.refId ?? "—",
      color: meta?.color ?? "var(--text-3)",
      given: Number(r.given),
      untouched: Number(r.untouched),
      contacted: Number(r.contacted),
      closed: Number(r.closed),
      avgContactHours: r.avg_contact_hours === null ? null : Math.round(Number(r.avg_contact_hours) * 10) / 10,
    };
  });

  const sources: DashboardSourceRow[] = (
    sourceRes as unknown as { campaign: string; imported: number; removed: number; closed: number }[]
  ).map((r) => ({
    campaign: r.campaign,
    imported: Number(r.imported),
    removed: Number(r.removed),
    closed: Number(r.closed),
    removalRate: Number(r.imported) === 0 ? 0 : Number(r.removed) / Number(r.imported),
  }));

  const trend = (
    trendRes as unknown as { bucket_start: string; leads_in: number; distributed: number; unmatched: number }[]
  ).map((r) => ({
    bucketStart: r.bucket_start,
    leadsIn: Number(r.leads_in),
    distributed: Number(r.distributed),
    unmatched: Number(r.unmatched),
  }));

  return {
    range: { key: range, start, end, bucket: w.bucket },
    stats: {
      leadsIn: stat(s.li, s.pli),
      distributed: stat(s.di, s.pdi),
      removed: stat(s.rm, s.prm),
      unmatched: stat(s.un, s.pun),
      closed: stat(cl.c, cl.pc),
    },
    trend,
    partners,
    sources,
  };
}
