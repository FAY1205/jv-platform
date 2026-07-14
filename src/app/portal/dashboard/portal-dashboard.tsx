"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { SegmentedControl, Skeleton, EmptyState, PartnerTag, Table, THead, TBody, Th, Tr, Td, HeroKpi } from "@/components";
import { statusPillClass } from "@/lib/status-pill";
import { useIsDesktop } from "@/lib/use-media-query";
import type { RangeKey } from "@/modules/analytics/ranges";
import type { PartnerTerritory } from "@/modules/coverage/partner-territory";
import type { PartnerDashboardStats } from "@/modules/portal/queries";

// WP-F.3: the partner-facing dashboard hero — four range-scoped KPIs + the partner's own
// territory on the real county map (others anonymized, PRN-08). Server data via TanStack
// Query only; numbers come from analytics (PRN-15). The ~0.9 MB geometry is code-split so
// the headline + KPIs paint immediately. Tokens only (PRN-12).
// WP-PW-2 Task 2: desktop (>= lg) gets a two-column hero (mirrors the admin dashboard hero,
// shared HeroKpi) + a recent-leads preview table; mobile (< lg) keeps the original stacked
// layout unchanged (only the KPI tile swapped from a local Kpi to the shared HeroKpi).
// WP-PW-2 final fix: (1) `useIsDesktop()` gates `mapPanel` so CountyCoverageMap mounts in
// exactly ONE of the two sections below instead of both (only CSS `display` toggled
// before); (2) the desktop hero <section> now renders unconditionally — only its left
// (KPI) cell reflects stats.error — so a stats-only failure no longer hides the
// independent territory map on desktop; (3) mobile HeroKpi tiles pass `dense` to stay
// pixel-exact (px-3) to the pre-shared-component layout.

const CountyCoverageMap = dynamic(() => import("@/components/CountyCoverageMap").then((m) => m.CountyCoverageMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full min-h-[220px] w-full rounded-lg" />,
});

const RANGE_SEGMENTS: { value: RangeKey; label: string }[] = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "12mo", label: "12mo" },
  { value: "all", label: "All" },
];
const label13 = "text-step-1"; // 13px chrome floor (no sub-13px)

interface RecentLead {
  refId: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  receivedAt: string;
  status: string;
}
interface PortalLeadsPage {
  leads: RecentLead[];
  page: number;
  pageSize: number;
  total: number;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

export function PortalDashboard() {
  const [range, setRange] = React.useState<RangeKey>("30d");
  const stats = useQuery({
    queryKey: ["portal-dashboard", range],
    queryFn: () => apiGet<PartnerDashboardStats>(`/api/portal/dashboard?range=${range}`),
    placeholderData: keepPreviousData, // range switches keep prior numbers instead of flashing to blank
  });
  const territory = useQuery({ queryKey: ["portal-territory"], queryFn: () => apiGet<PartnerTerritory>("/api/portal/territory") });
  // Recent-leads preview (desktop only) — same endpoint/query-key as the full Leads page
  // (page 1), sliced to 5 here so navigating to /portal/leads reuses the cached page.
  const recentLeads = useQuery({
    queryKey: ["portal-leads", 1],
    queryFn: () => apiGet<PortalLeadsPage>("/api/portal/leads?page=1"),
  });
  // WP-PW-2 final fix: which breakpoint is active, so the heavy CountyCoverageMap mounts
  // in exactly ONE of the two DOM locations below instead of both (only `display` was
  // toggling before). Called unconditionally alongside the other hooks, above any return.
  const isDesktop = useIsDesktop();

  const s = stats.data;
  const recent = (recentLeads.data?.leads ?? []).slice(0, 5);

  const mapPanel = (
    <>
      {territory.data ? (
        <CountyCoverageMap
          states={territory.data.states}
          neutralUncovered
          interactive={false}
          ariaLabel="County map highlighting your covered states"
        />
      ) : territory.isError ? (
        <EmptyState compact title="Territory map unavailable." />
      ) : (
        <Skeleton className="h-full w-full rounded-lg" />
      )}
    </>
  );
  // Partner token below the map (PRN-14) — never over the highlighted territory.
  const partnerTag = territory.data && territory.data.partner.name && (
    <div className={`mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-3 text-text-3 ${label13}`}>
      <PartnerTag size="sm" name={territory.data.partner.name} color={territory.data.partner.color} refId={territory.data.partner.refId} />
      <span>· your territory · {territory.data.ownStateCount} state{territory.data.ownStateCount === 1 ? "" : "s"}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      <div className="flex items-center justify-between gap-2">
        {/* Static page heading — always present so AT has a landmark across load/error (SC 1.3.1/2.4.6). */}
        <h1 className={`font-semibold uppercase tracking-[.08em] text-text-3 md:hidden ${label13}`}>Your dashboard</h1>
        <SegmentedControl<RangeKey> ariaLabel="Time range" value={range} onValueChange={setRange} options={RANGE_SEGMENTS} />
      </div>

      {/* MOBILE (< lg): today's stacked layout, unchanged except HeroKpi replacing the
          local Kpi tile (identical rendered content — label + value + tooltip). A stats
          error is scoped to this KPI area only — it no longer hides the independent
          territory map below (WP-PW-2 final fix 2). */}
      <div className="flex flex-col gap-4 lg:hidden">
        {stats.error ? (
          <EmptyState title="Couldn't load your dashboard" description={(stats.error as Error).message} />
        ) : (
          <>
            <p className="font-display text-2xl font-semibold leading-tight tracking-tight text-balance text-text">
              {!s ? (
                <Skeleton className="h-8 w-3/4" />
              ) : s.leads === 0 ? (
                "No leads in your territory yet."
              ) : (
                <>
                  <span className="num">{s.leads.toLocaleString()}</span> lead{s.leads === 1 ? "" : "s"}
                  {territory.data ? (
                    <>
                      {" "}
                      across your <span className="num">{territory.data.ownStateCount}</span>-state territory
                    </>
                  ) : null}
                  .
                </>
              )}
            </p>

            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border">
              {!s ? (
                [0, 1, 2, 3].map((i) => (
                  <div key={i} className="bg-surface px-3 py-3">
                    <Skeleton className="h-7 w-12" />
                    <Skeleton className="mt-2 h-3 w-16" />
                  </div>
                ))
              ) : (
                <>
                  <HeroKpi dense label="Leads" value={s.leads} tip="Kept leads routed to you in the selected range." />
                  <HeroKpi dense label="New" value={s.untouched} tip="Leads you've received but not yet actioned — get to these first." />
                  <HeroKpi dense label="Contacted" value={s.contacted} tip="Leads you actioned (a status change or note) in the selected range." />
                  <HeroKpi dense label="Closed" value={s.closed} tip="Leads whose latest status became Closed in the selected range." />
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* DESKTOP (>= lg): two-column hero mirroring the admin dashboard (shared HeroKpi
          + real choropleth) — headline/KPIs on the left, map on the right. Renders
          UNCONDITIONALLY (WP-PW-2 final fix 2): a stats-only failure must not hide the
          independent ["portal-territory"] map, so only the left (KPI) cell reflects
          stats.error. The map itself is gated to isDesktop so CountyCoverageMap mounts
          here and NOT in the mobile map section below (final fix 1). */}
      <section className="hidden overflow-hidden rounded-2xl border border-border-soft bg-surface shadow-sm lg:grid lg:grid-cols-[1fr_1.2fr]">
        <div className="flex flex-col p-6 lg:p-7">
          {stats.error ? (
            <EmptyState title="Couldn't load your dashboard" description={(stats.error as Error).message} />
          ) : (
            <>
              <p className="font-display text-step-7 font-semibold leading-[1.12] tracking-tight text-balance text-text">
                {!s ? (
                  <Skeleton className="h-8 w-3/4" />
                ) : s.leads === 0 ? (
                  "No leads in your territory yet."
                ) : (
                  <>
                    <span className="num">{s.leads.toLocaleString()}</span> lead{s.leads === 1 ? "" : "s"}
                    {territory.data ? (
                      <>
                        {" "}
                        across your <span className="num">{territory.data.ownStateCount}</span>-state territory
                      </>
                    ) : null}
                    .
                  </>
                )}
              </p>

              <div className="mt-auto pt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border">
                {!s ? (
                  [0, 1, 2, 3].map((i) => (
                    <div key={i} className="bg-surface px-4 py-3">
                      <Skeleton className="h-7 w-12" />
                      <Skeleton className="mt-2 h-3 w-16" />
                    </div>
                  ))
                ) : (
                  <>
                    <HeroKpi label="Leads" value={s.leads} tip="Kept leads routed to you in the selected range." />
                    <HeroKpi label="New" value={s.untouched} tip="Leads you've received but not yet actioned — get to these first." />
                    <HeroKpi label="Contacted" value={s.contacted} tip="Leads you actioned (a status change or note) in the selected range." />
                    <HeroKpi label="Closed" value={s.closed} tip="Leads whose latest status became Closed in the selected range." />
                  </>
                )}
              </div>
            </>
          )}
        </div>
        <div className="relative flex min-h-[280px] flex-col border-l border-border bg-surface-2 p-4">
          <div className="relative min-h-[220px] flex-1">{isDesktop ? mapPanel : null}</div>
          {partnerTag}
        </div>
      </section>

      {/* MOBILE-only territory map (< lg) — an independent server source; renders
          regardless of the stats state. CountyCoverageMap itself is gated to !isDesktop
          so it mounts here (and not in the desktop hero above) — single-instance map
          (WP-PW-2 final fix 1). */}
      <section className="overflow-hidden rounded-2xl border border-border-soft bg-surface-2 p-3 lg:hidden">
        <div className="relative aspect-[960/600] w-full">{!isDesktop ? mapPanel : null}</div>
        {partnerTag}
      </section>

      {/* Recent leads preview (>= lg only) — top 5 from the same endpoint the full Leads
          page paginates over (PRN-08 scoped route, no new PII surfaced). */}
      <section className="hidden overflow-hidden rounded-2xl border border-border-soft bg-surface shadow-sm lg:block">
        <div className="flex items-center justify-between gap-2 border-b border-border-soft px-5 py-4">
          <h2 className="font-display text-step-3 font-semibold tracking-tight">Recent leads</h2>
          <Link href="/portal/leads" className={`font-semibold text-brand-ink hover:underline ${label13}`}>
            View all leads →
          </Link>
        </div>
        {recentLeads.error ? (
          <EmptyState compact title="Couldn't load your leads." className="py-8" />
        ) : !recentLeads.data ? (
          <div className="p-5">
            <Skeleton className="h-32 w-full rounded-lg" />
          </div>
        ) : recent.length === 0 ? (
          <EmptyState compact title="No leads yet." description="Leads assigned to you will appear here after the next upload." className="py-8" />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Ref</Th>
                <Th>Address</Th>
                <Th>City</Th>
                <Th>ST</Th>
                <Th>Received</Th>
                <Th>Status</Th>
              </Tr>
            </THead>
            <TBody>
              {recent.map((l) => (
                <Tr key={l.refId} className="hover:bg-surface-2">
                  <Td className="num text-text-3">{l.refId}</Td>
                  <Td className="font-medium text-text">{l.address}</Td>
                  <Td className="text-text-2">{l.city}</Td>
                  <Td className="num text-text-2">{l.state}</Td>
                  <Td className="num text-text-3">{fmtDate(l.receivedAt)}</Td>
                  <Td><span className={statusPillClass(l.status)}>{l.status}</span></Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </div>
  );
}
