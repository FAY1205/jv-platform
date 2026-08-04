// ─────────────────────────────────────────────────────────────────────────────
// Analytics overview (ANA-01). PURE — no I/O, no Date.now() (PRN-01). The single
// home of these cross-run statistics (PRN-15): the query layer fetches minimal
// per-lead fields and this shapes them into trend series + composition. Partition
// invariant: total = delivered + unmatched + removed.
// ─────────────────────────────────────────────────────────────────────────────

import type { MatchMethod } from "../pipeline/assign";

export interface AnalyticsLead {
  uploadId: string;
  mlsStatus: "kept" | "removed";
  matchMethod: MatchMethod;
  partnerId: string | null;
  mlsReason: string | null;
}

export interface AnalyticsRun {
  uploadId: string;
  refId: string;
  createdAt: string;
}

export interface AnalyticsTotals {
  total: number;
  delivered: number;
  unmatched: number;
  removed: number;
  deliveryRate: number;
  removalRate: number;
}

export interface AnalyticsSeriesPoint {
  uploadId: string;
  refId: string;
  date: string;
  total: number;
  delivered: number;
  unmatched: number;
  removed: number;
}

export interface AnalyticsResult {
  totals: AnalyticsTotals;
  series: AnalyticsSeriesPoint[];
  matchBreakdown: { zip: number; stateFallback: number; unmatched: number };
  removalReasons: { reason: string; count: number }[];
  partnerTotals: { partnerId: string; count: number }[];
}

const REMOVAL_FALLBACK = "Listed on MLS";

function emptyPoint(uploadId: string, refId: string, date: string): AnalyticsSeriesPoint {
  return { uploadId, refId, date, total: 0, delivered: 0, unmatched: 0, removed: 0 };
}

export function buildAnalytics(
  leads: readonly AnalyticsLead[],
  runs: readonly AnalyticsRun[],
): AnalyticsResult {
  const totals: AnalyticsTotals = {
    total: 0,
    delivered: 0,
    unmatched: 0,
    removed: 0,
    deliveryRate: 0,
    removalRate: 0,
  };

  const byRun = new Map<string, AnalyticsSeriesPoint>();
  for (const r of runs) byRun.set(r.uploadId, emptyPoint(r.uploadId, r.refId, r.createdAt));

  const match = { zip: 0, stateFallback: 0, unmatched: 0 };
  const reasons = new Map<string, number>();
  const partners = new Map<string, number>();

  for (const lead of leads) {
    const delivered = lead.mlsStatus === "kept" && lead.partnerId !== null;
    const unmatched = lead.mlsStatus === "kept" && lead.partnerId === null;
    const removed = lead.mlsStatus === "removed";

    totals.total += 1;
    if (delivered) totals.delivered += 1;
    if (unmatched) totals.unmatched += 1;
    if (removed) totals.removed += 1;

    const point = byRun.get(lead.uploadId);
    if (point) {
      point.total += 1;
      if (delivered) point.delivered += 1;
      if (unmatched) point.unmatched += 1;
      if (removed) point.removed += 1;
    }

    if (lead.mlsStatus === "kept") {
      if (lead.matchMethod === "zip") match.zip += 1;
      else if (lead.matchMethod === "state_fallback") match.stateFallback += 1;
      else match.unmatched += 1;
    }

    if (delivered && lead.partnerId) {
      partners.set(lead.partnerId, (partners.get(lead.partnerId) ?? 0) + 1);
    }

    if (removed) {
      const reason = lead.mlsReason?.trim() || REMOVAL_FALLBACK;
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
  }

  totals.deliveryRate = totals.total === 0 ? 0 : totals.delivered / totals.total;
  totals.removalRate = totals.total === 0 ? 0 : totals.removed / totals.total;

  const series = [...byRun.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const removalReasons = [...reasons.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  const partnerTotals = [...partners.entries()]
    .map(([partnerId, count]) => ({ partnerId, count }))
    .sort((a, b) => b.count - a.count || a.partnerId.localeCompare(b.partnerId));

  return { totals, series, matchBreakdown: match, removalReasons, partnerTotals };
}
