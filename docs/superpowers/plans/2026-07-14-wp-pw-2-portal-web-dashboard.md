# WP-PW-2 — Partner Portal Web: desktop Dashboard + shared HeroKpi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the partner portal Dashboard a desktop layout matching the admin dashboard hero — a two-column hero (KPI tiles + the real county→state choropleth) plus a recent-leads table — while leaving the mobile Dashboard unchanged. KPIs render via a **shared `HeroKpi`** extracted from the admin dashboard (deltas omitted for now; the prior-window line is a fast-follow, WP-PW-2b).

**Architecture:** Extract the admin dashboard's local `HeroKpi` (+ its `Delta`/`HeaderTip` helpers) into `src/components/HeroKpi.tsx` and refactor the admin dashboard to import it (behavior-preserving). Then restructure `PortalDashboard` responsively: `< lg` keeps today's stacked mobile layout; `≥ lg` becomes the admin hero grid `[1fr_1.2fr]` (KPIs left, `CountyCoverageMap` right, `PartnerTag` beneath) with a recent-leads `Table` below. All data via the existing scoped queries (`/api/portal/dashboard`, `/api/portal/territory`, `/api/portal/leads`) — no backend or analytics change this WP.

**Tech Stack:** Next 16 (App Router, TS), React, TanStack Query v5, Tailwind v4, Vitest + jsdom.

## Global Constraints

- **PRN-12 tokens only** — no hardcoded hex/font/product-name.
- **PRN-14** — partner identity is swatch + name + `JV-###` (`PartnerTag`); the map is never the sole signal.
- **PRN-08 / SEC-05** — all reads stay behind the existing scoped portal endpoints; no new data or PII surfaced; `buildPartnerTerritory` anonymization of non-owned states is untouched.
- **PRN-15** — KPI numbers come from `/api/portal/dashboard` analytics only; never re-derived in the component.
- **Mobile (`< lg`) Dashboard is visually unchanged** — the current stacked layout, KPI `grid-cols-2`, map aspect box, and `PartnerTag` stay as shipped. The responsive change only ADDS the `≥ lg` hero grid + recent-leads table.
- **Server data via TanStack Query only** (spec §6.17); the map stays lazy (`next/dynamic ssr:false`) so the headline/KPIs paint first.
- **DSN-03** — the recent-leads rows and any links implement the reused primitives' states.
- Deltas are OUT of scope (WP-PW-2b): the shared `HeroKpi`'s `delta` prop is simply not passed by the portal, so no prior-window line renders. Do NOT add prior-window analytics.
- **Test names carry requirement IDs** (e.g. `PW2-01`).
- **Vitest SERIAL** (`--no-file-parallelism`), `pnpm typecheck` separately, lint CHANGED files. Component tests need `// @vitest-environment jsdom` first line.
- **ONE commit per WP** after explicit owner "go"; push after a separate "go".

---

## File Structure

**New:**
- `src/components/HeroKpi.tsx` — the shared KPI cell + its `Delta` and `HeaderTip` helpers, lifted verbatim from `src/app/dashboard/page.tsx`. Exported from the `@/components` barrel.
- `tests/unit/components/hero-kpi.test.tsx` — renders label/value/tooltip; delta shown only when passed; tone tint.

**Modified:**
- `src/app/dashboard/page.tsx` — delete the local `HeroKpi`/`Delta`/`HeaderTip` (and the now-shared `label13` if it moves) and import them from `@/components`. No visual/behavior change.
- `src/components/index.ts` — export `HeroKpi`.
- `src/app/portal/dashboard/portal-dashboard.tsx` — responsive restructure: mobile stack unchanged; `≥ lg` hero grid + recent-leads table; swap the local `Kpi` for the shared `HeroKpi` (no delta).
- `tests/unit/` — a portal-dashboard render test (desktop hero regions present; mobile parity of the KPI/map pieces).

**Not touched:** any `/api/*` route, `src/modules/analytics/*`, `src/modules/portal/queries.ts` (no delta work this WP).

---

## Task 1: Extract the shared `HeroKpi`

**Files:**
- Create: `src/components/HeroKpi.tsx`
- Modify: `src/app/dashboard/page.tsx` (remove local copies, import shared), `src/components/index.ts`
- Test: `tests/unit/components/hero-kpi.test.tsx`

**Interfaces:**
- Produces: `export function HeroKpi(props: { label: string; value: number; delta?: number | null; tone?: "brand" | "warn"; tip?: string }): JSX.Element`. Consumed by Task 2 (portal) and the admin dashboard.

Notes:
- Move `HeroKpi`, `Delta`, `HeaderTip`, and the `label13` constant (currently `const label13 = "text-step-1"`) into `HeroKpi.tsx` verbatim (they are pure presentational + use `Tooltip` from `@/components`). Keep `Delta`/`HeaderTip` module-private (not exported) unless the admin file still needs them separately — it does not (they're only used by `HeroKpi`). Verify by grep that `Delta`/`HeaderTip` have no other callers in `dashboard/page.tsx` before removing.
- The admin dashboard keeps its own `label13` usage elsewhere — if `label13` is referenced outside the moved code in `page.tsx`, leave a copy there and do NOT remove that reference; only move what `HeroKpi` needs. Confirm with grep.

- [ ] **Step 1: Write the failing test** — `tests/unit/components/hero-kpi.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeroKpi } from "@/components/HeroKpi";

describe("WP-PW-2 HeroKpi", () => {
  it("PW2-01: renders the value and label", () => {
    render(<HeroKpi label="Leads" value={665} />);
    expect(screen.getByText("665")).toBeTruthy();
    expect(screen.getByText("Leads")).toBeTruthy();
  });
  it("PW2-01: formats large numbers with separators", () => {
    render(<HeroKpi label="Leads" value={1284} />);
    expect(screen.getByText("1,284")).toBeTruthy();
  });
  it("PW2-01: shows a prior-window delta only when delta is passed", () => {
    const { rerender } = render(<HeroKpi label="Contacted" value={402} />);
    expect(screen.queryByText(/vs prior/i)).toBeNull();
    rerender(<HeroKpi label="Contacted" value={402} delta={8} />);
    expect(screen.getByText(/vs prior/i)).toBeTruthy();
  });
  it("PW2-01: exposes the calc tooltip label when tip is passed", () => {
    render(<HeroKpi label="Closed" value={57} tip="Leads you marked Closed" />);
    // the label becomes a focusable tooltip trigger
    expect(screen.getByText("Closed").getAttribute("tabindex")).toBe("0");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/components/hero-kpi.test.tsx`
Expected: FAIL (module `@/components/HeroKpi` missing).

- [ ] **Step 3: Create `src/components/HeroKpi.tsx`** — move the exact code from `src/app/dashboard/page.tsx` (the `label13` const, `Delta`, `HeaderTip`, `HeroKpi`). Add `"use client"` is NOT needed (pure presentational, no hooks) — but it imports `Tooltip` from `@/components`; import it directly to avoid a barrel cycle: `import { Tooltip } from "./Tooltip";`. Export only `HeroKpi`. Full file:

```tsx
import * as React from "react";
import { Tooltip } from "./Tooltip";

const label13 = "text-step-1"; // 13px chrome floor

function Delta({ delta }: { delta: number | null }) {
  if (delta === null) return <span className={`num ${label13} text-text-3`}>all time</span>;
  const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "·";
  return <span className={`num ${label13} text-text-3`}>{arrow} {delta === 0 ? "same" : Math.abs(delta)} vs prior</span>;
}

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

/** Hero KPI cell — Fraunces numeral, 13px label, optional prior-window delta and calc
 *  tooltip. Shared by the admin dashboard and the partner portal dashboard. */
export function HeroKpi({ label, value, delta, tone, tip }: { label: string; value: number; delta?: number | null; tone?: "brand" | "warn"; tip?: string }) {
  const color = tone === "brand" ? "text-brand-ink" : tone === "warn" ? "text-warn" : "text-text";
  return (
    <div className="bg-surface px-4 py-3">
      <div className={`font-display text-2xl font-semibold leading-none tabular-nums ${color}`}>{value.toLocaleString()}</div>
      <div className={`mt-1 font-medium uppercase tracking-[.05em] text-text-3 ${label13}`}>
        {tip ? <HeaderTip label={label} tip={tip} /> : label}
      </div>
      {delta !== undefined && <div className="mt-0.5"><Delta delta={delta} /></div>}
    </div>
  );
}
```

Verify the `Tooltip` import path (`./Tooltip`) resolves — check how `dashboard/page.tsx` imports `Tooltip` (it uses the `@/components` barrel; the component file is `src/components/Tooltip.tsx`). If the file name differs, use the real path.

- [ ] **Step 4: Export from the barrel** — add to `src/components/index.ts`: `export { HeroKpi } from "./HeroKpi";`.

- [ ] **Step 5: Refactor `src/app/dashboard/page.tsx`** — delete the local `Delta`, `HeaderTip`, `HeroKpi` definitions (lines ~69-107). Add `HeroKpi` to its `@/components` import. Keep the `label13` const in `page.tsx` ONLY IF it's still referenced by other code there (grep `label13` in the file; the admin page uses it in the hero eyebrow/other cells). If still used, leave `page.tsx`'s own `label13`; the shared `HeroKpi.tsx` has its own copy — that's fine (a 1-line private const, not worth a shared export). If NOT used elsewhere, remove it.

- [ ] **Step 6: Run the HeroKpi test green + the admin dashboard test + full suite**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/components/hero-kpi.test.tsx`
Then the full suite: `pnpm test:unit -- --no-file-parallelism`
Then `pnpm typecheck`.
Expected: all green (the admin dashboard renders identically — same component, just relocated).

- [ ] **Step 7: Lint changed files** — `npx eslint src/components/HeroKpi.tsx src/app/dashboard/page.tsx src/components/index.ts tests/unit/components/hero-kpi.test.tsx` → 0 errors/warnings.

---

## Task 2: Portal Dashboard desktop hero + recent-leads

**Files:**
- Modify: `src/app/portal/dashboard/portal-dashboard.tsx`
- Test: `tests/unit/portal-dashboard.test.tsx`

**Interfaces:**
- Consumes: shared `HeroKpi` (Task 1); existing queries `["portal-dashboard", range]`, `["portal-territory"]`, and (new to this file) `["portal-leads", 1]` for the recent-leads preview; `CountyCoverageMap`, `SegmentedControl`, `PartnerTag`, `Table`/`THead`/`Th`/`TBody`/`Tr`/`Td`, `EmptyState`, `Skeleton` from `@/components`; `statusPillClass` from `@/lib/status-pill`.

Design:
- **Keep the mobile layout (`< lg`) exactly as today**: the `flex flex-col gap-4` stack — the eyebrow `<h1>` + `SegmentedControl` row, the headline `<p>`, the KPI grid (`grid-cols-2`), the map aspect box, the `PartnerTag`. Wrap the swap so mobile renders the current arrangement.
- **Add the desktop hero (`≥ lg`)**: a hero `<section>` `lg:grid lg:grid-cols-[1fr_1.2fr]` — left cell = the headline + a KPI grid using the shared `HeroKpi` (no `delta` passed; keep the same four KPIs Leads/New/Contacted/Closed with their tooltips), right cell = the `CountyCoverageMap` panel (same props: `states`, `neutralUncovered`, `interactive={false}`, `ariaLabel`) with `PartnerTag` beneath. The `SegmentedControl` range stays in the top row (as today).
- Swap the local `Kpi` for the shared `HeroKpi` in BOTH breakpoints (drop the local `Kpi` function). `HeroKpi` without `delta` renders label+value+tooltip — identical content to the old `Kpi`, so mobile KPI tiles look the same.
- **Recent-leads table (`≥ lg` only, below the hero)**: a `Table` of the 5 most recent leads (Ref · Address · City · ST · Received · Status pill) from `useQuery(["portal-leads", 1], () => apiGet("/api/portal/leads?page=1"))` sliced to 5, with a "View all leads →" `Link` to `/portal/leads`. `hidden lg:block`. Loading → `Skeleton`; empty → compact `EmptyState`; error → compact `EmptyState`.

- [ ] **Step 1: Write the failing test** — `tests/unit/portal-dashboard.test.tsx` (jsdom). Mock `next/dynamic` (or the map) + `@/lib/api` to return fixed stats/territory/leads; wrap in `QueryClientProvider`. Assert: the four KPI values render (via shared `HeroKpi`), the headline renders, and the recent-leads table shows the mocked lead refs. (In jsdom no Tailwind CSS, so the `lg:`-gated desktop regions are present in the DOM — assert their content directly.) Full test authored during implementation to match the component's query keys; keep assertions on real rendered content (KPI numbers, a lead ref, the headline), not mocks.

- [ ] **Step 2: Run it and watch it fail** — the recent-leads table + shared-HeroKpi wiring don't exist yet.

- [ ] **Step 3: Implement the responsive restructure** in `portal-dashboard.tsx` per the Design above. Preserve the mobile arrangement; add the `lg:` hero grid + the `hidden lg:block` recent-leads table; replace `Kpi` with `HeroKpi`. Keep the map lazy. Keep all query hooks unconditional (no hooks after an early return).

- [ ] **Step 4: Run the test green + full suite + typecheck + lint**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/portal-dashboard.test.tsx` then the full suite; `pnpm typecheck`; `npx eslint <changed files>`.
Expected: all green, clean.

- [ ] **Step 5: Mobile-parity self-check** — `git diff` the mobile branch: the `< lg` stacked layout's classes for the headline, KPI grid, map box, and `PartnerTag` must be unchanged from the pre-image (only the KPI tile component changed from local `Kpi` to shared `HeroKpi`, which renders equivalent content). Note any delta in the report.

---

## Verification (before the walkthrough)

- Both themes, both breakpoints via the running dev server + computed-style/DOM readback (portal is auth-gated → use the throwaway-public-route technique if a live render is needed; in-app screenshots may stall). Confirm: `≥ lg` shows the two-column hero (KPIs + choropleth) + recent-leads table; `< lg` is unchanged from the shipped mobile dashboard; the admin dashboard is visually identical (shared HeroKpi).

## Reviews (mandatory)

- `pr-reviewer` (always) + `audit-design-system` + `audit-a11y` (UI). Because Task 1 touches the admin dashboard, confirm the admin hero is behavior-preserved.
- Owner walkthrough (desktop hero + mobile-unchanged + admin-unchanged) before committing.

## Self-audit + commit

- PLAYBOOK §6 self-audit printed in the summary. ONE commit after owner "go"; push after a separate "go".

---

## Deliverable

After WP-PW-2: the desktop portal Dashboard matches the admin hero (shared `HeroKpi`, real choropleth, recent-leads table); mobile Dashboard unchanged; admin dashboard unchanged (now consuming the shared component). KPI **deltas** are the fast-follow **WP-PW-2b** (extend `partnerDashboardStats` with prior-window figures, pass `delta` to `HeroKpi`). Then **WP-PW-3** = desktop Leads table + `/api/portal/leads` sort/filter + Activity/Account desktop layouts.
