"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { SegmentedControl, Skeleton, EmptyState, Tooltip, PartnerTag } from "@/components";
import type { RangeKey } from "@/modules/analytics/ranges";
import type { PartnerTerritory } from "@/modules/coverage/partner-territory";
import type { PartnerDashboardStats } from "@/modules/portal/queries";

// WP-F.3: the partner-facing dashboard hero — four range-scoped KPIs + the partner's own
// territory on the real county map (others anonymized, PRN-08). Server data via TanStack
// Query only; numbers come from analytics (PRN-15). The ~0.9 MB geometry is code-split so
// the headline + KPIs paint immediately. Tokens only (PRN-12).

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

function Kpi({ label, value, tip }: { label: string; value: number; tip: string }) {
  return (
    <div className="bg-surface px-3 py-3">
      <div className="font-display text-2xl font-semibold leading-none tabular-nums text-text">{value.toLocaleString()}</div>
      <div className={`mt-1 font-medium uppercase tracking-[.05em] text-text-3 ${label13}`}>
        <Tooltip content={tip}>
          <span
            tabIndex={0}
            className="cursor-help rounded underline decoration-dotted underline-offset-2 outline-none focus-visible:ring-1 focus-visible:ring-brand-ink"
          >
            {label}
          </span>
        </Tooltip>
      </div>
    </div>
  );
}

export function PortalDashboard() {
  const [range, setRange] = React.useState<RangeKey>("30d");
  const stats = useQuery({
    queryKey: ["portal-dashboard", range],
    queryFn: () => apiGet<PartnerDashboardStats>(`/api/portal/dashboard?range=${range}`),
    placeholderData: keepPreviousData, // range switches keep prior numbers instead of flashing to blank
  });
  const territory = useQuery({ queryKey: ["portal-territory"], queryFn: () => apiGet<PartnerTerritory>("/api/portal/territory") });

  const s = stats.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        {/* Static page heading — always present so AT has a landmark across load/error (SC 1.3.1/2.4.6). */}
        <h1 className={`font-semibold uppercase tracking-[.08em] text-text-3 ${label13}`}>Your dashboard</h1>
        <SegmentedControl<RangeKey> ariaLabel="Time range" value={range} onValueChange={setRange} options={RANGE_SEGMENTS} />
      </div>

      {/* Headline + KPIs (the stats query) — degrades independently of the territory map. */}
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
                <Kpi label="Leads" value={s.leads} tip="Kept leads routed to you in the selected range." />
                <Kpi label="New" value={s.untouched} tip="Leads you've received but not yet actioned — get to these first." />
                <Kpi label="Contacted" value={s.contacted} tip="Leads you actioned (a status change or note) in the selected range." />
                <Kpi label="Closed" value={s.closed} tip="Leads whose latest status became Closed in the selected range." />
              </>
            )}
          </div>
        </>
      )}

      {/* Territory map — an independent server source; renders regardless of the stats state. */}
      <section className="overflow-hidden rounded-2xl border border-border-soft bg-surface-2 p-3">
        <div className="relative aspect-[960/600] w-full">
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
        </div>
        {/* Partner token below the map (PRN-14) — never over the highlighted territory. */}
        {territory.data && territory.data.partner.name && (
          <div className={`mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-3 text-text-3 ${label13}`}>
            <PartnerTag size="sm" name={territory.data.partner.name} color={territory.data.partner.color} refId={territory.data.partner.refId} />
            <span>· your territory · {territory.data.ownStateCount} state{territory.data.ownStateCount === 1 ? "" : "s"}</span>
          </div>
        )}
      </section>
    </div>
  );
}
