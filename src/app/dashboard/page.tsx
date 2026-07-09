"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { AppShell, PartnerTag, EmptyState, Skeleton, Select, LineChart, DonutChart, Tooltip } from "@/components";
import { formatContactTime, AVG_CONTACT_DEFINITION, type RangeKey } from "@/modules/analytics/ranges";
import type { DashboardData } from "@/modules/analytics/queries";

// ADM-01: the business pulse — one screen (ANA-01). Rolling-window KPIs + trend on
// top; event-scoped partner and lead-source performance below. Every number is
// aggregated in SQL bounded by the selected range (F-10); nothing is re-derived
// here (PRN-15).

interface CoverageSummary { gapCount: number; unmatchedLeadCount: number }

const RANGES: { value: RangeKey; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "12mo", label: "Last 12 months" },
  { value: "all", label: "All time" },
];

const panel = "rounded-2xl border border-border-soft bg-surface p-5 shadow-sm";
const pct = (n: number) => `${Math.round(n * 100)}%`;

// Trend x-axis label: "Jul 3" for daily buckets, "Jul 2026" for monthly (F-4).
const fmtBucket = (iso: string, bucket: "day" | "month") => {
  const dt = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return bucket === "month"
    ? dt.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
    : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

// Donut palette from tokens (PRN-12); cycled per source. Names always accompany
// color in the legend + tooltip (PRN-14).
const SOURCE_COLORS = ["var(--brand)", "var(--warn)", "var(--danger)", "var(--text-3)", "var(--brand-strong)"];

function Delta({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="num text-[.66rem] text-text-3">all time</span>;
  const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "·";
  return <span className="num text-[.66rem] text-text-3">{arrow} {delta === 0 ? "same" : Math.abs(delta)} vs prior</span>;
}

function Stat({ label, value, delta, tone, tip }: { label: string; value: React.ReactNode; delta: number | null; tone?: "brand" | "danger" | "warn"; tip?: string }) {
  const color = tone === "brand" ? "text-brand" : tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-text";
  const header = (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-text-2">
      {label}
      {tip && <span className="cursor-help text-text-3" aria-hidden="true">ⓘ</span>}
    </span>
  );
  return (
    <div className="relative flex flex-col gap-1.5 px-5 py-4 first:pl-1 [&+&]:before:absolute [&+&]:before:left-0 [&+&]:before:top-4 [&+&]:before:bottom-4 [&+&]:before:w-px [&+&]:before:bg-border">
      {tip ? <Tooltip content={tip}>{header}</Tooltip> : header}
      <span className={`font-display text-3xl font-semibold leading-none tracking-tight tabular-nums ${color}`}>{value}</span>
      <Delta delta={delta} />
    </div>
  );
}

function HeaderTip({ label, tip }: { label: string; tip: string }) {
  return (
    <Tooltip content={tip}>
      <span className="inline-flex cursor-help items-center gap-1">{label}<span className="text-text-3" aria-hidden="true">ⓘ</span></span>
    </Tooltip>
  );
}

export default function DashboardPage() {
  const [range, setRange] = React.useState<RangeKey>("30d");
  const dash = useQuery({ queryKey: ["dashboard", range], queryFn: () => apiGet<DashboardData>(`/api/dashboard?range=${range}`) });
  const coverage = useQuery({ queryKey: ["coverage"], queryFn: () => apiGet<CoverageSummary>("/api/coverage") });

  const d = dash.data;
  const rangeLabel = RANGES.find((r) => r.value === range)!.label.toLowerCase();

  // Honest attention banner (F-21): an errored coverage query renders an explicit
  // error item — never a masked "all clear".
  const attention: { text: string; href: string; tone: "warn" | "danger" }[] = [];
  if (coverage.data) {
    if (coverage.data.unmatchedLeadCount > 0) attention.push({ text: `${coverage.data.unmatchedLeadCount} unmatched lead${coverage.data.unmatchedLeadCount === 1 ? "" : "s"} need a partner`, href: "/unmatched", tone: "danger" });
    if (coverage.data.gapCount > 0) attention.push({ text: `${coverage.data.gapCount} coverage gap${coverage.data.gapCount === 1 ? "" : "s"} — leads from unowned states`, href: "/coverage", tone: "warn" });
  }

  const donutData = (d?.sources ?? [])
    .filter((s) => s.removed > 0)
    .map((s, i) => ({ name: s.campaign, value: s.removed, color: SOURCE_COLORS[i % SOURCE_COLORS.length] }));

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-text-2">Your business at a glance — {rangeLabel}.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-44"><Select ariaLabel="Time range" value={range} onValueChange={(v) => setRange(v as RangeKey)} options={RANGES} /></div>
          <Link href="/upload" className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_18px_-8px_var(--brand)] transition-all duration-150 hover:-translate-y-0.5 hover:bg-brand-strong active:translate-y-0 active:scale-[.98]">
            <span className="text-base leading-none">+</span> New import
          </Link>
        </div>
      </div>

      {coverage.isError && (
        <div className="mb-5 flex items-center gap-2.5 rounded-2xl border border-danger-soft p-4 text-sm" style={{ background: "var(--danger-soft)" }}>
          <span className="h-2 w-2 shrink-0 rounded-full bg-danger" />
          <span className="font-medium text-text">Couldn&apos;t check for attention items.</span>
          <button type="button" onClick={() => coverage.refetch()} className="ml-auto text-xs font-semibold text-text-2 hover:underline">Retry</button>
        </div>
      )}

      {dash.isPending ? (
        <div className="flex flex-col gap-5"><Skeleton className="h-28" /><Skeleton className="h-64 rounded-2xl" /></div>
      ) : dash.error ? (
        <div className={panel}><EmptyState title="Couldn't load the dashboard" description={(dash.error as Error).message} /></div>
      ) : (
        <div className="stagger flex flex-col gap-5">
          {attention.length > 0 && (
            <div className="flex flex-col gap-2 rounded-2xl border border-warn-soft p-4" style={{ background: "var(--warn-soft)" }}>
              {attention.map((a) => (
                <Link key={a.text} href={a.href} className="group flex items-center gap-2.5 text-sm">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${a.tone === "danger" ? "bg-danger" : "bg-warn"}`} />
                  <span className="font-medium text-text">{a.text}</span>
                  <span className="ml-auto text-xs font-semibold text-text-2 group-hover:underline">Review →</span>
                </Link>
              ))}
            </div>
          )}

          {/* KPI band — 5 range-bounded cards with prior-window deltas */}
          <div className="grid grid-cols-2 rounded-2xl border border-border-soft bg-surface p-1 shadow-sm sm:grid-cols-5">
            <Stat label="Leads in" value={d!.stats.leadsIn.value} delta={d!.stats.leadsIn.delta} />
            <Stat label="Distributed" value={d!.stats.distributed.value} delta={d!.stats.distributed.delta} tone="brand" tip="Kept leads assigned to a partner (by routing or manual assignment) in the selected range." />
            <Stat label="Removed · MLS" value={d!.stats.removed.value} delta={d!.stats.removed.delta} tone="danger" tip="Leads discarded as already MLS-listed in the selected range." />
            <Stat label="Unmatched" value={d!.stats.unmatched.value} delta={d!.stats.unmatched.delta} tone="warn" tip="Kept leads with no partner in the selected range." />
            <Stat label="Closed" value={d!.stats.closed.value} delta={d!.stats.closed.delta} tip="Leads whose latest status became Closed in the selected range." />
          </div>

          {/* Trend */}
          <section className={panel}>
            <h2 className="mb-4 font-display text-[.95rem] font-semibold tracking-tight">Lead flow <span className="text-[.7rem] font-normal text-text-3">· {rangeLabel}</span></h2>
            {d!.trend.length === 0 ? (
              <p className="py-8 text-center text-sm text-text-3">No leads in this range.</p>
            ) : (
              <LineChart
                data={d!.trend.map((b) => ({ x: fmtBucket(b.bucketStart, d!.range.bucket), "Leads in": b.leadsIn, Distributed: b.distributed, Unmatched: b.unmatched }))}
                xKey="x"
                series={[
                  { key: "Leads in", name: "Leads in", color: "var(--text-2)" },
                  { key: "Distributed", name: "Distributed", color: "var(--brand)" },
                  { key: "Unmatched", name: "Unmatched", color: "var(--warn)" },
                ]}
              />
            )}
          </section>

          {/* Partner performance — no progress bars */}
          <section className={panel}>
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="font-display text-[.95rem] font-semibold tracking-tight">Partner performance</h2>
              <span className="text-[.7rem] text-text-3">{rangeLabel} · counts by when each event happened</span>
            </div>
            {d!.partners.length === 0 ? (
              <p className="py-4 text-sm text-text-3">No leads distributed {rangeLabel}.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[.65rem] font-semibold uppercase tracking-wider text-text-3">
                      <th className="py-2 pr-3 font-semibold">Partner</th>
                      <th className="px-2 py-2 text-right font-semibold">Given</th>
                      <th className="px-2 py-2 text-right font-semibold"><HeaderTip label="Untouched" tip="Given leads with no partner action yet — no status change or partner note." /></th>
                      <th className="px-2 py-2 text-right font-semibold"><HeaderTip label="Contacted" tip="Leads whose first partner action fell in the selected range." /></th>
                      <th className="px-2 py-2 text-right font-semibold"><HeaderTip label="Avg contact" tip={AVG_CONTACT_DEFINITION} /></th>
                      <th className="px-2 py-2 text-right font-semibold">Closed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d!.partners.map((p) => (
                      <tr key={p.partnerId} className="border-b border-border-soft transition-colors last:border-0 hover:bg-surface-2">
                        <td className="py-2.5 pr-3">
                          <Link href={`/partners/${p.partnerId}`} className="transition-opacity hover:opacity-70"><PartnerTag size="sm" name={p.name} color={p.color} refId={p.refId} /></Link>
                        </td>
                        <td className="px-2 py-2.5 text-right"><span className="num font-medium tabular-nums">{p.given}</span></td>
                        <td className="px-2 py-2.5 text-right"><span className={`num tabular-nums ${p.untouched > 0 ? "font-semibold text-warn" : "text-text-3"}`}>{p.untouched || "—"}</span></td>
                        <td className="px-2 py-2.5 text-right"><span className="num tabular-nums text-text-2">{p.contacted || "—"}</span></td>
                        <td className="px-2 py-2.5 text-right"><span className="num tabular-nums text-text-2">{formatContactTime(p.avgContactHours)}</span></td>
                        <td className="px-2 py-2.5 text-right"><span className={`num tabular-nums ${p.closed > 0 ? "font-semibold text-brand" : "text-text-3"}`}>{p.closed || "—"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Lead source performance + donut */}
          <section className={panel}>
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="font-display text-[.95rem] font-semibold tracking-tight">Lead source performance</h2>
              <span className="text-[.7rem] text-text-3">removal rate = share discarded as MLS-listed</span>
            </div>
            {d!.sources.length === 0 ? (
              <p className="py-4 text-sm text-text-3">No leads imported {rangeLabel}.</p>
            ) : (
              <div className="mt-3 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-[.65rem] font-semibold uppercase tracking-wider text-text-3">
                        <th className="py-2 pr-3 font-semibold">Source</th>
                        <th className="px-2 py-2 text-right font-semibold">Imported</th>
                        <th className="px-2 py-2 text-right font-semibold">Removed</th>
                        <th className="px-2 py-2 text-right font-semibold">Removal %</th>
                        <th className="px-2 py-2 text-right font-semibold">Closed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d!.sources.map((s) => {
                        const bad = s.removalRate >= 0.5, warn = s.removalRate >= 0.3;
                        return (
                          <tr key={s.campaign} className="border-b border-border-soft last:border-0 hover:bg-surface-2">
                            <td className="py-2.5 pr-3 font-medium text-text">{s.campaign}</td>
                            <td className="px-2 py-2.5 text-right num tabular-nums text-text-2">{s.imported}</td>
                            <td className="px-2 py-2.5 text-right num tabular-nums text-text-2">{s.removed}</td>
                            <td className={`px-2 py-2.5 text-right num tabular-nums font-semibold ${bad ? "text-danger" : warn ? "text-warn" : "text-text-2"}`}>{pct(s.removalRate)}</td>
                            <td className="px-2 py-2.5 text-right num tabular-nums text-text-2">{s.closed || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {donutData.length > 0 && (
                  <div className="flex flex-col items-center justify-center">
                    <h3 className="mb-2 self-start text-xs font-semibold text-text-2">Removed leads by source</h3>
                    <DonutChart data={donutData} centerLabel="removed" />
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
