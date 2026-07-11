# WP-F.1 — PortalShell + mobile Leads cards (mockup 04)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the partner portal a mobile-first shell (sticky top bar + bottom tab nav Leads/Activity/Account) and convert the desktop leads TABLE into a one-lead-per-card list.

**Architecture:** A new client `PortalShell` (chrome only — top bar + bottom tabs) rendered by a new `src/app/portal/layout.tsx`, wrapping every `/portal/*` page. The shell hides its chrome on the pre-auth `/portal/login` + `/portal/tos` routes (via `usePathname`), so those keep their centered forms. Frontend-only — no API/backend change (Call/Email deferred; cards tap through to the detail page).

**Tech Stack:** Next.js 16 App Router, React 19, TanStack Query, Tailwind v4 (semantic tokens), Vitest + Testing Library.

## Global Constraints
- **PRN-12:** tokens only. Brand glyph reuses AppShell's `stroke-*`/`fill-*` token classes; status pills reuse the shared `STATUS_PILL` map.
- **PRN-08 / SEC-05:** no query/scope/PII changes — the leads list payload is unchanged (no seller phone/email added). Cards render only what the list already returns.
- **DSN-03 / F-66:** the bottom tabs are the primary nav — **≥48px** targets. Each lead card is a full-width ≥44px tap area (whole card is the link).
- **Scope (owner):** F.1 = shell + leads cards only. Lead detail (mockup 05), Account page, territory chip/eyebrow, and the remaining touch-target/error quick-fixes (login/ToS buttons, NotificationBell/ThemeToggle top-bar size, NotesPanel "Add note") are **F.2**.
- **Status colors:** reuse the app-wide `STATUS_PILL` (admin↔portal consistency) rather than the mockup's one-off demo tones.
- **No new dependencies.**
- **ONE commit for F.1**, AFTER the owner walkthrough. Tasks end at "green".
- **Env/tooling:** unit tests SERIAL; always `pnpm typecheck`; lint CHANGED files.

## File Structure
- **Create** `src/components/PortalShell.tsx` — client chrome: top bar (brand + NotificationBell + ThemeToggle) + content region + bottom tabs; bare pass-through on login/tos; calls `useApplyTheme()` so the portal honors the theme pref.
- **Modify** `src/components/index.ts` — barrel-export `PortalShell`.
- **Create** `src/app/portal/layout.tsx` — `<PortalShell>{children}</PortalShell>`.
- **Modify** `src/app/portal/leads/page.tsx` — table → card list.
- **Modify** `src/app/portal/page.tsx` — drop the now-duplicate in-page `<h1>` + `NotificationBell` (the shell top bar owns them).
- **Create** `tests/unit/components/portal-shell.test.tsx`.

---

## Task 1: `PortalShell` (TDD) + layout

**Files:**
- Test: `tests/unit/components/portal-shell.test.tsx`
- Create: `src/components/PortalShell.tsx`, `src/app/portal/layout.tsx`
- Modify: `src/components/index.ts`

**Interfaces:**
- Produces: `PortalShell({ children }: { children: React.ReactNode })`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/portal-shell.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let mockPath = "/portal/leads";
vi.mock("next/navigation", () => ({ usePathname: () => mockPath }));

import { PortalShell } from "@/components";

function renderShell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PortalShell>
        <p>page body</p>
      </PortalShell>
    </QueryClientProvider>,
  );
}

describe("PortalShell", () => {
  it("F-66: renders the three bottom tabs as a labeled nav", () => {
    mockPath = "/portal/leads";
    renderShell();
    const nav = screen.getByRole("navigation", { name: "Portal" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Leads" })).toHaveAttribute("href", "/portal/leads");
    expect(screen.getByRole("link", { name: "Activity" })).toHaveAttribute("href", "/portal/activity");
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/portal");
  });

  it("marks the active tab from the URL", () => {
    mockPath = "/portal/leads";
    renderShell();
    expect(screen.getByRole("link", { name: "Leads" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Activity" })).not.toHaveAttribute("aria-current");
  });

  it("hides the shell chrome on the pre-auth login route", () => {
    mockPath = "/portal/login";
    renderShell();
    expect(screen.queryByRole("navigation", { name: "Portal" })).toBeNull();
    expect(screen.getByText("page body")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/components/portal-shell.test.tsx`
Expected: FAIL — `PortalShell` not exported.

- [ ] **Step 3: Implement `PortalShell`**

Create `src/components/PortalShell.tsx`:

```tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_NAME } from "@/lib/app";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";
import { useApplyTheme } from "@/lib/preferences";
import { cn } from "@/lib/cn";

// PortalShell (WP-F.1) — the partner-facing mobile chrome: a sticky top bar (brand +
// notifications + theme) and a sticky bottom tab bar (Leads / Activity / Account). A
// centered ≤520px column reads like an app on desktop and full-bleed on mobile. The
// pre-auth /portal/login + /portal/tos routes render bare (no chrome). Tokens only (PRN-12).

type Tab = { href: string; label: string; icon: React.ReactNode; active: (p: string) => boolean };

const stroke = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.85, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

const TABS: Tab[] = [
  { href: "/portal/leads", label: "Leads", active: (p) => p.startsWith("/portal/leads"),
    icon: <svg {...stroke} className="h-[22px] w-[22px]"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /></svg> },
  { href: "/portal/activity", label: "Activity", active: (p) => p.startsWith("/portal/activity"),
    icon: <svg {...stroke} className="h-[22px] w-[22px]"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg> },
  { href: "/portal", label: "Account", active: (p) => p === "/portal" || p.startsWith("/portal/devices"),
    icon: <svg {...stroke} className="h-[22px] w-[22px]"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6 8-6s8 2 8 6" /></svg> },
];

export function PortalShell({ children }: { children: React.ReactNode }) {
  useApplyTheme();
  const path = usePathname() ?? "";
  const bare = path === "/portal/login" || path === "/portal/tos";
  if (bare) return <>{children}</>;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[520px] flex-col border-border bg-bg md:border-x">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-border-soft bg-bg/85 px-4 py-3 backdrop-blur-md">
        <Link href="/portal/leads" className="flex items-center gap-2">
          <svg viewBox="0 0 34 34" fill="none" aria-hidden="true" className="h-7 w-7 shrink-0">
            <rect x="1.5" y="1.5" width="31" height="31" rx="7" className="stroke-text" strokeWidth="1.5" />
            <path d="M7 24 L14 12 L21 19 L27 9" className="stroke-brand" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="7" cy="24" r="2.4" className="fill-text" />
            <circle cx="27" cy="9" r="2.8" className="fill-brand" />
          </svg>
          <span className="font-display text-[0.95rem] font-semibold tracking-tight text-text">{APP_NAME}</span>
        </Link>
        <div className="ml-auto flex items-center gap-1">
          <NotificationBell />
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 px-4 pb-24 pt-4">{children}</main>

      <nav aria-label="Portal" className="sticky bottom-0 z-20 flex border-t border-border-soft bg-bg/90 px-2 pb-2 pt-1.5 backdrop-blur-md">
        {TABS.map((t) => {
          const on = t.active(path);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={on ? "page" : undefined}
              className={cn(
                "flex min-h-[48px] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] font-semibold transition-colors",
                on ? "text-brand-ink" : "text-text-3 hover:text-text",
              )}
            >
              {t.icon}
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
```

Add to `src/components/index.ts` (near `AppShell`):

```ts
export { PortalShell } from "./PortalShell";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/components/portal-shell.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Create the layout**

Create `src/app/portal/layout.tsx`:

```tsx
import * as React from "react";
import { PortalShell } from "@/components";

// WP-F.1: every /portal/* page renders inside the mobile PortalShell (top bar + bottom
// tabs). The shell itself renders bare on the pre-auth login/tos routes.
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell>{children}</PortalShell>;
}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: no errors. (Confirms `useApplyTheme`/`APP_NAME`/`cn` imports resolve and NotificationBell/ThemeToggle compose.)

---

## Task 2: Leads → cards + de-dupe home chrome

**Files:**
- Modify: `src/app/portal/leads/page.tsx`, `src/app/portal/page.tsx`

**Interfaces:**
- Consumes: `STATUS_PILL` from `@/components`; `cn` from `@/lib/cn`.

- [ ] **Step 1: Convert the leads table to a card list**

In `src/app/portal/leads/page.tsx`: change the imports to drop `Table, THead, TBody, Th, Tr, Td, Badge, CardHeader, CardTitle, CardBody` and add `STATUS_PILL`; add `import { cn } from "@/lib/cn";`. Keep `Card`? No — drop the outer Card; each lead is its own card. Final import line:

```tsx
import { Button, EmptyState, Skeleton, STATUS_PILL } from "@/components";
import { cn } from "@/lib/cn";
```

Replace the whole `return (…)` with:

```tsx
  return (
    <main className="mx-auto w-full max-w-[520px] flex-1">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-text">Your leads</h1>
          {total > 0 && <p className="text-[13px] text-text-3">{total} total</p>}
        </div>
        <a href="/api/portal/leads/export" download>
          <Button variant="secondary" size="lg">Export</Button>
        </a>
      </div>

      {error ? (
        <EmptyState title="Couldn't load your leads" description={(error as Error).message} />
      ) : isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      ) : leads.length === 0 ? (
        <EmptyState title="No leads yet" description="Leads assigned to you will appear here after the next upload." />
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {leads.map((l) => (
              <Link
                key={l.refId}
                href={`/portal/leads/${l.refId}`}
                className="block rounded-xl border border-border bg-surface p-4 shadow-sm transition-colors hover:border-text-3 hover:bg-surface-2 focus-visible:border-brand-ink"
              >
                <div className="flex items-center gap-2">
                  <span className="num text-[13px] text-text-3">{l.refId}</span>
                  <span className={cn("ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", STATUS_PILL[l.status] ?? "bg-surface-3 text-text-2")}>
                    {l.status}
                  </span>
                </div>
                <div className="mt-1.5 text-base font-semibold text-text">{l.address}</div>
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[13px] text-text-2">
                  <span>{l.city}, {l.state}</span>
                  <span className="num text-text-3">{l.zip}</span>
                  <span className="text-text-3">· {fmtDate(l.receivedAt)}</span>
                  {l.previouslyMatched && <span className="text-text-3">· returning</span>}
                </div>
              </Link>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between gap-3 text-[13px] text-text-3">
              <span>
                Page <span className="num">{page}</span> of <span className="num">{totalPages}</span> · <span className="num">{total}</span> leads
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" size="lg" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <Button variant="secondary" size="lg" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
```

(The `Lead` interface, `fmtDate`, and the `useQuery` block above stay unchanged.)

- [ ] **Step 2: De-dupe the portal home chrome**

In `src/app/portal/page.tsx`: the shell top bar now owns the brand + notifications, so remove the in-page title/bell header and drop the `NotificationBell` import. Change:

```tsx
import { Card, CardBody, CardHeader, CardTitle, NotificationBell } from "@/components";
```
→
```tsx
import { Card, CardBody, CardHeader, CardTitle } from "@/components";
```

and remove the header block:
```tsx
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-lg font-semibold text-text">Your portal</h1>
        <NotificationBell />
      </div>
```
Keep the `<main className="mx-auto w-full max-w-2xl flex-1 p-6">` wrapper and the `<Card>` link grid (this is the interim Account tab; its full reskin is F.2).

- [ ] **Step 3: Typecheck + full serial suite + lint**

Run: `pnpm typecheck`
Expected: no errors.

Run: `pnpm test:unit -- --no-file-parallelism`
Expected: all green (baseline + 3 new PortalShell tests).

Run: `pnpm exec eslint src/components/PortalShell.tsx src/components/index.ts src/app/portal/layout.tsx src/app/portal/leads/page.tsx src/app/portal/page.tsx`
Expected: no errors.

---

## Task 3: Screenshots · self-review · single commit

**Files:**
- Create (throwaway): `src/app/gallery/portal-preview/page.tsx`
- Delete before commit.

- [ ] **Step 1: Throwaway preview route**

Create `src/app/gallery/portal-preview/page.tsx` rendering the real `PortalShell` with mock lead-card content inside (the `?t=light|dark` setter). Because `PortalShell` uses `usePathname` (returns `/gallery/portal-preview` here → active tab won't match, which is fine for the visual), the tabs + top bar still render. Put 3–4 mock lead cards using the same card markup + `STATUS_PILL`. DELETE before commit.

- [ ] **Step 2: Dev server + screenshot mobile + desktop, both themes**

`preview_start` name `"web"`. Via Playwright MCP: resize to **375×812 (mobile)**, screenshot `…/gallery/portal-preview?t=light` and `?t=dark`; then resize to ~1000 wide and screenshot light (to confirm the centered ≤520px column reads on desktop). Verify: sticky top bar (brand + bell + theme), bottom tabs ≥48px with icons+labels, lead cards with status pills + address + meta, no console errors from our code, no horizontal scroll at 375px.

- [ ] **Step 3: Print the PLAYBOOK §6 self-audit checklist** (filled; n/a where inapplicable).

- [ ] **Step 4: Self-review the diff with agents (parallel)**

- `pr-reviewer` — correctness/spec/process; confirm the layout wraps all portal pages without a double-`<main>` (shell has the only `<main>`; pages that still carry their own `<main>` — activity/devices/lead-detail/leads/home — would double up, so VERIFY: the shell's `<main>` + a page `<main>` = two mains? Decide: either the shell uses a non-`<main>` container, or F.1 must strip page `<main>`s. **Resolve this before commit.**)
- `audit-design-system` — token discipline, status-pill reuse, theme parity, ≥48px tabs.
- `audit-a11y` — one `<main>` landmark per page, bottom-nav landmark + aria-current, tab target size (SC 2.5.5/AA-adjacent), focus visibility, bare-mode on login/tos.

Address findings (fix inline or defer). Re-run typecheck + serial suite after fixes.

> **KNOWN RISK to resolve in Step 4:** the shell renders `<main>` AND the portal pages each render their own `<main>`. Two `<main>` landmarks per page is an a11y violation. **Fix:** change the `PortalShell` content wrapper from `<main>` to a plain `<div>` (the pages keep their single `<main>`), OR strip `<main>` from every portal page. Preferred: shell uses `<div className="flex-1 ...">`, pages keep their `<main>`. Update Task 1 Step 3 + Task 2 Step 1 accordingly if pr-reviewer/a11y confirms.

- [ ] **Step 5: Delete throwaway preview route**

```bash
rm -rf src/app/gallery/portal-preview
```
Run `pnpm typecheck` again.

- [ ] **Step 6: Owner walkthrough** — present the mobile + desktop screenshots (both themes). Wait for approval BEFORE committing.

- [ ] **Step 7: ONE commit (after approval)**

```bash
git add src/components/PortalShell.tsx src/components/index.ts src/app/portal/layout.tsx src/app/portal/leads/page.tsx src/app/portal/page.tsx tests/unit/components/portal-shell.test.tsx docs/superpowers/plans/2026-07-11-wp-f1-portalshell-leads.md
git commit -m "feat(wp-f.1): PortalShell — mobile portal chrome + one-lead-per-card leads"
```

---

## Self-Review (plan vs. brief/decisions)
- PortalShell top bar + bottom tabs (Leads/Activity/Account), ≥48px tabs → Task 1 ✓
- Shell wraps all portal pages; bare on login/tos → Task 1 ✓
- Leads table → one-lead-per-card, tap-through (no Call/Email) → Task 2 ✓
- De-dupe home bell/h1 → Task 2 ✓
- Frontend-only, no API/PII change → whole plan ✓
- Two-theme + mobile screenshots, self-review, one commit → Task 3 ✓
- **Open item flagged for Step 4:** single-`<main>` resolution (shell `<div>` vs page `<main>`).

**Deferred to F.2:** lead detail (mockup 05); Account page (identity + Devices + sign-out); territory chip + partner eyebrow + true New count (needs a scoped partner-info endpoint); status-grouped sections; remaining F-66 touch targets (login/ToS buttons, top-bar bell/theme size, NotesPanel "Add note"); F-22 retry affordances.

**Placeholder scan:** none. **Type consistency:** `PortalShell({children})` matches the layout call; `STATUS_PILL[l.status]` keyed by the same status strings the API returns (SEED_LEAD_STATUSES).
