"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { fmtBucket } from "@/lib/dates";
import {
  AppShell,
  PartnerTag,
  EmptyState,
  QueryErrorState,
  Skeleton,
  SegmentedControl,
  LineChart,
  DonutChart,
  Tooltip,
  Table,
  THead,
  TBody,
  Th,
  Tr,
  Td,
  usePageHeader,
  HeroKpi,
} from "@/components";
import { UncoveredKey } from "@/components/map";
import { formatContactTime, AVG_CONTACT_DEFINITION, type RangeKey } from "@/modules/analytics/ranges";
import { matchRate, formatMatchRatePct, MATCH_RATE_DEFINITION } from "@/modules/analytics/match-rate";
import { useIsDesktop } from "@/lib/use-media-query";
import type { DashboardData } from "@/modules/analytics/queries";
import type { CoverageMapResponse } from "@/modules/coverage/map";

// The signature coverage choropleth carries ~0.9 MB of county geometry — code-split
// + client-only so the headline and KPIs paint immediately and the map streams in
// after mount (it renders its own skeleton while the geometry loads).
const CountyCoverageMap = dynamic(() => import("@/components/CountyCoverageMap").then((m) => m.CountyCoverageMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full min-h-[248px] flex-1" />,
});

// ADM-01: the business pulse on one screen (ANA-01). A thesis HERO — a one-sentence
// headline, an honest match-rate line, three KPIs, and the live coverage map — tops
// the page; the trend, removed-by-source donut, and partner/source tables sit below.
// Every number is aggregated in SQL bounded by the selected range (F-10) and computed
// in src/modules/analytics only (PRN-15); the page just formats. All color/type is
// token-driven (PRN-12).

const RANGES: { value: RangeKey; label: string; short: string }[] = [
  // WP-UX-8: one time-range vocabulary across both apps — the compact form the portal
  // already uses (fits mobile; the full "Last 30 days" label still leads the hero).
  { value: "7d", label: "Last 7 days", short: "7d" },
  { value: "30d", label: "Last 30 days", short: "30d" },
  { value: "12mo", label: "Last 12 months", short: "12mo" },
  { value: "all", label: "All time", short: "All" },
];
const RANGE_SEGMENTS: { value: RangeKey; label: string }[] = RANGES.map((r) => ({ value: r.value, label: r.short }));

const panel = "rounded-2xl border border-border-soft bg-surface p-5 shadow-sm";
const label13 = "text-step-1"; // ≥13px chrome text (no sub-13px — WP-A/C rule)
const pct = (n: number) => `${Math.round(n * 100)}%`;

// Donut palette from tokens (PRN-12); cycled per source. Names always accompany color in the
// legend + tooltip (PRN-14). WP-UX-4/WP-UX-8: this is CATEGORICAL data, so it must not wear
// two near-identical ambers — in DARK, --brand and --warn are the same amber and the two
// biggest slices merge. --info (steel blue) is the one status hue the ring doesn't otherwise
// use and is distinct from brand-amber / success-green / danger-red / grey in BOTH themes.
// (--warn itself is untouched — warn pills/toasts keep their AA-checked pairs.)
const SOURCE_COLORS = ["var(--brand)", "var(--success)", "var(--info)", "var(--danger)", "var(--text-3)"];

// A dotted underline is the whole affordance (no ⓘ glyph) — subtler, and it matches
// the match-rate figure. tabIndex=0 keeps the tooltip keyboard-reachable (Tooltip
// opens on focus; a bare span is never focusable). Still satisfies ANA-03/UXQ-05.
function HeaderTip({ label, tip }: { label: string; tip: string }) {
  return (
    <Tooltip content={tip}>
      <span
        tabIndex={0}
        className="cursor-help rounded underline decoration-dotted underline-offset-2 outline-none focus-visible:ring-1 focus-visible:ring-brand-ink"
      >
        {label}
      </span>
    </Tooltip>
  );
}

// Hero copy. All figures come from the range-scoped dashboard analytics (PRN-15):
// distributed/leadsIn from dashboardData().stats, and `activePartners` = stats.partners
// (distinct partners that received a lead in the range) — so the "across N partners"
// clause stays consistent with the range's `distributed` count rather than the static,
// all-time coverage legend.
function HeroHeadline({ distributed, leadsIn, activePartners }: { distributed: number; leadsIn: number; activePartners: number }) {
  if (leadsIn === 0) return <>No leads to route yet.</>;
  const across =
    activePartners > 0 ? (
      <> across <em className="not-italic text-brand-ink">{activePartners} partner{activePartners === 1 ? "" : "s"}</em></>
    ) : null;
  return (
    <>
      <span className="num">{distributed.toLocaleString()}</span> lead{distributed === 1 ? "" : "s"} distributed{across}.
    </>
  );
}

function HeroSubtitle({ distributed, unmatched, leadsIn }: { distributed: number; unmatched: number; leadsIn: number }) {
  if (leadsIn === 0) return <>Import a source and every lead lands with the partner who covers its ground.</>;
  const rate = matchRate(distributed, unmatched);
  if (rate === null) return <>No kept leads in this range yet — every lead was filtered.</>;
  return (
    <>
      <Tooltip content={MATCH_RATE_DEFINITION}>
        <span
          tabIndex={0}
          className="num cursor-help rounded font-semibold text-text underline decoration-dotted underline-offset-2 outline-none focus-visible:ring-1 focus-visible:ring-brand-ink"
        >
          {formatMatchRatePct(rate)}
        </span>
      </Tooltip>{" "}
      of kept leads matched to a covering partner.
    </>
  );
}

export default function DashboardPage() {
  return (
    <AppShell>
      <DashboardBody />
    </AppShell>
  );
}

function DashboardBody() {
  const [range, setRange] = React.useState<RangeKey>("30d");
  const isDesktop = useIsDesktop(); // VP-2: gate the hero map's interactivity to desktop
  // Perf: switching the 7d/30d/12mo/All range keeps the prior KPIs/charts on screen while the new
  // window loads, instead of flashing the whole hero+KPI+chart+table stack to skeletons.
  const dash = useQuery({ queryKey: ["dashboard", range], queryFn: () => apiGet<DashboardData>(`/api/dashboard?range=${range}`), placeholderData: keepPreviousData });
  const coverage = useQuery({ queryKey: ["coverage"], queryFn: () => apiGet<CoverageMapResponse>("/api/coverage") });

  // Topbar carries the title only. The range control moved in-body (owner testing
  // note #1, 2026-07-14: filters don't belong in the top row next to the page title);
  // it renders below, OUTSIDE the pending/error branches, so it stays visible and
  // usable while a range switch is loading.
  usePageHeader({ title: "Dashboard" });

  const d = dash.data;
  const current = RANGES.find((r) => r.value === range)!;
  const rangeLabel = current.label.toLowerCase();

  // Honest attention banner (F-21): an errored coverage query renders an explicit
  // error item — never a masked "all clear".
  const attention: { text: string; href: string; tone: "warn" | "danger" }[] = [];
  if (coverage.data) {
    if (coverage.data.unmatchedLeadCount > 0)
      attention.push({ text: `${coverage.data.unmatchedLeadCount} unmatched lead${coverage.data.unmatchedLeadCount === 1 ? "" : "s"} need a partner`, href: "/unmatched", tone: "danger" });
    if (coverage.data.gapCount > 0)
      attention.push({ text: `${coverage.data.gapCount} coverage gap${coverage.data.gapCount === 1 ? "" : "s"} — leads from unowned states`, href: "/coverage", tone: "warn" });
  }

  const donutData = (d?.sources ?? [])
    .filter((s) => s.removed > 0)
    .map((s, i) => ({ name: s.campaign, value: s.removed, color: SOURCE_COLORS[i % SOURCE_COLORS.length] }));


  return (
    <>
      {/* Top row: attention pills (left) + range control (right) on ONE line (owner
          note, 2026-07-15). Both derive from queries independent of `dash`, so the row
          renders outside the pending/error branches — alerts and the range control stay
          visible while a range switch loads. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {coverage.isError && (
            <div className={`inline-flex items-center gap-2 rounded-full border border-danger-soft px-3 py-1.5 text-danger ${label13}`}>
              <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />
              <span className="font-medium">Couldn&apos;t check for attention items.</span>
              <button type="button" onClick={() => coverage.refetch()} className="font-semibold underline underline-offset-2 hover:no-underline">Retry</button>
            </div>
          )}
          {attention.map((a) => (
            <Link
              key={a.text}
              href={a.href}
              className={
                `group inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-medium transition-colors ${label13} ` +
                (a.tone === "danger" ? "border-danger-soft text-danger hover:bg-danger-soft" : "border-warn-soft text-warn hover:bg-warn-soft")
              }
            >
              <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${a.tone === "danger" ? "bg-danger" : "bg-warn"}`} />
              {a.text}
              <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
            </Link>
          ))}
        </div>
        <SegmentedControl<RangeKey> ariaLabel="Time range" value={range} onValueChange={setRange} options={RANGE_SEGMENTS} />
      </div>

      {dash.isPending ? (
        <div className="flex flex-col gap-5">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : dash.error ? (
        <div className={panel}>
          <QueryErrorState title="Couldn't load the dashboard" error={dash.error} onRetry={() => dash.refetch()} />
        </div>
      ) : (
        <div className="stagger flex flex-col gap-5">
          {/* Thesis hero — the business in one sentence + the live coverage map (ADM-01, mockup 01) */}
          <section className="grid overflow-hidden rounded-2xl border border-border-soft bg-surface shadow-sm lg:grid-cols-[1fr_1.2fr]">
            <div className="flex flex-col p-6 lg:p-7">
              <span className={`font-semibold uppercase tracking-[.08em] text-text-3 ${label13}`}>{current.label}</span>
              <h2 className="mt-2 font-display text-step-7 font-semibold leading-[1.12] tracking-tight text-balance">
                <HeroHeadline distributed={d!.stats.distributed.value} leadsIn={d!.stats.leadsIn.value} activePartners={d!.stats.partners.value} />
              </h2>
              <p className="mt-2 max-w-[40ch] text-sm text-text-2">
                <HeroSubtitle distributed={d!.stats.distributed.value} unmatched={d!.stats.unmatched.value} leadsIn={d!.stats.leadsIn.value} />
              </p>
              {/* mt-6 (was mt-auto): a fixed rhythm under the subtitle — bottom-anchoring
                  left a floating mid-card gap whenever the map column ran taller (owner
                  testing note #1). Tooltip copy kept deliberately plain (same note). */}
              <div className="mt-6">
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
                  {/* WP-UX-4: per-metric polarity — more leads/distribution is good, more
                      unmatched is bad; Partners stays neutral (a count, not a direction). */}
                  <HeroKpi label="Leads in" value={d!.stats.leadsIn.value} delta={d!.stats.leadsIn.delta} good="up" tip="All leads imported in this range, before MLS filtering." />
                  <HeroKpi label="Distributed" value={d!.stats.distributed.value} delta={d!.stats.distributed.delta} good="up" tone="brand" tip="Leads that went to a partner in this range." />
                  <HeroKpi label="Unmatched" value={d!.stats.unmatched.value} delta={d!.stats.unmatched.delta} good="down" tone="warn" tip="Leads no partner covers yet — they're waiting for an assignment." />
                </div>
                {/* Partner-stat tier — same cell design as the KPIs, range-scoped rollups
                    across partners (PRN-15); no prior-window delta on these. */}
                <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
                  <HeroKpi label={d!.stats.partners.value === 1 ? "Partner" : "Partners"} value={d!.stats.partners.value} delta={d!.stats.partners.delta} tip="Partners that received at least one lead in this range." />
                  <HeroKpi label="Contacted" value={d!.stats.contacted.value} delta={d!.stats.contacted.delta} good="up" tip="Leads partners acted on for the first time in this range — a status change or a note." />
                  <HeroKpi label="Closed" value={d!.stats.closed.value} delta={d!.stats.closed.delta} good="up" tip="Leads marked Closed in this range." />
                </div>
              </div>
            </div>
            <div className="relative flex min-h-[280px] flex-col border-t border-border bg-surface-2 p-4 lg:border-l lg:border-t-0">
              {coverage.data ? (
                <>
                  <CountyCoverageMap
                    states={coverage.data.states}
                    counties={coverage.data.counties}
                    // VP-2: interactive on desktop, static on phones — the interactive map's
                    // `touch-none` otherwise swallows page-scroll over the hero on mobile.
                    interactive={isDesktop}
                    caption={{
                      title: "Coverage",
                      subtitle: `${coverage.data.partners.length} partner${coverage.data.partners.length === 1 ? "" : "s"} · ${coverage.data.coveredCount} state${coverage.data.coveredCount === 1 ? "" : "s"}`,
                    }}
                  />
                  {/* WP-UX-4 (audit D-1): the same one-swatch key the Coverage page shows —
                      this map previously had NO legend, and the hatch read as a partner fill.
                      Keyboard/AT path to the accessible per-partner companion list stays — the
                      hero map itself is role="img" (a11y F-1). */}
                  <div className={`mt-2 flex items-center justify-between gap-3 ${label13}`}>
                    <UncoveredKey className="text-text-3" />
                    <Link href="/coverage" className="font-semibold text-brand-ink hover:underline">
                      View full coverage →
                    </Link>
                  </div>
                </>
              ) : coverage.isError ? (
                <EmptyState compact title="Coverage map unavailable." className="flex-1" />
              ) : (
                <Skeleton className="h-full min-h-[248px] flex-1" />
              )}
            </div>
          </section>

          {/* Trend + removed-by-source donut (mockup 01 row2) */}
          <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
            <section className={panel}>
              <div className="mb-4 flex items-baseline justify-between gap-2">
                <h3 className="font-display text-step-3 font-semibold tracking-tight">Lead Flow</h3>
                <span className={`text-text-3 ${label13}`}>{rangeLabel}</span>
              </div>
              {d!.trend.length === 0 ? (
                <p className="py-8 text-center text-sm text-text-3">No leads in this range.</p>
              ) : (
                <LineChart
                  data={d!.trend.map((b) => ({ x: fmtBucket(b.bucketStart, d!.range.bucket), "Leads in": b.leadsIn, Distributed: b.distributed, Unmatched: b.unmatched }))}
                  xKey="x"
                  series={[
                    { key: "Leads in", name: "Leads in", color: "var(--text-2)" },
                    { key: "Distributed", name: "Distributed", color: "var(--brand)" },
                    // WP-UX-4 (audit D-5): unmatched is the ALERT series — the warn amber
                    // hugged the axis nearly invisibly; danger is AA-vetted in both themes.
                    { key: "Unmatched", name: "Unmatched", color: "var(--danger)" },
                  ]}
                />
              )}
            </section>
            <section className={panel}>
              <h3 className="mb-4 font-display text-step-3 font-semibold tracking-tight">Removed by Source</h3>
              {donutData.length === 0 ? (
                <p className="py-8 text-center text-sm text-text-3">No removed leads {rangeLabel}.</p>
              ) : (
                <div className="flex justify-center">
                  <DonutChart data={donutData} centerLabel="removed" />
                </div>
              )}
            </section>
          </div>

          {/* Partner performance — no progress bars */}
          <section className={panel}>
            <div className="mb-1 flex items-baseline justify-between">
              <h3 className="font-display text-step-3 font-semibold tracking-tight">Partner Performance</h3>
              <span className={`text-text-3 ${label13}`}>{rangeLabel} · counts by when each event happened</span>
            </div>
            {d!.partners.length === 0 ? (
              <p className="py-4 text-sm text-text-3">No leads distributed {rangeLabel}.</p>
            ) : (
              <Table className="mt-3 min-w-[560px]" ariaLabel="Partner performance" scrollHint>
                <THead>
                  <Tr>
                    <Th>Partner</Th>
                    <Th align="right">Given</Th>
                    <Th align="right"><HeaderTip label="Untouched" tip="Leads the partner hasn't acted on yet." /></Th>
                    <Th align="right"><HeaderTip label="Contacted" tip="Leads the partner first acted on in this range." /></Th>
                    <Th align="right"><HeaderTip label="Avg contact" tip={AVG_CONTACT_DEFINITION} /></Th>
                    <Th align="right">Closed</Th>
                  </Tr>
                </THead>
                <TBody>
                  {d!.partners.map((p) => (
                    <Tr key={p.partnerId} className="hover:bg-surface-2">
                      <Td>
                        <Link href={`/partners/${p.partnerId}`} className="transition-opacity hover:opacity-70">
                          <PartnerTag size="sm" name={p.name} color={p.color} refId={p.refId} />
                        </Link>
                      </Td>
                      <Td align="right"><span className="num font-medium tabular-nums">{p.given}</span></Td>
                      <Td align="right"><span className={`num tabular-nums ${p.untouched > 0 ? "font-semibold text-warn" : "text-text-3"}`}>{p.untouched || "—"}</span></Td>
                      <Td align="right"><span className="num tabular-nums text-text-2">{p.contacted || "—"}</span></Td>
                      <Td align="right"><span className="num tabular-nums text-text-2">{formatContactTime(p.avgContactHours)}</span></Td>
                      <Td align="right"><span className={`num tabular-nums ${p.closed > 0 ? "font-semibold text-brand-ink" : "text-text-3"}`}>{p.closed || "—"}</span></Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </section>

          {/* Lead source performance (table) */}
          <section className={panel}>
            <div className="mb-1 flex items-baseline justify-between">
              <h3 className="font-display text-step-3 font-semibold tracking-tight">Lead Source Performance</h3>
              <span className={`text-text-3 ${label13}`}>{rangeLabel}</span>
            </div>
            {d!.sources.length === 0 ? (
              <p className="py-4 text-sm text-text-3">No leads imported {rangeLabel}.</p>
            ) : (
              <Table className="mt-3 min-w-[420px]" ariaLabel="Lead source performance" scrollHint>
                <THead>
                  <Tr>
                    <Th>Source</Th>
                    <Th align="right"><HeaderTip label="Imported" tip="Leads that came in from this source in this range." /></Th>
                    <Th align="right"><HeaderTip label="Removed" tip="Leads from this source filtered out because they're already listed on the MLS." /></Th>
                    <Th align="right"><HeaderTip label="Removal %" tip="The share of this source's leads that were removed. Higher means lower-quality leads." /></Th>
                    <Th align="right"><HeaderTip label="Closed" tip="Leads from this source that reached Closed in this range." /></Th>
                  </Tr>
                </THead>
                <TBody>
                  {d!.sources.map((s) => {
                    const bad = s.removalRate >= 0.5,
                      warn = s.removalRate >= 0.3;
                    return (
                      <Tr key={s.campaign} className="hover:bg-surface-2">
                        <Td className="font-medium text-text">{s.campaign}</Td>
                        <Td align="right" className="num tabular-nums text-text-2">{s.imported}</Td>
                        <Td align="right" className="num tabular-nums text-text-2">{s.removed}</Td>
                        <Td align="right" className={`num tabular-nums font-semibold ${bad ? "text-danger" : warn ? "text-warn" : "text-text-2"}`}>{pct(s.removalRate)}</Td>
                        <Td align="right" className="num tabular-nums text-text-2">{s.closed || "—"}</Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </section>
        </div>
      )}
    </>
  );
}
