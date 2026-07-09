"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { RunListItem, RunDetail } from "@/modules/run/view-types";
import type { PeriodSummary, Period } from "@/modules/analytics/periods";
import { AppShell, PartnerTag, EmptyState, Skeleton } from "@/components";

// ADM-01: the business pulse. KPIs are time-based (week/month/year/all-time,
// ANA-01) with honest period-over-period deltas ("vs the same point last
// week"); the routing ledger shows the latest import; a needs-attention strip
// surfaces unmatched leads and coverage gaps. All numbers come from the
// analytics/coverage APIs — nothing re-derived here (PRN-15).

interface ActivityItem { id: string; when: string; actor: string | null; action: string; entityRef: string | null; category: "security" | "data" }
interface CoverageSummary { gapCount: number; unmatchedLeadCount: number }

const PERIODS: { key: Period; label: string; vs: string }[] = [
  { key: "week", label: "This week", vs: "vs last wk" },
  { key: "month", label: "This month", vs: "vs last mo" },
  { key: "year", label: "This year", vs: "vs last yr" },
  { key: "all", label: "All time", vs: "" },
];

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function Delta({ delta, vs }: { delta: number | null; vs: string }) {
  if (delta === null) return <span className="num text-[.66rem] text-text-3">all time</span>;
  const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "·";
  return (
    <span className="num text-[.66rem] text-text-3">
      {arrow} {delta === 0 ? "same" : Math.abs(delta)} {vs}
    </span>
  );
}

function Stat({ label, value, delta, vs, tone }: { label: string; value: React.ReactNode; delta: number | null; vs: string; tone?: "brand" | "danger" | "warn" }) {
  const color = tone === "brand" ? "text-brand" : tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-text";
  return (
    <div className="relative flex flex-col gap-1.5 px-5 py-4 first:pl-1 [&+&]:before:absolute [&+&]:before:left-0 [&+&]:before:top-4 [&+&]:before:bottom-4 [&+&]:before:w-px [&+&]:before:bg-border">
      <span className="text-xs font-medium text-text-2">{label}</span>
      <span className={`font-display text-3xl font-semibold leading-none tracking-tight tabular-nums ${color}`}>{value}</span>
      <Delta delta={delta} vs={vs} />
    </div>
  );
}

const panel = "rounded-2xl border border-border-soft bg-surface p-5 shadow-sm";

export default function DashboardPage() {
  const [period, setPeriod] = React.useState<Period>("week");
  const vs = PERIODS.find((p) => p.key === period)!.vs;

  const kpis = useQuery({
    queryKey: ["analytics", "period", period],
    queryFn: () => apiGet<PeriodSummary>(`/api/analytics/period?period=${period}`),
  });
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => apiGet<{ runs: RunListItem[] }>("/api/runs") });
  const latestRef = React.useMemo(() => {
    const list = runs.data?.runs ?? [];
    return [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
  }, [runs.data]);
  const detail = useQuery({
    queryKey: ["run", latestRef?.refId],
    queryFn: () => apiGet<RunDetail>(`/api/runs/${latestRef!.refId}`),
    enabled: !!latestRef,
  });
  const coverage = useQuery({
    queryKey: ["coverage"],
    queryFn: () => apiGet<CoverageSummary>("/api/coverage"),
  });
  const activity = useQuery({ queryKey: ["activity", 1], queryFn: () => apiGet<{ items: ActivityItem[] }>("/api/activity?page=1") });

  const t = kpis.data?.totals;
  const d = kpis.data?.deltas;
  const dist = detail.data?.distribution ?? [];
  const deliveredLatest = dist.reduce((sum, x) => sum + x.count, 0);
  const maxCount = Math.max(1, ...dist.map((x) => x.count));
  const s = detail.data?.summary;

  // Needs-attention: real problems only; hidden entirely when everything is fine.
  const importAgeDays = latestRef ? daysSince(latestRef.createdAt) : null;
  const attention: { text: string; href: string; tone: "warn" | "danger" }[] = [];
  if ((coverage.data?.unmatchedLeadCount ?? 0) > 0)
    attention.push({ text: `${coverage.data!.unmatchedLeadCount} unmatched lead${coverage.data!.unmatchedLeadCount === 1 ? "" : "s"} with no partner`, href: "/coverage", tone: "danger" });
  if ((coverage.data?.gapCount ?? 0) > 0)
    attention.push({ text: `${coverage.data!.gapCount} coverage gap${coverage.data!.gapCount === 1 ? "" : "s"} — leads from unowned states`, href: "/coverage", tone: "warn" });
  if (importAgeDays !== null && importAgeDays >= 8)
    attention.push({ text: `No import in ${importAgeDays} days — the weekly file may be overdue`, href: "/upload", tone: "warn" });

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-text-2">
            {latestRef ? <>Latest import <span className="num text-text">{latestRef.refId}</span> · {latestRef.rowCount ?? 0} leads processed.</> : "Here's your routing at a glance."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPeriod(p.key)}
                aria-pressed={period === p.key}
                className={
                  "rounded-[7px] px-3 py-1.5 text-xs font-semibold transition-colors " +
                  (period === p.key ? "bg-surface text-text shadow-xs" : "text-text-3 hover:text-text-2")
                }
              >
                {p.label}
              </button>
            ))}
          </div>
          <Link href="/upload" className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_18px_-8px_var(--brand)] transition-all duration-150 hover:-translate-y-0.5 hover:bg-brand-strong hover:shadow-[0_12px_24px_-8px_var(--brand)] active:translate-y-0 active:scale-[.98]">
            <span className="text-base leading-none">+</span> New import
          </Link>
        </div>
      </div>

      {runs.isPending || kpis.isPending ? (
        <Skeleton className="h-28" />
      ) : !latestRef ? (
        <div className={panel}><EmptyState title="No imports yet" description="Process your first weekly file to see your routing here." /></div>
      ) : (
        <div className="stagger flex flex-col gap-5">
          {/* Needs attention */}
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

          {/* Period KPI band */}
          <div className="grid grid-cols-2 rounded-2xl border border-border-soft bg-surface p-1 shadow-sm sm:grid-cols-5">
            <Stat label="Leads in" value={t?.total ?? "—"} delta={d?.total ?? null} vs={vs} />
            <Stat label="Delivered" value={t?.delivered ?? "—"} delta={d?.delivered ?? null} vs={vs} tone="brand" />
            <Stat label="Removed · MLS" value={t?.removed ?? "—"} delta={d?.removed ?? null} vs={vs} tone="danger" />
            <Stat label="Unmatched" value={t?.unmatched ?? "—"} delta={d?.unmatched ?? null} vs={vs} tone="warn" />
            <Stat label="Repeat sellers" value={t?.previouslyMatched ?? "—"} delta={null} vs="" />
          </div>

          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.5fr_1fr]">
            {/* Routing ledger — the latest import */}
            <section className={panel}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-[.95rem] font-semibold tracking-tight">Routing ledger · latest import</h2>
                <Link href={`/imports/${latestRef.refId}`} className="text-xs font-medium text-brand">Open import →</Link>
              </div>
              {detail.isPending ? (
                <Skeleton className="h-40" />
              ) : dist.length === 0 ? (
                <p className="py-6 text-center text-sm text-text-3">This import distributed to no partners.</p>
              ) : (
                <>
                  <div className="flex h-7 gap-0.5 overflow-hidden rounded-lg">
                    {dist.map((x) => <span key={x.partnerId} title={`${x.name}: ${x.count}`} style={{ flex: x.count, background: x.color }} />)}
                    {s && s.removed > 0 && <span style={{ flex: s.removed, background: "var(--danger-soft)" }} className="border border-dashed border-danger opacity-70" />}
                  </div>
                  <div className="mb-3 mt-2 flex justify-between px-0.5 text-[.7rem] text-text-3">
                    <span>{deliveredLatest} delivered · {dist.length} partners</span>
                    <span>{s?.removed ?? 0} removed · {s?.unmatched ?? 0} unmatched</span>
                  </div>
                  <div className="flex flex-col">
                    {dist.map((x) => (
                      <div key={x.partnerId} className="-mx-2 grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg border-t border-border-soft px-2 py-2.5 transition-colors first:border-t-0 hover:bg-surface-2">
                        <PartnerTag name={x.name} color={x.color} refId={x.refId} size="sm" />
                        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-3"><span className="block h-full rounded-full" style={{ width: `${(x.count / maxCount) * 100}%`, background: x.color }} /></span>
                        <span className="num w-6 text-right text-sm font-medium">{x.count}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>

            {/* Recent activity */}
            <section className={panel}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-[.95rem] font-semibold tracking-tight">Recent activity</h2>
                <Link href="/activity" className="text-xs font-medium text-brand">All →</Link>
              </div>
              {activity.isPending ? (
                <Skeleton className="h-40" />
              ) : (activity.data?.items ?? []).length === 0 ? (
                <p className="py-6 text-center text-sm text-text-3">Nothing yet.</p>
              ) : (
                <div className="flex flex-col">
                  {(activity.data?.items ?? []).slice(0, 6).map((a) => (
                    <div key={a.id} className="-mx-2 flex items-baseline gap-3 rounded-lg border-t border-border-soft px-2 py-2.5 transition-colors first:border-t-0 hover:bg-surface-2">
                      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${a.category === "security" ? "bg-warn" : "bg-text-3"}`} />
                      <span className="text-[.8rem] text-text-2"><span className="num text-text-2">{a.action}</span>{a.entityRef && <> · <span className="num text-text-3">{a.entityRef}</span></>}</span>
                      <span className="num ml-auto whitespace-nowrap text-[.66rem] text-text-3">{timeAgo(a.when)}</span>
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
