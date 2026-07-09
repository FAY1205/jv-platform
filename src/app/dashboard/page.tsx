"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { PeriodSummary, Period, WeekBucket } from "@/modules/analytics/periods";
import { AppShell, PartnerTag, EmptyState, Skeleton } from "@/components";

// ADM-01: the business pulse — one screen (ANA-01). Period-scoped KPIs + trend up
// top; event-scoped partner and lead-source performance below (a close/contact
// lands in the period it happened). Everything from /api/dashboard (PRN-15).
interface PartnerPerf {
  partnerId: string; name: string; refId: string; color: string;
  given: number; untouched: number; contacted: number; closed: number; avgTimeToContactHours: number | null;
}
interface SourcePerf { campaign: string; imported: number; removed: number; closed: number; removalRate: number }
interface DashboardData {
  summary: PeriodSummary;
  weekly: WeekBucket[];
  partners: PartnerPerf[];
  sources: SourcePerf[];
  coveredVolumePct: number;
  keptLeadCount: number;
}
interface CoverageSummary { gapCount: number; unmatchedLeadCount: number }

const PERIODS: { key: Period; label: string; vs: string }[] = [
  { key: "week", label: "This week", vs: "vs last wk" },
  { key: "month", label: "This month", vs: "vs last mo" },
  { key: "year", label: "This year", vs: "vs last yr" },
  { key: "all", label: "All time", vs: "" },
];

const panel = "rounded-2xl border border-border-soft bg-surface p-5 shadow-sm";
const pct = (n: number) => `${Math.round(n * 100)}%`;

function Delta({ delta, vs }: { delta: number | null; vs: string }) {
  if (delta === null) return <span className="num text-[.66rem] text-text-3">all time</span>;
  const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "·";
  return <span className="num text-[.66rem] text-text-3">{arrow} {delta === 0 ? "same" : Math.abs(delta)} {vs}</span>;
}

function Stat({ label, value, delta, vs, tone }: { label: string; value: React.ReactNode; delta?: number | null; vs?: string; tone?: "brand" | "danger" | "warn" }) {
  const color = tone === "brand" ? "text-brand" : tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-text";
  return (
    <div className="relative flex flex-col gap-1.5 px-5 py-4 first:pl-1 [&+&]:before:absolute [&+&]:before:left-0 [&+&]:before:top-4 [&+&]:before:bottom-4 [&+&]:before:w-px [&+&]:before:bg-border">
      <span className="text-xs font-medium text-text-2">{label}</span>
      <span className={`font-display text-3xl font-semibold leading-none tracking-tight tabular-nums ${color}`}>{value}</span>
      {delta !== undefined ? <Delta delta={delta} vs={vs ?? ""} /> : <span className="num text-[.66rem] text-text-3">of kept leads</span>}
    </div>
  );
}

function TrendChart({ weekly }: { weekly: WeekBucket[] }) {
  if (weekly.length === 0) return <p className="py-8 text-center text-sm text-text-3">No processed imports yet.</p>;
  const max = Math.max(1, ...weekly.map((w) => w.total));
  const label = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <div className="flex h-40 items-end gap-3">
      {weekly.map((w) => (
        <div key={w.weekStart} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2">
          {w.total === 0 ? (
            <div className="w-full max-w-[52px] rounded-md border border-dashed border-border" style={{ height: 3 }} title={`Week of ${label(w.weekStart)}: no leads`} />
          ) : (
            <div className="flex w-full max-w-[52px] flex-col-reverse overflow-hidden rounded-md" style={{ height: `${(w.total / max) * 100}%` }} title={`Week of ${label(w.weekStart)}: ${w.delivered} delivered, ${w.unmatched} unmatched, ${w.removed} removed`}>
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

export default function DashboardPage() {
  const [period, setPeriod] = React.useState<Period>("week");
  const vs = PERIODS.find((p) => p.key === period)!.vs;
  const periodLabel = PERIODS.find((p) => p.key === period)!.label.toLowerCase();

  const dash = useQuery({ queryKey: ["dashboard", period], queryFn: () => apiGet<DashboardData>(`/api/dashboard?period=${period}`) });
  const coverage = useQuery({ queryKey: ["coverage"], queryFn: () => apiGet<CoverageSummary>("/api/coverage") });

  const d = dash.data;
  const t = d?.summary.totals;
  const deltas = d?.summary.deltas;
  const maxGiven = Math.max(1, ...(d?.partners ?? []).map((p) => p.given));

  const attention: { text: string; href: string; tone: "warn" | "danger" }[] = [];
  if ((coverage.data?.unmatchedLeadCount ?? 0) > 0) attention.push({ text: `${coverage.data!.unmatchedLeadCount} unmatched lead${coverage.data!.unmatchedLeadCount === 1 ? "" : "s"} need a partner`, href: "/unmatched", tone: "danger" });
  if ((coverage.data?.gapCount ?? 0) > 0) attention.push({ text: `${coverage.data!.gapCount} coverage gap${coverage.data!.gapCount === 1 ? "" : "s"} — leads from unowned states`, href: "/coverage", tone: "warn" });

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-text-2">Your business at a glance — {periodLabel}.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5">
            {PERIODS.map((p) => (
              <button key={p.key} type="button" onClick={() => setPeriod(p.key)} aria-pressed={period === p.key}
                className={"rounded-[7px] px-3 py-1.5 text-xs font-semibold transition-colors " + (period === p.key ? "bg-surface text-text shadow-xs" : "text-text-3 hover:text-text-2")}>
                {p.label}
              </button>
            ))}
          </div>
          <Link href="/upload" className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_18px_-8px_var(--brand)] transition-all duration-150 hover:-translate-y-0.5 hover:bg-brand-strong active:translate-y-0 active:scale-[.98]">
            <span className="text-base leading-none">+</span> New import
          </Link>
        </div>
      </div>

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

          {/* KPI band */}
          <div className="grid grid-cols-2 rounded-2xl border border-border-soft bg-surface p-1 shadow-sm sm:grid-cols-5">
            <Stat label="Leads in" value={t?.total ?? "—"} delta={deltas?.total ?? null} vs={vs} />
            <Stat label="Delivered" value={t?.delivered ?? "—"} delta={deltas?.delivered ?? null} vs={vs} tone="brand" />
            <Stat label="Removed · MLS" value={t?.removed ?? "—"} delta={deltas?.removed ?? null} vs={vs} tone="danger" />
            <Stat label="Unmatched" value={t?.unmatched ?? "—"} delta={deltas?.unmatched ?? null} vs={vs} tone="warn" />
            <Stat label="Volume covered" value={d && d.keptLeadCount > 0 ? pct(d.coveredVolumePct) : "—"} />
          </div>

          {/* Trend — trailing window so a multi-year history stays readable */}
          <section className={panel}>
            <h2 className="mb-4 font-display text-[.95rem] font-semibold tracking-tight">Leads per week <span className="text-[.7rem] font-normal text-text-3">· last {Math.min(16, d!.weekly.length)} weeks</span></h2>
            <TrendChart weekly={d!.weekly.slice(-16)} />
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[.7rem] text-text-3">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "var(--brand)" }} /> Delivered</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "var(--warn)" }} /> Unmatched</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] border border-dashed border-danger" style={{ background: "var(--danger-soft)" }} /> Removed</span>
            </div>
          </section>

          {/* Partner performance */}
          <section className={panel}>
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="font-display text-[.95rem] font-semibold tracking-tight">Partner performance</h2>
              <span className="text-[.7rem] text-text-3">{periodLabel} · counts by when each event happened</span>
            </div>
            {d!.partners.length === 0 ? (
              <p className="py-4 text-sm text-text-3">No leads delivered {periodLabel}.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[.65rem] font-semibold uppercase tracking-wider text-text-3">
                      <th className="py-2 pr-3 font-semibold">Partner</th>
                      <th className="px-2 py-2 text-right font-semibold">Given</th>
                      <th className="px-2 py-2 text-right font-semibold">Untouched</th>
                      <th className="px-2 py-2 text-right font-semibold">Contacted</th>
                      <th className="px-2 py-2 text-right font-semibold">Avg contact</th>
                      <th className="px-2 py-2 text-right font-semibold">Closed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d!.partners.map((p) => (
                      <tr key={p.partnerId} className="border-b border-border-soft transition-colors last:border-0 hover:bg-surface-2">
                        <td className="py-2.5 pr-3">
                          <Link href={`/partners/${p.partnerId}`} className="transition-opacity hover:opacity-70"><PartnerTag size="sm" name={p.name} color={p.color} refId={p.refId} /></Link>
                        </td>
                        <td className="px-2 py-2.5 text-right">
                          <span className="inline-flex items-center justify-end gap-2">
                            <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-surface-3 sm:block"><span className="block h-full rounded-full" style={{ width: `${(p.given / maxGiven) * 100}%`, background: p.color }} /></span>
                            <span className="num w-5 font-medium">{p.given}</span>
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-right"><span className={`num ${p.untouched > 0 ? "font-semibold text-warn" : "text-text-3"}`}>{p.untouched || "—"}</span></td>
                        <td className="px-2 py-2.5 text-right"><span className="num text-text-2">{p.contacted || "—"}</span></td>
                        <td className="px-2 py-2.5 text-right"><span className="num text-text-2">{p.avgTimeToContactHours === null ? "—" : `${p.avgTimeToContactHours}h`}</span></td>
                        <td className="px-2 py-2.5 text-right"><span className={`num ${p.closed > 0 ? "font-semibold text-brand" : "text-text-3"}`}>{p.closed || "—"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Lead source performance */}
          <section className={panel}>
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="font-display text-[.95rem] font-semibold tracking-tight">Lead source performance</h2>
              <span className="text-[.7rem] text-text-3">removal rate = share discarded as MLS-listed</span>
            </div>
            {d!.sources.length === 0 ? (
              <p className="py-4 text-sm text-text-3">No leads imported {periodLabel}.</p>
            ) : (
              <div className="mt-3 flex flex-col gap-2.5">
                {d!.sources.map((s) => {
                  const bad = s.removalRate >= 0.5, warn = s.removalRate >= 0.3;
                  return (
                    <div key={s.campaign} className="grid grid-cols-[minmax(0,1.3fr)_1fr_auto] items-center gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-text" title={s.campaign}>{s.campaign}</div>
                        <div className="num text-[.68rem] text-text-3">{s.imported} in · {s.removed} removed · {s.closed} closed</div>
                      </div>
                      <span className="h-2 overflow-hidden rounded-full bg-surface-3" title={`${Math.round(s.removalRate * 100)}% removed`}>
                        <span className="block h-full rounded-full" style={{ width: `${Math.max(2, s.removalRate * 100)}%`, background: bad ? "var(--danger)" : warn ? "var(--warn)" : "var(--brand)" }} />
                      </span>
                      <span className={`num w-12 text-right text-sm font-semibold ${bad ? "text-danger" : warn ? "text-warn" : "text-text-2"}`}>{pct(s.removalRate)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
