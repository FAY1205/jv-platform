# WP-E / WS-2 Dashboard — Survey Thesis Hero — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the admin Dashboard to the Survey identity (mockup `01`): a thesis hero (headline + honest match-rate + 3 KPIs + a live coverage map) replaces the equal-weight 5-card stat rail, the time range moves to a new topbar `SegmentedControl`, and the "New import" CTA is repointed off `text-white`.

**Architecture:** Three new/changed units. (1) A pure `matchRate` helper in `src/modules/analytics` is the single home of the "% of kept leads matched" figure (PRN-15). (2) A new presentational `SegmentedControl` primitive fills the WP-B topbar `PageHeader` slot. (3) The dashboard page is split into a thin `DashboardPage` (the `<AppShell>` wrapper) and a `DashboardBody` child that renders inside the shell's `PageHeaderProvider` so `usePageHeader` resolves, and composes the hero from the existing `CoverageMap` (WP-D caption prop) + analytics numbers. No change to `dashboardData`'s SQL or its integration test — the hero reuses numbers it already returns plus the already-fetched `/api/coverage` query.

**Tech Stack:** Next.js App Router (client components), TanStack Query, Tailwind semantic tokens, Vitest + Testing Library (jsdom), the existing `src/components` library and `src/modules/analytics`/`src/modules/coverage`.

## Global Constraints

- **PRN-12:** no hardcoded hex/font/product-name in page or component code — consume semantic tokens only. `--brand`=marigold FILL · `--brand-ink`=amber text/links + focus rings · `--brand-contrast` (#20160A)=fixed-dark text on the marigold fill · `--border-strong`=table rules.
- **PRN-15:** every computed statistic comes from `src/modules/analytics` — never re-derive a number in the page. The match rate is a pure analytics helper the page only formats.
- **PRN-08:** all server data via TanStack Query hitting scoped API routes (`/api/dashboard`, `/api/coverage`) — no new query paths.
- **PRN-14:** partner color never travels alone — `PartnerTag` (swatch + name + `JV-###`) is unchanged; the map keeps its hatch/labels.
- **No sub-13px chrome text** (WP-A/C rule): as this page is touched, bump the `.62–.7rem` label cluster to ≥13px (`text-[.8125rem]`).
- **Component-state completeness** (spec §6.17): every interactive component (the new `SegmentedControl`) implements default/hover/focus-visible/active/disabled.
- **Test names carry requirement IDs:** e.g. `it("ANA-04: …")`, `it("DSN-SEG-01: …")`.
- **ONE commit for the whole workstream** (WP-E rule). Internal tasks END AT GREEN TESTS, not commits. Only Task 4 commits, once, after the self-audit + reviews + owner walkthrough.
- **Run vitest SERIALLY, one instance:** `pnpm test:unit -- --no-file-parallelism` (two concurrent jsdom runs OOM the machine). Typecheck with `pnpm typecheck` (vitest/esbuild does not typecheck).

---

## File Structure

- **Create** `src/modules/analytics/match-rate.ts` — pure `matchRate(distributed, unmatched)` + `formatMatchRatePct(rate)`. Single home of the match-rate figure (PRN-15).
- **Create** `tests/unit/match-rate.test.ts` — unit tests for both functions.
- **Create** `src/components/SegmentedControl.tsx` — the generic single-select segmented control primitive.
- **Modify** `src/components/index.ts` — export `SegmentedControl` + its types.
- **Modify** `tests/unit/components/components.test.tsx` — add `SegmentedControl` component tests.
- **Modify** `src/app/gallery/page.tsx` — showcase `SegmentedControl` (all states).
- **Modify** `src/app/dashboard/page.tsx` — full rewrite to `DashboardPage` (wrapper) + `DashboardBody` (hero + topbar slot + repointed CTA + reskinned sections).

---

## Task 1: `matchRate` analytics helper

**Files:**
- Create: `src/modules/analytics/match-rate.ts`
- Test: `tests/unit/match-rate.test.ts`

**Interfaces:**
- Produces:
  - `matchRate(distributed: number, unmatched: number): number | null` — fraction in `[0,1]` of KEPT leads (`distributed + unmatched`) that reached a partner; `null` when there are no kept leads (nothing to divide).
  - `formatMatchRatePct(rate: number | null): string` — whole-percent display; `"—"` when `null`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/match-rate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { matchRate, formatMatchRatePct } from "@/modules/analytics/match-rate";

describe("matchRate (ANA-04)", () => {
  it("ANA-04: share of kept leads matched = distributed / (distributed + unmatched)", () => {
    expect(matchRate(412, 36)).toBeCloseTo(412 / 448, 10);
  });

  it("ANA-04: null when there are no kept leads (empty denominator)", () => {
    expect(matchRate(0, 0)).toBeNull();
  });

  it("ANA-04: 0 when every kept lead is unmatched", () => {
    expect(matchRate(0, 10)).toBe(0);
  });

  it("ANA-04: 1 when every kept lead is matched", () => {
    expect(matchRate(10, 0)).toBe(1);
  });
});

describe("formatMatchRatePct (ANA-04)", () => {
  it("ANA-04: rounds to a whole percent", () => {
    expect(formatMatchRatePct(matchRate(1, 2))).toBe("33%"); // 0.3333 → 33%
    expect(formatMatchRatePct(412 / 448)).toBe("92%");
  });

  it("ANA-04: null → em dash (no kept leads)", () => {
    expect(formatMatchRatePct(null)).toBe("—");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- --no-file-parallelism match-rate`
Expected: FAIL — `Cannot find module '@/modules/analytics/match-rate'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/modules/analytics/match-rate.ts`:

```ts
// Match rate (ANA-04). PURE — no I/O, no Date.now() (PRN-01). The single home of
// this number (PRN-15): the share of KEPT leads that reached a covering partner,
// i.e. distributed / (distributed + unmatched). `null` when there are no kept
// leads, so callers render an em dash instead of a meaningless "0%".

/** Fraction in [0,1] of kept leads matched to a partner; null when no kept leads. */
export function matchRate(distributed: number, unmatched: number): number | null {
  const kept = distributed + unmatched;
  if (kept <= 0) return null;
  return distributed / kept;
}

/** Whole-percent display of the match rate; "—" when null. */
export function formatMatchRatePct(rate: number | null): string {
  if (rate === null) return "—";
  return `${Math.round(rate * 100)}%`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- --no-file-parallelism match-rate`
Expected: PASS (6 assertions across 2 describes).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

*(No commit — WP-E is one commit at Task 4.)*

---

## Task 2: `SegmentedControl` primitive

**Files:**
- Create: `src/components/SegmentedControl.tsx`
- Modify: `src/components/index.ts` (add export)
- Modify: `tests/unit/components/components.test.tsx` (add tests)
- Modify: `src/app/gallery/page.tsx` (showcase)

**Interfaces:**
- Produces:
  - `SegmentOption<T extends string> = { value: T; label: string }`
  - `SegmentedControlProps<T extends string> = { value: T; onValueChange: (value: T) => void; options: readonly SegmentOption<T>[]; ariaLabel: string; disabled?: boolean; className?: string }`
  - `SegmentedControl<T extends string>(props): JSX.Element` — a `role="group"` container of `<button aria-pressed>` segments; active segment = route-tinted (`bg-brand-soft text-brand-ink`).

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/components/components.test.tsx` — add `SegmentedControl` to the top-of-file import from `@/components`, then add this block at the end of the file:

```tsx
describe("DSN-SEG-01: SegmentedControl", () => {
  const OPTS = [
    { value: "7d", label: "7 days" },
    { value: "30d", label: "30 days" },
    { value: "all", label: "All" },
  ] as const;

  it("DSN-SEG-01: exposes a labeled group and marks the selected segment pressed", () => {
    render(<SegmentedControl ariaLabel="Time range" value="30d" onValueChange={() => {}} options={OPTS} />);
    expect(screen.getByRole("group", { name: "Time range" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "false");
  });

  it("DSN-SEG-01: reports the clicked segment's value", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<SegmentedControl ariaLabel="Time range" value="30d" onValueChange={onValueChange} options={OPTS} />);
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(onValueChange).toHaveBeenCalledWith("all");
  });

  it("DSN-SEG-01: disabled group blocks selection", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<SegmentedControl ariaLabel="Time range" value="30d" onValueChange={onValueChange} options={OPTS} disabled />);
    const btn = screen.getByRole("button", { name: "7 days" });
    expect(btn).toBeDisabled();
    await user.click(btn);
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- --no-file-parallelism components.test`
Expected: FAIL — `SegmentedControl` is not exported from `@/components`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/SegmentedControl.tsx`:

```tsx
import * as React from "react";
import { cn } from "@/lib/cn";

// SegmentedControl (DSN-SEG) — a single-select toggle group for short, mutually
// exclusive choices (e.g. a dashboard time range). All values come from tokens
// (PRN-12); the active segment is route-tinted. Implements the DSN-03 state
// matrix (default/hover/focus-visible/active/disabled). Accessibility mirrors the
// mockup: a labeled role="group" of buttons, each with aria-pressed.

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SegmentOption<T>[];
  /** Required accessible name for the group (no visible label). */
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  disabled,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn("inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5", className)}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onValueChange(o.value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium outline-none transition-colors duration-[120ms]",
              "focus-visible:ring-1 focus-visible:ring-brand-ink disabled:pointer-events-none disabled:opacity-50",
              on ? "bg-brand-soft font-semibold text-brand-ink" : "text-text-2 hover:bg-surface-3 hover:text-text",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Add the barrel export**

In `src/components/index.ts`, add after the `Select`/`StatusSelect` exports (near line 10):

```ts
export { SegmentedControl, type SegmentedControlProps, type SegmentOption } from "./SegmentedControl";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test:unit -- --no-file-parallelism components.test`
Expected: PASS including the 3 new `DSN-SEG-01` cases.

- [ ] **Step 6: Showcase in the gallery**

In `src/app/gallery/page.tsx`: add `SegmentedControl` to the `@/components` import list, add a range state near the other gallery state (e.g. beside `const [selectVal, setSelectVal] = React.useState("new");`):

```tsx
const [seg, setSeg] = React.useState("30d");
```

Then add a new `<Section>` immediately after the existing `<Section title="Form controls">…</Section>` block:

```tsx
<Section title="Segmented control — all states">
  <div className="flex flex-wrap items-center gap-6">
    <SegmentedControl
      ariaLabel="Time range"
      value={seg}
      onValueChange={setSeg}
      options={[
        { value: "7d", label: "7 days" },
        { value: "30d", label: "30 days" },
        { value: "12mo", label: "12 months" },
        { value: "all", label: "All" },
      ]}
    />
    <SegmentedControl
      ariaLabel="Disabled example"
      value="30d"
      onValueChange={() => {}}
      disabled
      options={[
        { value: "7d", label: "7 days" },
        { value: "30d", label: "30 days" },
      ]}
    />
  </div>
</Section>
```

- [ ] **Step 7: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors. (Confirms the generic component + gallery usage type-check.)

*(No commit yet.)*

---

## Task 3: Dashboard rewrite — thesis hero + topbar range control

**Files:**
- Modify (full rewrite): `src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `matchRate`, `formatMatchRatePct` (Task 1); `SegmentedControl` (Task 2); existing `CoverageMap` (WP-D `caption` prop), `usePageHeader`, `LineChart`, `DonutChart`, `Tooltip`, `PartnerTag`, `EmptyState`, `Skeleton`, `AppShell` from `@/components`; `DashboardData` from `@/modules/analytics/queries`; `formatContactTime`, `AVG_CONTACT_DEFINITION`, `RangeKey` from `@/modules/analytics/ranges`; `StateCoverage`, `CoveragePartner` from `@/modules/coverage/map`; `/api/dashboard?range=` and `/api/coverage` routes.

**Key correctness notes (do not skip):**
1. **`usePageHeader` must run inside `AppShell`.** Split into `DashboardPage` (returns `<AppShell><DashboardBody/></AppShell>`) and `DashboardBody` (calls `usePageHeader`, renders the body — NO `<AppShell>` wrapper). `DashboardBody` is a child of the shell's `PageHeaderProvider`, so the hook resolves.
2. **Memoize `actions`** with `React.useMemo(…, [range])`. `usePageHeader`'s effect depends on the `actions` node identity; a fresh element every render would re-fire the effect → `set()` → re-render → infinite loop (the class of bug WP-B already had to fix). Memoizing on `[range]` makes the element stable except when the range actually changes.

- [ ] **Step 1: Rewrite the page**

Replace the entire contents of `src/app/dashboard/page.tsx` with:

```tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import {
  AppShell,
  CoverageMap,
  PartnerTag,
  EmptyState,
  Skeleton,
  SegmentedControl,
  LineChart,
  DonutChart,
  Tooltip,
  usePageHeader,
} from "@/components";
import { formatContactTime, AVG_CONTACT_DEFINITION, type RangeKey } from "@/modules/analytics/ranges";
import { matchRate, formatMatchRatePct } from "@/modules/analytics/match-rate";
import type { DashboardData } from "@/modules/analytics/queries";
import type { StateCoverage, CoveragePartner } from "@/modules/coverage/map";

// ADM-01: the business pulse on one screen (ANA-01). A thesis HERO — a one-sentence
// headline, an honest match-rate line, three KPIs, and the live coverage map — tops
// the page; the trend, removed-by-source donut, and partner/source tables sit below.
// Every number is aggregated in SQL bounded by the selected range (F-10) and computed
// in src/modules/analytics only (PRN-15); the page just formats. All color/type is
// token-driven (PRN-12).

interface CoverageResponse {
  states: StateCoverage[];
  coveredCount: number;
  gapCount: number;
  partners: CoveragePartner[];
  zipCoverageCount: number;
  unmatchedLeadCount: number;
  coveredVolumePct: number;
  keptLeadCount: number;
}

const RANGES: { value: RangeKey; label: string; short: string }[] = [
  { value: "7d", label: "Last 7 days", short: "7 days" },
  { value: "30d", label: "Last 30 days", short: "30 days" },
  { value: "12mo", label: "Last 12 months", short: "12 months" },
  { value: "all", label: "All time", short: "All" },
];
const RANGE_SEGMENTS: { value: RangeKey; label: string }[] = RANGES.map((r) => ({ value: r.value, label: r.short }));

const panel = "rounded-2xl border border-border-soft bg-surface p-5 shadow-sm";
const label13 = "text-[.8125rem]"; // ≥13px chrome text (no sub-13px — WP-A/C rule)
const pct = (n: number) => `${Math.round(n * 100)}%`;

// Trend x-axis label: "Jul 3" for daily buckets, "Jul 2026" for monthly.
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
  if (delta === null) return <span className={`num ${label13} text-text-3`}>all time</span>;
  const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "·";
  return <span className={`num ${label13} text-text-3`}>{arrow} {delta === 0 ? "same" : Math.abs(delta)} vs prior</span>;
}

function HeaderTip({ label, tip }: { label: string; tip: string }) {
  return (
    <Tooltip content={tip}>
      <span className="inline-flex cursor-help items-center gap-1">{label}<span className="text-text-3" aria-hidden="true">ⓘ</span></span>
    </Tooltip>
  );
}

// Hero KPI cell — Fraunces numeral, 13px label, prior-window delta. Each cell is
// self-labeled, so the tone tint (Distributed = brand-ink, Unmatched = warn) is
// redundant, not the sole signal.
function HeroKpi({ label, stat, tone }: { label: string; stat: { value: number; delta: number | null }; tone?: "brand" | "warn" }) {
  const color = tone === "brand" ? "text-brand-ink" : tone === "warn" ? "text-warn" : "text-text";
  return (
    <div className="bg-surface px-4 py-3">
      <div className={`font-display text-2xl font-semibold leading-none tabular-nums ${color}`}>{stat.value.toLocaleString()}</div>
      <div className={`mt-1 font-medium uppercase tracking-[.05em] text-text-3 ${label13}`}>{label}</div>
      <div className="mt-0.5"><Delta delta={stat.delta} /></div>
    </div>
  );
}

// Hero copy. Figures come from analytics (distributed, leadsIn, unmatched) and the
// coverage module (partnerCount); the match rate is computed in analytics (matchRate),
// never re-derived here (PRN-15).
function HeroHeadline({ distributed, leadsIn, partnerCount }: { distributed: number; leadsIn: number; partnerCount: number | null }) {
  if (leadsIn === 0) return <>No leads to route yet.</>;
  const across =
    partnerCount && partnerCount > 0 ? (
      <> across <em className="not-italic text-brand-ink">{partnerCount} partner{partnerCount === 1 ? "" : "s"}</em></>
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
      <span className="num font-semibold text-text">{formatMatchRatePct(rate)}</span> of kept leads matched to a covering partner.
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
  const dash = useQuery({ queryKey: ["dashboard", range], queryFn: () => apiGet<DashboardData>(`/api/dashboard?range=${range}`) });
  const coverage = useQuery({ queryKey: ["coverage"], queryFn: () => apiGet<CoverageResponse>("/api/coverage") });

  // Topbar cluster (WP-B slot): title + range control + primary action. Memoized on
  // [range] so the element identity is stable between renders — usePageHeader's effect
  // keys on the actions node, and a fresh element every render would loop.
  const actions = React.useMemo(
    () => (
      <div className="flex items-center gap-2">
        <SegmentedControl<RangeKey> ariaLabel="Time range" value={range} onValueChange={setRange} options={RANGE_SEGMENTS} />
        <Link
          href="/upload"
          className="hidden items-center gap-1.5 rounded-lg border border-brand bg-brand px-3.5 py-2 text-sm font-semibold text-brand-contrast shadow-xs transition-colors hover:bg-brand-strong active:scale-[.98] sm:inline-flex"
        >
          <span className="text-base leading-none">+</span> New import
        </Link>
      </div>
    ),
    [range],
  );
  usePageHeader({ title: "Dashboard", actions });

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

  const partnerCount = coverage.data?.partners.length ?? null;

  return (
    <>
      {coverage.isError && (
        <div className="mb-5 flex items-center gap-2.5 rounded-2xl border border-danger-soft p-4 text-sm" style={{ background: "var(--danger-soft)" }}>
          <span className="h-2 w-2 shrink-0 rounded-full bg-danger" />
          <span className="font-medium text-text">Couldn&apos;t check for attention items.</span>
          <button type="button" onClick={() => coverage.refetch()} className="ml-auto text-xs font-semibold text-text-2 hover:underline">Retry</button>
        </div>
      )}

      {dash.isPending ? (
        <div className="flex flex-col gap-5">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : dash.error ? (
        <div className={panel}>
          <EmptyState title="Couldn't load the dashboard" description={(dash.error as Error).message} />
        </div>
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

          {/* Thesis hero — the business in one sentence + the live coverage map (ADM-01, mockup 01) */}
          <section className="grid overflow-hidden rounded-2xl border border-border-soft bg-surface shadow-sm lg:grid-cols-[1fr_1.2fr]">
            <div className="flex flex-col p-6 lg:p-7">
              <span className={`font-semibold uppercase tracking-[.08em] text-text-3 ${label13}`}>{current.label}</span>
              <h2 className="mt-2 font-display text-[2rem] font-semibold leading-[1.12] tracking-tight text-balance">
                <HeroHeadline distributed={d!.stats.distributed.value} leadsIn={d!.stats.leadsIn.value} partnerCount={partnerCount} />
              </h2>
              <p className="mt-2 max-w-[40ch] text-sm text-text-2">
                <HeroSubtitle distributed={d!.stats.distributed.value} unmatched={d!.stats.unmatched.value} leadsIn={d!.stats.leadsIn.value} />
              </p>
              <div className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border bg-border">
                <HeroKpi label="Leads in" stat={d!.stats.leadsIn} />
                <HeroKpi label="Distributed" stat={d!.stats.distributed} tone="brand" />
                <HeroKpi label="Unmatched" stat={d!.stats.unmatched} tone="warn" />
              </div>
            </div>
            <div className="relative min-h-[280px] border-t border-border bg-surface-2 p-4 lg:border-l lg:border-t-0">
              {coverage.data ? (
                <CoverageMap
                  states={coverage.data.states}
                  caption={{
                    title: "Coverage",
                    subtitle: `${coverage.data.partners.length} partner${coverage.data.partners.length === 1 ? "" : "s"} · ${coverage.data.coveredCount} state${coverage.data.coveredCount === 1 ? "" : "s"}`,
                  }}
                />
              ) : coverage.isError ? (
                <div className="grid h-full place-items-center px-4 text-center text-sm text-text-3">Coverage map unavailable.</div>
              ) : (
                <Skeleton className="h-full min-h-[248px]" />
              )}
            </div>
          </section>

          {/* Trend + removed-by-source donut (mockup 01 row2) */}
          <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
            <section className={panel}>
              <div className="mb-4 flex items-baseline justify-between gap-2">
                <h3 className="font-display text-[.95rem] font-semibold tracking-tight">Lead flow</h3>
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
                    { key: "Unmatched", name: "Unmatched", color: "var(--warn)" },
                  ]}
                />
              )}
            </section>
            <section className={panel}>
              <h3 className="mb-4 font-display text-[.95rem] font-semibold tracking-tight">Removed by source</h3>
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
              <h3 className="font-display text-[.95rem] font-semibold tracking-tight">Partner performance</h3>
              <span className={`text-text-3 ${label13}`}>{rangeLabel} · counts by when each event happened</span>
            </div>
            {d!.partners.length === 0 ? (
              <p className="py-4 text-sm text-text-3">No leads distributed {rangeLabel}.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className={`border-b border-border-strong text-left font-semibold uppercase tracking-wider text-text-3 ${label13}`}>
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
                          <Link href={`/partners/${p.partnerId}`} className="transition-opacity hover:opacity-70">
                            <PartnerTag size="sm" name={p.name} color={p.color} refId={p.refId} />
                          </Link>
                        </td>
                        <td className="px-2 py-2.5 text-right"><span className="num font-medium tabular-nums">{p.given}</span></td>
                        <td className="px-2 py-2.5 text-right"><span className={`num tabular-nums ${p.untouched > 0 ? "font-semibold text-warn" : "text-text-3"}`}>{p.untouched || "—"}</span></td>
                        <td className="px-2 py-2.5 text-right"><span className="num tabular-nums text-text-2">{p.contacted || "—"}</span></td>
                        <td className="px-2 py-2.5 text-right"><span className="num tabular-nums text-text-2">{formatContactTime(p.avgContactHours)}</span></td>
                        <td className="px-2 py-2.5 text-right"><span className={`num tabular-nums ${p.closed > 0 ? "font-semibold text-brand-ink" : "text-text-3"}`}>{p.closed || "—"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Lead source performance (table) */}
          <section className={panel}>
            <div className="mb-1 flex items-baseline justify-between">
              <h3 className="font-display text-[.95rem] font-semibold tracking-tight">Lead source performance</h3>
              <span className={`text-text-3 ${label13}`}>removal rate = share discarded as MLS-listed</span>
            </div>
            {d!.sources.length === 0 ? (
              <p className="py-4 text-sm text-text-3">No leads imported {rangeLabel}.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className={`border-b border-border-strong text-left font-semibold uppercase tracking-wider text-text-3 ${label13}`}>
                      <th className="py-2 pr-3 font-semibold">Source</th>
                      <th className="px-2 py-2 text-right font-semibold">Imported</th>
                      <th className="px-2 py-2 text-right font-semibold">Removed</th>
                      <th className="px-2 py-2 text-right font-semibold">Removal %</th>
                      <th className="px-2 py-2 text-right font-semibold">Closed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d!.sources.map((s) => {
                      const bad = s.removalRate >= 0.5,
                        warn = s.removalRate >= 0.3;
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
            )}
          </section>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors. (Confirms the generic `SegmentedControl<RangeKey>` usage, the removed `Select` import, and the new component signatures.)

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: no errors/warnings in `src/app/dashboard/page.tsx`. (Ignore any warnings originating in `.claude/worktrees/` — parallel-session copies, not this code.)

- [ ] **Step 4: Full unit + component suite (serial)**

Run: `pnpm test:unit -- --no-file-parallelism`
Expected: all green, including `match-rate` (Task 1) and the `DSN-SEG-01` cases (Task 2). No page-render test is added for the dashboard — its numbers are covered by the analytics unit tests + the `dashboard.test.ts` integration suite (unchanged), and the new interactive/logic units are unit-tested.

- [ ] **Step 5: Manual scan for regressions**

Confirm by reading the file:
- No `text-white` remains in the page (CTA uses `text-brand-contrast`).
- No raw hex; only `var(--…)`/token classes.
- No `Select` import; `SegmentedControl`, `CoverageMap`, `usePageHeader` imported.
- `DashboardBody` (not `DashboardPage`) calls `usePageHeader`; `actions` is memoized on `[range]`.

*(No commit yet.)*

---

## Task 4: Self-audit, reviews, walkthrough, single commit

**Files:** none (verification + one commit of Tasks 1–3).

- [ ] **Step 1: Gate — typecheck + lint + serial suites**

Run, in order, and confirm each is clean:
```
pnpm typecheck
pnpm lint
pnpm test:unit -- --no-file-parallelism
pnpm test:integration -- --no-file-parallelism
```
Expected: typecheck/lint clean; unit suite green (new `match-rate` + `DSN-SEG-01` cases included); integration green or self-skipping locally exactly as before (WS-2 changed no server/SQL — `dashboard.test.ts` must be unchanged and still pass/skip as it did pre-WP).

- [ ] **Step 2: PLAYBOOK §6 self-audit**

Open `docs/PLAYBOOK.md` §6, fill the checklist against this diff, and paste the completed checklist into the final summary. Explicitly confirm: PRN-12 (no hex/`text-white`), PRN-15 (match rate from analytics; KPIs from `dashboardData`), PRN-08 (queries via existing scoped routes), PRN-14 (PartnerTag/map unchanged), component-state matrix for `SegmentedControl`, no sub-13px chrome text left on the page, requirement-ID test names.

- [ ] **Step 3: pr-reviewer on the diff**

Dispatch the `pr-reviewer` agent against the working-tree diff (Tasks 1–3). Address every correctness/spec finding before committing; record how each was handled.

- [ ] **Step 4: `/audit frontend` on the diff**

Run the `/audit` skill scoped to the frontend diff (pr-reviewer + audit-design-system + audit-a11y + audit-frontend-arch as the skill selects). Triage findings; fix design-system/token/a11y issues (e.g. segmented-control focus/aria, hero contrast in both themes). Note any deferred item with rationale.

- [ ] **Step 5: Owner walkthrough (visualize widget)**

The browser-preview renderer is env-blocked (0×0 / screenshot timeout), so present the WS-2 result as a `visualize` widget (both light + dark), covering: the hero (headline + match-rate + 3 KPIs + captioned map), the topbar segmented range control, and the reskinned trend/donut/tables. Get owner sign-off. Do NOT commit before sign-off.

- [ ] **Step 6: Single commit**

After sign-off, stage and commit Tasks 1–3 as ONE commit:
```bash
git add src/modules/analytics/match-rate.ts tests/unit/match-rate.test.ts \
        src/components/SegmentedControl.tsx src/components/index.ts \
        tests/unit/components/components.test.tsx src/app/gallery/page.tsx \
        src/app/dashboard/page.tsx docs/superpowers/plans/2026-07-11-wp-e-ws2-dashboard.md
git commit -m "$(cat <<'EOF'
feat(wp-e/ws-2): Dashboard thesis hero — captioned coverage map, match-rate line, topbar SegmentedControl

- Replace the 5-card stat rail with the Survey hero (mockup 01): headline
  "{distributed} leads distributed across {N} partners", an honest match-rate
  subtitle, 3 KPIs (Leads in/Distributed/Unmatched), and the summary CoverageMap
  with the WP-D caption plate.
- New pure matchRate/formatMatchRatePct in src/modules/analytics (PRN-15 single home).
- New SegmentedControl primitive (route-tinted, full state matrix) in the topbar
  PageHeader slot; range control moves out of the page body.
- Repoint the "New import" CTA off text-white to --brand-contrast on the marigold fill.
- Bump the page's sub-13px chrome text to 13px; table rules → border-strong.
- No change to dashboardData SQL or its integration test.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage** (WP-E table row WS-2 + R3 §4 WS-2 + task carry-ins):
- Thesis hero (map + one sentence + 3 KPIs) → Task 3 hero. ✅
- KPI numbers from `src/modules/analytics` only (PRN-15) → KPIs from `dashboardData().stats`; match rate from `matchRate` (Task 1). ✅
- Map caption prop wired on the dashboard hero → Task 3 `caption={{title,subtitle}}`. ✅
- Dashboard CTA repointed off `bg-brand/text-white` → Task 3 CTA uses `text-brand-contrast`. ✅
- R3 §4 functional criteria kept: trend LineChart (In/Distributed/Unmatched), time filters (all 4 ranges via SegmentedControl → same `?range=` query), partner performance table + Avg-Contact tooltip, lead-source table + removed-by-source donut, honest attention/error banner (F-21) → all retained in Task 3. ✅
- Range control placement (owner: topbar segmented) → Task 2 primitive + Task 3 `usePageHeader`. ✅
- **Deltas note:** the `/coverage` legend-swatch fix and the imports/profile CTAs are OTHER WP-E pages (WS-4/WS-5/WS-8) — out of WS-2 scope; not in this plan by design.

**2. Placeholder scan:** No TBD/TODO; every code step shows full content; the dashboard file is given in full.

**3. Type consistency:** `matchRate`/`formatMatchRatePct` signatures match between Task 1 def and Task 3 use. `SegmentedControl` generic props (`value`/`onValueChange`/`options`/`ariaLabel`/`disabled`) match between Task 2 def, its tests, the gallery, and Task 3's `SegmentedControl<RangeKey>`. `CoverageResponse` fields (`states`,`coveredCount`,`partners`,`gapCount`,`unmatchedLeadCount`) match the coverage route/page contract. `DashboardData.stats.{leadsIn,distributed,unmatched}` match `queries.ts`.

**Risk flagged for the walkthrough:** the topbar with the 4-segment control + CTA is desktop-first; the CTA is `hidden … sm:inline-flex` to reduce phone crowding, but the segmented control itself is wide — confirm mobile density in the walkthrough / a11y audit and treat a compaction as a follow-up if flagged.

---

## Owner review revisions (2026-07-11, after the walkthrough)

Verified against real rendered screenshots (Playwright vs the running dev server, both themes) since the in-app preview renderer is env-dead:

1. **"New import" CTA removed from the dashboard** — it lives on the Imports page only. The topbar action is now the range `SegmentedControl` alone (matches mockup 01; also closes the pr-review F-4 mobile-CTA concern outright).
2. **Hero map → the real geographic coverage map.** Replaced the hex `CoverageMap` with `CountyCoverageMap` (the county-dissolved-to-state Survey signature), **code-split + client-only via `next/dynamic`** so the headline/KPIs paint immediately and the ~0.9 MB geometry streams in after (own skeleton while loading).
3. **Attention banner → slim inline pills.** The full-width tinted card became compact rounded pills (subtle border, tone via text + a dot + the text itself — PRN-14 intact); the coverage-error state is a matching compact notice (F-21 honesty kept).
4. **ⓘ tooltip glyph removed.** Calculation tooltips (ANA-03/UXQ-05) are retained but the affordance is now a subtle dotted underline on the label (KPI labels + table headers), matching the match-rate figure — keyboard-reachable (`tabIndex=0`).
5. Post-review incremental changes are presentational/owner-directed; typecheck + lint stayed green throughout.

### Second owner pass (live dashboard review)

6. **Tooltip clipping fixed (primitive bug).** `Tooltip` was `position:absolute` inside its trigger's parent, so it was clipped by overflow ancestors (the KPI strip's `overflow-hidden`, tables' `overflow-auto`). Rewrote it to **portal the bubble to `<body>`** with viewport-fixed coordinates (flips below the trigger near the top edge). SSR-safe via `useSyncExternalStore` (no setState-in-effect; satisfies the React 19 `set-state-in-effect` lint). Existing `Tooltip` test still passes.
7. **Hero left-column whitespace.** KPI strip bottom-anchored (`mt-auto`); headline holds the top, KPIs pinned to the bottom (mockup 01 intent).
8. **Partner-stat tier (owner request).** A second **KPI-style boxed tier** under the primary KPIs (same cell design — Fraunces numeral + dotted-underline label + calc tooltip) — **Partners · Contacted · Closed**.
**Recorded decision (pr-review F-2) — ANA-01 "Removed" KPI:** the Survey hero surfaces
Leads in / Distributed / Unmatched (+ Partners / Contacted / Closed). The aggregate
**"Removed" figure is intentionally NOT a headline KPI** — it is surfaced range-scoped in
the "Lead source performance" table (per-campaign removed + removal %) and the "Removed by
source" donut. This is a deliberate reinvention trade-off (owner-approved hero via mockup 01
+ the review iterations), not an omission. `stats.removed` stays computed in the API for
completeness. Flagged for owner confirmation at the walkthrough.

**pr-review follow-ups applied:** F-1 (the duplicate `contacted` CTE removed — `contacted`
is now summed from the single per-partner first-touch query, with a `prior_contacted`
column for the delta; invariant test added), F-3 (tenant-isolation test extended to
`stats.partners`/`stats.contacted`), F-4 (stale `activePartnerCount` comment fixed), F-5
(`dynamic()` moved below the imports). F-6 (tooltip pre-hydration node) is an informational
EXTERNAL-GAP — the `useSyncExternalStore` client-gate is the industry-standard pattern; no
change.

9. **Prior-window comparison on the partner tier (owner request).** To show honest "vs prior" deltas (which the page can't derive — it only has current-range partner rows), `dashboardData()` gained two first-class SQL stats with current+prior windows: `partners` (distinct effective-partners with a kept+owned lead in the window, added to the flat-stats query) and `contacted` (total leads first-acted-on in the window — a new CTE query reusing the exact per-partner first-touch definition, PRN-13). `closed` already had a prior. All tenant-scoped (PRN-08). The headline's "N partners" now reads `stats.partners.value` (single SQL source); the interim page/`match-rate` helpers (`activePartnerCount`/`totalContacted`/`totalClosed`) were removed. `HeroKpi` delta made optional. `dashboard.test.ts` extended (partners=2, contacted=2) and **verified against the dev DB**. Unit 79 files / 457 green; dashboard integration 6/6 green.
