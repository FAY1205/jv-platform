"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { AppShell, CoverageMap, CountyCoverageMap, PartnerTag, EmptyState, Skeleton } from "@/components";
import type { StateCoverage, CoveragePartner } from "@/modules/coverage/map";

// MAP-01. Read-only coverage overview: the hex map colors each state by its
// partner; the legend and gap panel make ownership and holes explicit (PRN-14).
interface CoverageResponse {
  states: StateCoverage[];
  coveredCount: number;
  gapCount: number;
  partners: CoveragePartner[];
  zipCoverageCount: number;
  unmatchedLeadCount: number;
}

const panel = "rounded-2xl border border-border-soft bg-surface p-5 shadow-sm";

function StatCard({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: "warn" | "danger" }) {
  const color = tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : "text-text";
  return (
    <div className={panel}>
      <div className="text-xs font-medium text-text-2">{label}</div>
      <div className={`mt-1.5 font-display text-2xl font-semibold leading-none tracking-tight tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-[.68rem] text-text-3">{sub}</div>}
    </div>
  );
}

export default function CoveragePage() {
  const { data, isPending, error } = useQuery({
    queryKey: ["coverage"],
    queryFn: () => apiGet<CoverageResponse>("/api/coverage"),
  });
  const [selected, setSelected] = React.useState<string | null>(null);
  const toggle = (id: string | null) => setSelected((prev) => (prev === id ? null : id));

  const [view, setView] = React.useState<"county" | "state">("county");
  const gaps = (data?.states ?? []).filter((s) => s.gap);

  return (
    <AppShell>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Coverage</h1>
          <p className="mt-1 text-sm text-text-2">Which partner owns each state — and where leads have nowhere to land.</p>
        </div>
        <Link
          href="/partners"
          className="shrink-0 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-semibold text-text-2 shadow-xs transition-colors hover:border-text-3 hover:bg-surface-2"
        >
          Manage partners →
        </Link>
      </div>

      {isPending ? (
        <Skeleton className="h-[460px] rounded-2xl" />
      ) : error ? (
        <div className={panel}>
          <EmptyState title="Couldn't load coverage" description={(error as Error).message} />
        </div>
      ) : (
        <div className="stagger flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="States covered" value={`${data!.coveredCount}/51`} sub="by a state rule" />
            <StatCard label="Coverage gaps" value={data!.gapCount} tone={data!.gapCount > 0 ? "warn" : undefined} sub="leads, no owner" />
            <StatCard label="ZIP overrides" value={data!.zipCoverageCount} sub="beat the state rule" />
            <StatCard label="Unmatched leads" value={data!.unmatchedLeadCount} tone={data!.unmatchedLeadCount > 0 ? "danger" : undefined} sub="no partner matched" />
          </div>

          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_300px]">
            <section className={panel}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="font-display text-[.95rem] font-semibold tracking-tight">
                  {view === "county" ? "County map" : "State tiles"}
                </h2>
                <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5">
                  {(["county", "state"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setView(v)}
                      aria-pressed={view === v}
                      className={
                        "rounded-[7px] px-3 py-1 text-xs font-semibold transition-colors " +
                        (view === v ? "bg-surface text-text shadow-xs" : "text-text-3 hover:text-text-2")
                      }
                    >
                      {v === "county" ? "County" : "Tiles"}
                    </button>
                  ))}
                </div>
              </div>
              {view === "county" ? (
                <CountyCoverageMap states={data!.states} selectedPartnerId={selected} onSelectPartner={toggle} />
              ) : (
                <CoverageMap states={data!.states} selectedPartnerId={selected} onSelectPartner={toggle} />
              )}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[.7rem] text-text-3">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-[3px] border border-border" style={{ background: "var(--surface-3)" }} /> Uncovered
                </span>
                {view === "state" && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-[3px] border border-dashed" style={{ borderColor: "var(--warn)" }} /> Gap — leads, no owner
                  </span>
                )}
                <span className="text-text-3">
                  {view === "county" ? "Counties inherit their state's partner. " : ""}Click to highlight a partner&apos;s territory.
                </span>
              </div>
            </section>

            <aside className={panel}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="font-display text-[.95rem] font-semibold tracking-tight">Partners</h2>
                {selected && (
                  <Link href={`/partners/${selected}`} className="text-xs font-semibold text-brand hover:underline">
                    Open →
                  </Link>
                )}
              </div>
              {data!.partners.length === 0 ? (
                <p className="text-sm text-text-3">No state coverage assigned yet. Add state rules in Rules or ZIP coverage on a partner.</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {data!.partners.map((p) => {
                    const on = selected === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => toggle(p.id)}
                        aria-pressed={on}
                        className={
                          "flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-left transition-colors " +
                          (on ? "bg-brand-soft" : "hover:bg-surface-2")
                        }
                      >
                        <PartnerTag name={p.name} color={p.color} refId={p.refId} size="sm" />
                        <span className="num shrink-0 text-xs text-text-3">
                          {p.stateCount} state{p.stateCount === 1 ? "" : "s"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {gaps.length > 0 && (
                <div className="mt-4 rounded-lg border border-warn-soft p-3" style={{ background: "var(--warn-soft)" }}>
                  <div className="text-xs font-semibold text-warn">Coverage gaps</div>
                  <div className="num mt-1 text-xs text-text-2">{gaps.map((g) => g.code).join(", ")}</div>
                  <p className="mt-1.5 text-[.7rem] text-text-3">
                    Leads came from these states but no partner owns them — add a state rule or ZIP coverage so they route.
                  </p>
                </div>
              )}
            </aside>
          </div>
        </div>
      )}
    </AppShell>
  );
}
