import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, partnerOwnsLead, type ScopeContext } from "@/lib/scope";
import { releaseCutoff } from "../run/hold-window";
import { DEFAULT_STATUS } from "../portal/statuses";
import { rangeWindow, type RangeKey } from "./ranges";

// Per-partner performance (ANA-02/03) — the single home of these numbers (PRN-15). The
// async fetch is SQL-scoped to ONE partner (effective owner = partnerId); the pure
// `buildPartnerPerformance` does the range/bucket math (PRN-01 style — `now` injected).

export interface PartnerLeadFact {
  receivedAt: string;
  /** Earliest partner action: a non-New status change OR a partner note (PRN-13). */
  firstTouchAt: string | null;
  closedAt: string | null;
}

export interface PartnerPerformance {
  range: { key: RangeKey; start: string; end: string; bucket: "day" | "month" };
  stats: { given: number; contacted: number; closed: number; untouched: number; avgContactHours: number | null };
  history: { bucketStart: string; given: number; contacted: number; closed: number }[];
}

const HOUR = 3_600_000;
const DAY = 86_400_000;

const inRange = (iso: string | null, start: number, end: number): boolean => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= start && t < end;
};

function truncKey(iso: string, bucket: "day" | "month"): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  if (bucket === "month") return `${y}-${m}`;
  return `${y}-${m}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

const bucketStartIso = (key: string, bucket: "day" | "month"): string =>
  bucket === "month" ? `${key}-01T00:00:00.000Z` : `${key}T00:00:00.000Z`;

function seriesKeys(loMs: number, hiMs: number, bucket: "day" | "month"): string[] {
  const keys: string[] = [];
  if (bucket === "day") {
    for (let t = loMs; t <= hiMs; t += DAY) keys.push(truncKey(new Date(t).toISOString(), "day"));
  } else {
    let y = new Date(loMs).getUTCFullYear();
    let m = new Date(loMs).getUTCMonth();
    const hiY = new Date(hiMs).getUTCFullYear();
    const hiM = new Date(hiMs).getUTCMonth();
    while (y < hiY || (y === hiY && m <= hiM)) {
      keys.push(`${y}-${String(m + 1).padStart(2, "0")}`);
      m += 1;
      if (m > 11) { m = 0; y += 1; }
    }
  }
  return keys;
}

/** PURE (ANA-02/03). `now` is injected; the single home of these numbers (PRN-15). */
export function buildPartnerPerformance(range: RangeKey, now: Date, facts: readonly PartnerLeadFact[]): PartnerPerformance {
  const w = rangeWindow(range, now);
  const startMs = w.start.getTime();
  const endMs = w.end.getTime();

  let given = 0;
  let contacted = 0;
  let closed = 0;
  let untouched = 0;
  let touchSumH = 0;
  for (const f of facts) {
    if (inRange(f.receivedAt, startMs, endMs)) {
      given += 1;
      if (f.firstTouchAt === null) untouched += 1; // in-range lead with no partner action yet
    }
    if (inRange(f.firstTouchAt, startMs, endMs)) {
      contacted += 1;
      touchSumH += (new Date(f.firstTouchAt!).getTime() - new Date(f.receivedAt).getTime()) / HOUR;
    }
    if (inRange(f.closedAt, startMs, endMs)) closed += 1;
  }
  const avgContactHours = contacted === 0 ? null : Math.round((touchSumH / contacted) * 10) / 10;
  const stats = { given, contacted, closed, untouched, avgContactHours };
  const meta = { key: range, start: w.start.toISOString(), end: w.end.toISOString(), bucket: w.bucket };

  // Series bounds: fixed windows span the whole window (zero-filled edges); all-time
  // spans the actual data (an epoch-based series would be absurd).
  let loMs = startMs;
  let hiMs = endMs;
  if (range === "all") {
    const times = facts
      .flatMap((f) => [f.receivedAt, f.firstTouchAt, f.closedAt])
      .filter((x): x is string => Boolean(x))
      .map((x) => new Date(x).getTime());
    if (times.length === 0) return { range: meta, stats, history: [] };
    loMs = Math.min(...times);
    hiMs = Math.max(...times);
  }

  const keys = seriesKeys(loMs, hiMs, w.bucket);
  const idx = new Map(keys.map((k) => [k, { bucketStart: bucketStartIso(k, w.bucket), given: 0, contacted: 0, closed: 0 }]));
  for (const f of facts) {
    if (inRange(f.receivedAt, startMs, endMs)) { const b = idx.get(truncKey(f.receivedAt, w.bucket)); if (b) b.given += 1; }
    if (inRange(f.firstTouchAt, startMs, endMs)) { const b = idx.get(truncKey(f.firstTouchAt!, w.bucket)); if (b) b.contacted += 1; }
    if (inRange(f.closedAt, startMs, endMs)) { const b = idx.get(truncKey(f.closedAt!, w.bucket)); if (b) b.closed += 1; }
  }
  return { range: meta, stats, history: keys.map((k) => idx.get(k)!) };
}

/** SQL-scoped per-partner facts + the pure aggregate (PRN-15). Effective owner =
 *  `coalesce(manual_partner_id, partner_id) = partnerId`; kept, not deleted. `firstTouchAt`
 *  = earliest non-New status change OR partner note (author_role='partner', PRN-13). */
export async function partnerPerformanceDetail(scope: ScopeContext, partnerId: string, range: RangeKey): Promise<PartnerPerformance> {
  const db = getDb();
  const leadTenant = tenantWhere(schema.leads, scope);
  const histTenant = tenantWhere(schema.leadStatusHistory, scope);
  const noteTenant = tenantWhere(schema.leadNotes, scope);
  // Distribution hold: a partner's own dashboard counts only RELEASED leads (held leads aren't
  // theirs yet); the admin's view of a partner's stats sees everything.
  // Pass the cutoff as an ISO string + explicit cast: db.execute()'s raw path can't serialize a
  // Date param (unlike the query builder used elsewhere).
  const holdGate = scope.role === "partner" ? sql`and created_at < ${releaseCutoff(new Date()).toISOString()}::timestamptz` : sql``;

  const rows = await db.execute(sql`
    with partner_leads as (
      select id, created_at from leads
      where ${leadTenant} and deleted_at is null and mls_status = 'kept'
        and ${partnerOwnsLead(partnerId)} ${holdGate}
    ),
    status_hist as (
      select lead_id,
        min(created_at) filter (where status <> ${DEFAULT_STATUS}) as status_touch,
        max(created_at) filter (where status = 'Closed') as closed_at
      from lead_status_history
      where ${histTenant} and lead_id in (select id from partner_leads)
      group by lead_id
    ),
    note_hist as (
      select lead_id, min(created_at) as note_touch
      from lead_notes
      where ${noteTenant} and author_role = 'partner' and lead_id in (select id from partner_leads)
      group by lead_id
    )
    select
      pl.created_at::text as received_at,
      least(sh.status_touch, nh.note_touch)::text as first_touch_at,
      sh.closed_at::text as closed_at
    from partner_leads pl
    left join status_hist sh on sh.lead_id = pl.id
    left join note_hist nh on nh.lead_id = pl.id
  `);

  const facts: PartnerLeadFact[] = (rows as unknown as { received_at: string; first_touch_at: string | null; closed_at: string | null }[]).map((r) => ({
    receivedAt: new Date(r.received_at).toISOString(),
    firstTouchAt: r.first_touch_at ? new Date(r.first_touch_at).toISOString() : null,
    closedAt: r.closed_at ? new Date(r.closed_at).toISOString() : null,
  }));

  return buildPartnerPerformance(range, new Date(), facts);
}
