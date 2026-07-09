"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { RunListItem, RunDetail } from "@/modules/run/view-types";
import { AppShell, PartnerTag, EmptyState, Skeleton } from "@/components";

interface ActivityItem { id: string; when: string; actor: string | null; action: string; entityRef: string | null; category: "security" | "data" }

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: "brand" | "danger" | "warn" }) {
  const color = tone === "brand" ? "text-brand" : tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-text";
  return (
    <div className="relative flex flex-col gap-1.5 px-5 py-4 first:pl-1 [&+&]:before:absolute [&+&]:before:left-0 [&+&]:before:top-4 [&+&]:before:bottom-4 [&+&]:before:w-px [&+&]:before:bg-border">
      <span className="text-xs font-medium text-text-2">{label}</span>
      <span className={`font-display text-3xl font-semibold leading-none tracking-tight tabular-nums ${color}`}>{value}</span>
      {sub && <span className="num text-[.66rem] text-text-3">{sub}</span>}
    </div>
  );
}

const panel = "rounded-2xl border border-border-soft bg-surface p-5 shadow-sm";

export default function DashboardPage() {
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => apiGet<{ runs: RunListItem[] }>("/api/runs") });
  const latestRef = React.useMemo(() => {
    const list = runs.data?.runs ?? [];
    return [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]?.refId ?? null;
  }, [runs.data]);
  const detail = useQuery({
    queryKey: ["run", latestRef],
    queryFn: () => apiGet<RunDetail>(`/api/runs/${latestRef}`),
    enabled: !!latestRef,
  });
  const activity = useQuery({ queryKey: ["activity", 1], queryFn: () => apiGet<{ items: ActivityItem[] }>("/api/activity?page=1") });

  const s = detail.data?.summary;
  const dist = detail.data?.distribution ?? [];
  const delivered = dist.reduce((t, d) => t + d.count, 0);
  const maxCount = Math.max(1, ...dist.map((d) => d.count));

  return (
    <AppShell>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-text-2">
            {detail.data ? <>Latest run <span className="num text-text">{detail.data.upload.refId}</span> · {detail.data.upload.rowCount ?? 0} leads processed.</> : "Here's your routing at a glance."}
          </p>
        </div>
        <Link href="/upload" className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_18px_-8px_var(--brand)] transition-all duration-150 hover:-translate-y-0.5 hover:bg-brand-strong hover:shadow-[0_12px_24px_-8px_var(--brand)] active:translate-y-0 active:scale-[.98]">
          <span className="text-base leading-none">+</span> New run
        </Link>
      </div>

      {runs.isPending ? (
        <Skeleton className="h-28" />
      ) : !latestRef ? (
        <div className={panel}><EmptyState title="No runs yet" description="Process your first weekly file to see your routing here." /></div>
      ) : (
        <div className="stagger flex flex-col gap-5">
          {/* KPI band */}
          <div className="grid grid-cols-2 rounded-2xl border border-border-soft bg-surface p-1 shadow-sm sm:grid-cols-5">
            <Stat label="Leads processed" value={s?.total ?? "—"} sub="this week" />
            <Stat label="Delivered" value={delivered || "—"} sub="to partners" tone="brand" />
            <Stat label="Removed · MLS" value={s?.removed ?? "—"} sub="listed" tone="danger" />
            <Stat label="Unmatched" value={s?.unmatched ?? "—"} sub="no coverage" tone="warn" />
            <Stat label="Partners" value={dist.length || "—"} sub="received leads" />
          </div>

          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.5fr_1fr]">
            {/* Routing ledger */}
            <section className={panel}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-[.95rem] font-semibold tracking-tight">Routing ledger</h2>
                <Link href={`/runs/${detail.data?.upload.refId}`} className="text-xs font-medium text-brand">Open run →</Link>
              </div>
              {detail.isPending ? (
                <Skeleton className="h-40" />
              ) : dist.length === 0 ? (
                <p className="py-6 text-center text-sm text-text-3">This run distributed to no partners.</p>
              ) : (
                <>
                  <div className="flex h-7 gap-0.5 overflow-hidden rounded-lg">
                    {dist.map((d) => <span key={d.partnerId} title={`${d.name}: ${d.count}`} style={{ flex: d.count, background: d.color }} />)}
                    {s && s.removed > 0 && <span style={{ flex: s.removed, background: "var(--danger-soft)" }} className="border border-dashed border-danger opacity-70" />}
                  </div>
                  <div className="mb-3 mt-2 flex justify-between px-0.5 text-[.7rem] text-text-3">
                    <span>{delivered} delivered · {dist.length} partners</span>
                    <span>{s?.removed ?? 0} removed · {s?.unmatched ?? 0} unmatched</span>
                  </div>
                  <div className="flex flex-col">
                    {dist.map((d) => (
                      <div key={d.partnerId} className="-mx-2 grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg border-t border-border-soft px-2 py-2.5 transition-colors first:border-t-0 hover:bg-surface-2">
                        <PartnerTag name={d.name} color={d.color} refId={d.refId} size="sm" />
                        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-3"><span className="block h-full rounded-full" style={{ width: `${(d.count / maxCount) * 100}%`, background: d.color }} /></span>
                        <span className="num w-6 text-right text-sm font-medium">{d.count}</span>
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
