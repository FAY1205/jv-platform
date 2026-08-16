"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { AppShell, CountyCoverageMap, PartnerTag, QueryErrorState, Skeleton, usePageHeader } from "@/components";
import { UncoveredKey } from "@/components/map";
import type { StateCoverage, CoveragePartner, CountyCoverage } from "@/modules/coverage/map";

// MAP-01. Read-only coverage overview: the county map colors each state by its
// partner (WP-E: counties a partner covers by ZIP color at county level); the legend
// and gap panel make ownership and holes explicit (PRN-14).
interface CoverageResponse {
  states: StateCoverage[];
  counties: CountyCoverage[];
  coveredCount: number;
  gapCount: number;
  partners: CoveragePartner[];
  zipCoverageCount: number;
  unmatchedLeadCount: number;
  coveredVolumePct: number;
  keptLeadCount: number;
}

const panel = "rounded-2xl border border-border-soft bg-surface p-5 shadow-sm";

function StatCard({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: "warn" | "danger" }) {
  const color = tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : "text-text";
  return (
    <div className={panel}>
      <div className="text-step-1 font-medium text-text-2">{label}</div>
      <div className={`mt-1.5 font-display text-2xl font-semibold leading-none tracking-tight tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-step-1 text-text-3">{sub}</div>}
    </div>
  );
}

export default function CoveragePage() {
  return (
    <AppShell>
      <CoverageBody />
    </AppShell>
  );
}

function CoverageBody() {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["coverage"],
    queryFn: () => apiGet<CoverageResponse>("/api/coverage"),
  });
  const [selected, setSelected] = React.useState<string | null>(null);
  const toggle = (id: string | null) => setSelected((prev) => (prev === id ? null : id));

  // Topbar carries the title only — the "Manage partners" action was dropped
  // (owner testing note #8, 2026-07-15); Partners is one click away in the nav.
  usePageHeader({ title: "Coverage" });

  return (
    <>
      {isPending ? (
        <Skeleton className="h-[460px] rounded-2xl" />
      ) : error ? (
        <div className={panel}>
          <QueryErrorState title="Couldn't load coverage" error={error} onRetry={() => refetch()} />
        </div>
      ) : (
        <div className="stagger flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="States covered" value={`${data!.coveredCount}/51`} sub="by a state rule" />
            <StatCard label="ZIP overrides" value={data!.zipCoverageCount} sub="beat the state rule" />
            <StatCard label="Partners with territory" value={data!.partners.length} sub="own states or ZIPs" />
          </div>

          {/* WP-UX-1: the aside was a fixed 300px track — 6 of 14 partner names truncated
              (audit). minmax lets wide viewports feed the identity column first; the map
              still takes the lion's share. */}
          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[2fr_minmax(340px,1fr)]">
            <section className={panel}>
              <h2 className="mb-4 font-display text-step-3 font-semibold tracking-tight">County map</h2>
              <CountyCoverageMap
                states={data!.states}
                counties={data!.counties}
                selectedPartnerId={selected}
                onSelectPartner={toggle}
                caption={{ title: "US coverage", subtitle: `${data!.coveredCount}/51 states · ${data!.zipCoverageCount} ZIP overrides` }}
              />
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-step-1 text-text-3">
                {/* WP-UX-4: the shared UncoveredKey — exact hatch parity with the map (PRN-14),
                    one recipe with the dashboard's legend. */}
                <UncoveredKey />
                <span className="text-text-3">Counties a partner covers by ZIP show at county level; the rest follow their state&apos;s partner · scroll or use +/− to zoom, drag to pan · click to highlight a partner. Prefer the keyboard? Use the Partners list to highlight and open each territory.</span>
              </div>
            </section>

            <aside className={panel}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="font-display text-step-3 font-semibold tracking-tight">Partners</h2>
                {selected && (
                  <Link href={`/partners/${selected}`} className="text-step-1 font-semibold text-brand-ink hover:underline">
                    Open →
                  </Link>
                )}
              </div>
              {data!.partners.length === 0 ? (
                <p className="text-sm text-text-3">No state coverage assigned yet. Add state rules in Rules or ZIP coverage on a partner.</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {/* Aligned columns (owner note #8): name truncates, the reference ID sits
                      muted in its own column (PRN-14 — swatch + name + ID all present),
                      the state count right-aligns. No more overflowing single-line rows. */}
                  {data!.partners.map((p) => {
                    const on = selected === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => toggle(p.id)}
                        aria-pressed={on}
                        className={
                          "grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2.5 rounded-lg px-2 py-2 text-left transition-colors " +
                          (on ? "bg-brand-soft" : "hover:bg-surface-2")
                        }
                      >
                        {/* title = the full name for the rows that still truncate (WP-UX-1);
                            PartnerTag now ellipsizes its own name span. */}
                        <span className="min-w-0 truncate" title={p.name}>
                          <PartnerTag name={p.name} color={p.color} size="sm" />
                        </span>
                        <span className="num text-step-0 text-text-3" aria-label={`Reference ${p.refId}`}>
                          {p.refId}
                        </span>
                        <span className="num min-w-16 text-right text-step-1 tabular-nums text-text-3">
                          {p.stateCount} state{p.stateCount === 1 ? "" : "s"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </aside>
          </div>
        </div>
      )}
    </>
  );
}
