"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { AppShell, PartnerTag, EmptyState, Skeleton } from "@/components";
import type { AnalyticsTotals, AnalyticsSeriesPoint } from "@/modules/analytics/overview";
import type { WeekBucket } from "@/modules/analytics/periods";

// ANA-01: the analytics overview — trends across runs and composition breakdowns.
// Every number comes from /api/analytics (the analytics module), never re-derived
// here (PRN-15). Charts are token-styled HTML/CSS — no chart dependency.
interface PartnerTotal {
  partnerId: string;
  name: string;
  refId: string;
  color: string;
  count: number;
}
interface AnalyticsResponse {
  totals: AnalyticsTotals;
  series: AnalyticsSeriesPoint[];
  weekly: WeekBucket[];
  matchBreakdown: { zip: number; stateFallback: number; unmatched: number };
  removalReasons: { reason: string; count: number }[];
  partnerTotals: PartnerTotal[];
}

const panel = "rounded-2xl border border-border-soft bg-surface p-5 shadow-sm";
const pct = (n: number) => `${Math.round(n * 100)}%`;

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: "brand" | "danger" | "warn" }) {
  const color = tone === "brand" ? "text-brand" : tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-text";
  return (
    <div className={panel}>
      <div className="text-xs font-medium text-text-2">{label}</div>
      <div className={`mt-1.5 font-display text-2xl font-semibold leading-none tracking-tight tabular-nums ${color}`}>{value}</div>
      {sub && <div className="num mt-1 text-[.68rem] text-text-3">{sub}</div>}
    </div>
  );
}

/** Stacked weekly bars: delivered / unmatched / removed. Zero-filled weeks stay
 *  visible so a skipped import week shows as a gap, not a lie (ANA-01). */
function TrendChart({ weekly }: { weekly: WeekBucket[] }) {
  if (weekly.length === 0) return <p className="py-8 text-center text-sm text-text-3">No processed imports yet.</p>;
  const max = Math.max(1, ...weekly.map((w) => w.total));
  const label = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <div className="flex h-48 items-end gap-3">
      {weekly.map((w) => (
        <div key={w.weekStart} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2">
          {w.total === 0 ? (
            <div className="w-full max-w-[56px] rounded-md border border-dashed border-border" style={{ height: 3 }} title={`Week of ${label(w.weekStart)}: no leads`} />
          ) : (
            <div
              className="flex w-full max-w-[56px] flex-col-reverse overflow-hidden rounded-md"
              style={{ height: `${(w.total / max) * 100}%` }}
              title={`Week of ${label(w.weekStart)}: ${w.delivered} delivered, ${w.unmatched} unmatched, ${w.removed} removed`}
            >
              {w.delivered > 0 && <div style={{ flex: w.delivered, background: "var(--brand)" }} />}
              {w.unmatched > 0 && <div style={{ flex: w.unmatched, background: "var(--warn)" }} />}
              {w.removed > 0 && <div style={{ flex: w.removed, background: "var(--danger-soft)" }} className="border-t border-dashed border-danger" />}
            </div>
          )}
          <span className="num max-w-full truncate text-[.6rem] text-text-3">{label(w.weekStart)}</span>
        </div>
      ))}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string; value: React.ReactNode }[] }) {
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-2 text-xs">
          <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: it.color }} />
          <span className="text-text-2">{it.label}</span>
          <span className="num ml-auto text-text-3">{it.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  const { data, isPending, error } = useQuery({
    queryKey: ["analytics"],
    queryFn: () => apiGet<AnalyticsResponse>("/api/analytics"),
  });

  const t = data?.totals;
  const mb = data?.matchBreakdown;
  const keptTotal = mb ? mb.zip + mb.stateFallback + mb.unmatched : 0;
  const maxPartner = Math.max(1, ...(data?.partnerTotals ?? []).map((p) => p.count));
  const maxReason = Math.max(1, ...(data?.removalReasons ?? []).map((r) => r.count));

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="mt-1 text-sm text-text-2">How your leads route, get filtered, and reach partners — across every import.</p>
      </div>

      {isPending ? (
        <Skeleton className="h-[460px] rounded-2xl" />
      ) : error ? (
        <div className={panel}>
          <EmptyState title="Couldn't load analytics" description={(error as Error).message} />
        </div>
      ) : t && t.total === 0 ? (
        <div className={panel}>
          <EmptyState title="No data yet" description="Process your first weekly file to see analytics here." />
        </div>
      ) : (
        <div className="stagger flex flex-col gap-5">
          {/* KPI strip */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Leads processed" value={t!.total} sub="all imports" />
            <Stat label="Delivered" value={t!.delivered} sub={`${pct(t!.deliveryRate)} of total`} tone="brand" />
            <Stat label="Removed · MLS" value={t!.removed} sub={`${pct(t!.removalRate)} of total`} tone="danger" />
            <Stat label="Unmatched" value={t!.unmatched} sub="no coverage" tone="warn" />
            <Stat label="Repeat sellers" value={t!.previouslyMatched} sub="seen before" />
          </div>

          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.6fr_1fr]">
            {/* Trend */}
            <section className={panel}>
              <h2 className="mb-4 font-display text-[.95rem] font-semibold tracking-tight">Leads per week</h2>
              <TrendChart weekly={data!.weekly} />
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[.7rem] text-text-3">
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "var(--brand)" }} /> Delivered</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "var(--warn)" }} /> Unmatched</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] border border-dashed border-danger" style={{ background: "var(--danger-soft)" }} /> Removed</span>
              </div>
            </section>

            {/* Routing composition */}
            <section className={panel}>
              <h2 className="mb-4 font-display text-[.95rem] font-semibold tracking-tight">How leads routed</h2>
              {keptTotal === 0 ? (
                <p className="text-sm text-text-3">No kept leads yet.</p>
              ) : (
                <>
                  <div className="flex h-3 overflow-hidden rounded-full">
                    {mb!.zip > 0 && <div style={{ flex: mb!.zip, background: "var(--brand)" }} />}
                    {mb!.stateFallback > 0 && <div style={{ flex: mb!.stateFallback, background: "var(--info)" }} />}
                    {mb!.unmatched > 0 && <div style={{ flex: mb!.unmatched, background: "var(--warn)" }} />}
                  </div>
                  <Legend
                    items={[
                      { label: "ZIP match", color: "var(--brand)", value: `${mb!.zip} · ${pct(mb!.zip / keptTotal)}` },
                      { label: "State fallback", color: "var(--info)", value: `${mb!.stateFallback} · ${pct(mb!.stateFallback / keptTotal)}` },
                      { label: "Unmatched", color: "var(--warn)", value: `${mb!.unmatched} · ${pct(mb!.unmatched / keptTotal)}` },
                    ]}
                  />
                </>
              )}
            </section>
          </div>

          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
            {/* Partner performance */}
            <section className={panel}>
              <h2 className="mb-4 font-display text-[.95rem] font-semibold tracking-tight">Leads by partner</h2>
              {data!.partnerTotals.length === 0 ? (
                <p className="text-sm text-text-3">No leads delivered to partners yet.</p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {data!.partnerTotals.map((p) => (
                    <div key={p.partnerId} className="grid grid-cols-[minmax(0,1fr)_1fr_auto] items-center gap-3">
                      <PartnerTag name={p.name} color={p.color} refId={p.refId} size="sm" className="min-w-0" />
                      <span className="h-2 overflow-hidden rounded-full bg-surface-3">
                        <span className="block h-full rounded-full" style={{ width: `${(p.count / maxPartner) * 100}%`, background: p.color }} />
                      </span>
                      <span className="num w-7 text-right text-sm font-medium">{p.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Removal reasons */}
            <section className={panel}>
              <h2 className="mb-4 font-display text-[.95rem] font-semibold tracking-tight">Why leads were removed (MLS)</h2>
              {data!.removalReasons.length === 0 ? (
                <p className="text-sm text-text-3">No leads removed — nothing was found listed.</p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {data!.removalReasons.map((r) => (
                    <div key={r.reason} className="grid grid-cols-[minmax(0,1fr)_1fr_auto] items-center gap-3">
                      <span className="truncate text-sm text-text-2" title={r.reason}>{r.reason}</span>
                      <span className="h-2 overflow-hidden rounded-full bg-surface-3">
                        <span className="block h-full rounded-full" style={{ width: `${(r.count / maxReason) * 100}%`, background: "var(--danger)" }} />
                      </span>
                      <span className="num w-7 text-right text-sm font-medium">{r.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </AppShell>
  );
}
