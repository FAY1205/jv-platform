# WP-PW-1 — Partner Portal Web: responsive shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the partner portal responsive — below `md` it renders exactly today's mobile chrome (top bar + bottom tabs, 520px); at `md` and up it renders an admin-style **left rail + top bar with the page title**, around the same page content.

**Architecture:** Evolve `src/components/PortalShell.tsx` into a single-render responsive shell (like `AppShell`): one DOM tree where `children` render **once**, wrapped by two breakpoint-exclusive nav chromes (mobile bottom-tabs `md:hidden`; desktop rail `hidden md:flex`). The desktop top-bar title comes from a pure `portalTitleForPath(pathname)` route→title map (no `usePageHeader` this slice — YAGNI; range/filter controls stay in-body). Each portal page's in-body page-title `<h1>` gets `md:hidden` so the desktop shows only the top-bar title. Mobile is visually unchanged.

**Tech Stack:** Next 16 (App Router, TS), React, TanStack Query v5, Tailwind v4 (CSS-first tokens), Vitest + jsdom + Testing Library.

## Global Constraints

- **PRN-12 (token discipline):** no hardcoded hex/font/product-name in component code — consume Survey semantic tokens (Tailwind `bg-*`/`text-*`/`border-*` utilities / `var(--token)`).
- **PRN-14:** never convey meaning by color alone — the active nav item carries a `bg-brand-soft` pill + `aria-current`, not color alone.
- **Mobile is untouched:** the `< md` layout, markup, and behavior of PortalShell stay byte-for-byte as shipped (bottom tabs, 520px column, bare `/portal/login` + `/portal/tos`).
- **`children` render exactly once** — never render the page content in two branches (would duplicate `<main>` landmarks and queries).
- **One `<main>` per page:** the shell's content region is a plain `<div>`, never `<main>` (pages own their `<main>`).
- **DSN-03:** every interactive element (nav links, icon buttons) implements default/hover/focus-visible/active states; reuse existing primitives (`NotificationBell`, `ThemeToggle`) which already do.
- **Test names carry requirement IDs:** e.g. `it("PW-01: maps /portal/leads to the Leads title")`.
- **Vitest runs SERIAL:** `pnpm test:unit -- --no-file-parallelism`. `pnpm typecheck` separately. Lint CHANGED files only (`npx eslint <files>`). Component tests need `// @vitest-environment jsdom` as the first line.
- **Cadence — ONE commit for this WP.** Execute all tasks in-session leaving green tests; stage everything and make a SINGLE commit only after explicit owner "go", and push only after a separate owner "go".

---

## File Structure

**New:**
- `src/lib/portal-nav.ts` — pure `portalTitleForPath(pathname): string | null` (route → desktop top-bar title; `null` for the bare login/tos routes). Client-safe, no imports.
- `tests/unit/portal-nav.test.ts` — unit tests for the map.
- `tests/unit/portal-shell.test.tsx` — component tests for the responsive shell.

**Modified:**
- `src/components/PortalShell.tsx` — restructure to the single-render responsive shell (mobile chrome `md:hidden` + desktop rail/top-bar `hidden md:*`), reusing the existing `TABS` array for both navs and `portalTitleForPath` for the desktop title. Adds a rail identity block (email initials + email, from `/api/me`) linking to `/portal`.
- `src/app/portal/leads/page.tsx:48` — `<h1 …>Your leads</h1>` → add `md:hidden`.
- `src/app/portal/activity/page.tsx` — its page-title `<h1>` → add `md:hidden` (verify the exact line during the task).
- `src/app/portal/page.tsx:25` — `<h1 …>Your account</h1>` → add `md:hidden`.
- `src/app/portal/devices/page.tsx:46` — `<h1 …>Your devices</h1>` → add `md:hidden`.
- `src/app/portal/dashboard/portal-dashboard.tsx:62` — the eyebrow `<h1 …>Your dashboard</h1>` → add `md:hidden` (desktop shows the top-bar "Dashboard"; the hero `<p>` headline stays).

**Not touched this slice:** page bodies (no layout restructure — that's WP-PW-2/3), `/api/*`, `src/app/portal/layout.tsx` (still just wraps `<PortalShell>`).

---

## Task 1: `portalTitleForPath` route→title map

**Files:**
- Create: `src/lib/portal-nav.ts`
- Test: `tests/unit/portal-nav.test.ts`

**Interfaces:**
- Produces: `portalTitleForPath(pathname: string): string | null`. Consumed by Task 2 (desktop top-bar title).

- [ ] **Step 1: Write the failing test** — `tests/unit/portal-nav.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { portalTitleForPath } from "@/lib/portal-nav";

describe("WP-PW-1 portalTitleForPath", () => {
  it("PW-01: maps the four sections to their titles", () => {
    expect(portalTitleForPath("/portal/dashboard")).toBe("Dashboard");
    expect(portalTitleForPath("/portal/leads")).toBe("Leads");
    expect(portalTitleForPath("/portal/activity")).toBe("Activity");
    expect(portalTitleForPath("/portal")).toBe("Account");
  });
  it("PW-01: maps detail/sub-routes to their section title", () => {
    expect(portalTitleForPath("/portal/leads/LD-26-00042")).toBe("Leads");
    expect(portalTitleForPath("/portal/activity?page=2")).toBe("Activity");
    expect(portalTitleForPath("/portal/devices")).toBe("Devices");
  });
  it("PW-01: returns null for the bare (chrome-less) routes", () => {
    expect(portalTitleForPath("/portal/login")).toBeNull();
    expect(portalTitleForPath("/portal/tos")).toBeNull();
  });
  it("PW-01: returns null for unknown routes", () => {
    expect(portalTitleForPath("/dashboard")).toBeNull();
    expect(portalTitleForPath("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/portal-nav.test.ts`
Expected: FAIL ("portalTitleForPath is not a function" / module missing).

- [ ] **Step 3: Implement `src/lib/portal-nav.ts`:**

```ts
// Map a /portal/* route to the desktop top-bar title (the admin PageHeader pattern,
// portal-flavored). Pure + client-safe: no window/router, strips query/hash. The bare
// login/tos routes render with no chrome, so they have no title. Detail routes fall back
// to their section title. `/portal` itself is the Account tab.
export function portalTitleForPath(pathname: string): string | null {
  const p = pathname.split("?")[0].split("#")[0];
  if (p === "/portal/login" || p === "/portal/tos") return null;
  if (p === "/portal/dashboard") return "Dashboard";
  if (p.startsWith("/portal/leads")) return "Leads";
  if (p.startsWith("/portal/activity")) return "Activity";
  if (p.startsWith("/portal/devices")) return "Devices";
  if (p === "/portal") return "Account";
  return null;
}
```

- [ ] **Step 4: Run it green**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/portal-nav.test.ts`
Expected: PASS.

---

## Task 2: `PortalShell` responsive shell

**Files:**
- Modify: `src/components/PortalShell.tsx` (whole component body)
- Test: `tests/unit/portal-shell.test.tsx`

**Interfaces:**
- Consumes: `portalTitleForPath` (Task 1); existing `TABS` array (already in the file); `NotificationBell`, `ThemeToggle`, `useApplyTheme` (already imported); `apiGet` from `@/lib/api` for the identity block.
- Produces: the same default-exported `PortalShell({ children })`. Consumed by `src/app/portal/layout.tsx` (unchanged).

Design notes:
- **Single render tree.** One outer `<div className="md:grid md:grid-cols-[248px_1fr] md:min-h-screen">`. `children` render ONCE inside the content column.
- **Desktop rail** (`<aside className="hidden md:flex …">`): brand mark (reuse the existing inline route-glyph SVG) → a `<nav aria-label="Portal">` listing the 4 `TABS` (icon + label; active = `bg-brand-soft text-brand-ink` + `aria-current="page"`; Leads may show a count later — not this slice) → an identity block pinned `mt-auto`: a `Link` to `/portal` showing an initials avatar + email (from `useIdentity()` below).
- **Content column** (`<div className="flex min-w-0 flex-col">`): the existing **mobile top bar** (`md:hidden`) + a new **desktop top bar** (`hidden md:flex` — `portalTitleForPath(path)` as an `<h1>` on the left, `NotificationBell` + `ThemeToggle` on the right) + the content `<div>` (`mx-auto w-full max-w-[520px] md:max-w-[1120px] border-x border-border md:border-0 flex-1`) wrapping `children` + the existing **mobile bottom tab `<nav>`** (`md:hidden`).
- **Bare routes** unchanged: `if (bare) return <>{children}</>;` stays first.
- **Identity**: a tiny `useIdentity()` using `useQuery(["me"], () => apiGet("/api/me"))` (same key the account page uses → TanStack dedupes; two `NotificationBell` instances also share their query key, so no double fetch). Render initials from the email; degrade to a skeleton/blank while loading (never throw).
- Reuse `TABS` for BOTH the desktop rail and the mobile bottom bar (single source of truth).

- [ ] **Step 1: Write the failing test** — `tests/unit/portal-shell.test.tsx`:

```tsx
// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/leads" }));
vi.mock("@/lib/api", () => ({ apiGet: vi.fn(async () => ({ email: "ops@meridianbuyers.com", role: "partner", workspace: { name: "Meridian Buyers" } })) }));
// Stub the chrome children so the shell test doesn't pull in their own queries/effects.
vi.mock("@/components/NotificationBell", () => ({ NotificationBell: () => <button aria-label="Notifications" /> }));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => <button aria-label="Toggle theme" /> }));

import { PortalShell } from "@/components/PortalShell";

function renderShell(children: React.ReactNode = <main>page body</main>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{<PortalShell>{children}</PortalShell>}</QueryClientProvider>);
}

describe("WP-PW-1 PortalShell (responsive)", () => {
  // NOTE: jsdom loads no compiled Tailwind CSS, so `md:hidden`/`hidden md:flex` don't
  // hide anything — BOTH the desktop rail nav and the mobile bottom-tab nav are in the DOM
  // (and both are labelled "Portal"). Query at the screen level and assert counts >= 1
  // rather than through a single "Portal" navigation landmark.
  it("PW-02: renders a nav link for each of the four sections (rail + tabs)", () => {
    renderShell();
    for (const label of ["Dashboard", "Leads", "Activity", "Account"]) {
      expect(screen.getAllByRole("link", { name: new RegExp(label, "i") }).length).toBeGreaterThan(0);
    }
  });

  it("PW-02: shows the route-derived page title in a heading", () => {
    renderShell();
    // /portal/leads → "Leads" title in the desktop top bar
    expect(screen.getByRole("heading", { name: "Leads" })).toBeTruthy();
  });

  it("PW-02: marks the active section with aria-current", () => {
    renderShell();
    const active = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
    expect(active.some((a) => /leads/i.test(a.textContent ?? ""))).toBe(true);
  });

  it("PW-02: renders the page children exactly once (no duplicate main)", () => {
    renderShell(<main>page body</main>);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByText("page body")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/portal-shell.test.tsx`
Expected: FAIL (current PortalShell has no `navigation` named "Portal" / no route title heading).

- [ ] **Step 3: Restructure `src/components/PortalShell.tsx`.** Replace the returned JSX (keep the imports, `TABS`, `stroke`, `bare` guard) with the single-render responsive tree. Full new component body:

```tsx
export function PortalShell({ children }: { children: React.ReactNode }) {
  useApplyTheme();
  const path = usePathname() ?? "";
  const bare = path === "/portal/login" || path === "/portal/tos";
  if (bare) return <>{children}</>;

  const title = portalTitleForPath(path);
  const identity = useQuery({ queryKey: ["me"], queryFn: () => apiGet<MeResponse>("/api/me") });
  const email = identity.data?.email ?? "";
  const initials = email.slice(0, 2).toUpperCase();

  const brand = (
    <span className="flex items-center gap-2">
      <svg viewBox="0 0 34 34" fill="none" aria-hidden="true" className="h-7 w-7 shrink-0">
        <rect x="1.5" y="1.5" width="31" height="31" rx="7" className="stroke-text" strokeWidth="1.5" />
        <path d="M7 24 L14 12 L21 19 L27 9" className="stroke-brand" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="7" cy="24" r="2.4" className="fill-text" /><circle cx="27" cy="9" r="2.8" className="fill-brand" />
      </svg>
      <span className="font-display text-step-3 font-semibold tracking-tight text-text">{APP_NAME}</span>
    </span>
  );

  return (
    <div className="md:grid md:min-h-screen md:grid-cols-[248px_1fr]">
      {/* ===== Desktop left rail (≥ md) ===== */}
      <aside className="hidden md:flex md:sticky md:top-0 md:h-screen md:flex-col border-r border-border bg-surface px-3 py-4">
        <Link href="/portal/dashboard" className="px-2 pb-4">{brand}</Link>
        <nav aria-label="Portal" className="flex flex-col gap-1">
          {TABS.map((t) => {
            const on = t.active(path);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-step-2 font-semibold transition-colors",
                  on ? "bg-brand-soft text-brand-ink" : "text-text-2 hover:bg-surface-2 hover:text-text",
                )}
              >
                {t.icon}
                {t.label}
              </Link>
            );
          })}
        </nav>
        <Link href="/portal" className="mt-auto flex items-center gap-3 rounded-lg border-t border-border-soft px-2 pt-3 hover:bg-surface-2">
          <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand text-step-1 font-bold text-brand-contrast">{initials}</span>
          <span className="min-w-0">
            <span className="block truncate text-step-1 font-semibold text-text">{email || "Account"}</span>
            <span className="block text-step-0 text-text-3">View account</span>
          </span>
        </Link>
      </aside>

      {/* ===== Content column ===== */}
      <div className="flex min-w-0 flex-col">
        {/* Mobile top bar (< md) — UNCHANGED from the shipped shell */}
        <header className="md:hidden sticky top-0 z-20 mx-auto flex w-full max-w-[520px] items-center gap-2 border-b border-border-soft bg-bg/85 px-4 py-2 backdrop-blur-md">
          <Link href="/portal/dashboard" className="flex items-center gap-2">{brand}</Link>
          <div className="ml-auto flex items-center gap-1"><NotificationBell /><ThemeToggle /></div>
        </header>

        {/* Desktop top bar (≥ md) — page title + tools */}
        <header className="hidden md:flex sticky top-0 z-20 items-center gap-3 border-b border-border-soft bg-bg/85 px-6 py-2 backdrop-blur-md">
          {title && <h1 className="font-display text-lg font-semibold tracking-tight text-text">{title}</h1>}
          <div className="ml-auto flex items-center gap-1"><NotificationBell /><ThemeToggle /></div>
        </header>

        {/* Page content — renders ONCE */}
        <div className="mx-auto w-full max-w-[520px] flex-1 border-x border-border md:max-w-[1120px] md:border-0">
          {children}
        </div>

        {/* Mobile bottom tabs (< md) — UNCHANGED from the shipped shell */}
        <nav aria-label="Portal" className="md:hidden sticky bottom-0 z-20 mx-auto flex w-full max-w-[520px] border-t border-border-soft bg-bg/90 px-2 pb-2 pt-1.5 backdrop-blur-md">
          {TABS.map((t) => {
            const on = t.active(path);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "flex min-h-[48px] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg text-step-1 font-semibold transition-colors",
                  on ? "bg-brand-soft text-brand-ink" : "text-text-3 hover:text-text",
                )}
              >
                {t.icon}
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
```

Add the needed imports at the top of the file (some already present): `import Link from "next/link";` (present), `import { usePathname } from "next/navigation";` (present), `import { useQuery } from "@tanstack/react-query";`, `import { apiGet } from "@/lib/api";`, `import { portalTitleForPath } from "@/lib/portal-nav";`, `import { cn } from "@/lib/cn";` (present), `import { APP_NAME } from "@/lib/app";` (present). Add a local type near the top: `type MeResponse = { email: string; role: string; workspace: { name: string } };` (matches the `/api/me` shape the account page consumes).

Note: the two mobile nav blocks (`md:hidden`) are lifted verbatim from the current component so the mobile view is byte-identical; only the wrapping structure changed and the desktop rail/top-bar were added. Confirm against `git diff` that no mobile class changed.

- [ ] **Step 4: Run it green**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/portal-shell.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: clean (confirm the `MeResponse` type + `apiGet` generic compile).

---

## Task 3: Hide in-body page titles on desktop

**Files:**
- Modify: `src/app/portal/leads/page.tsx:48`, `src/app/portal/activity/page.tsx` (its `<h1>`), `src/app/portal/page.tsx:25`, `src/app/portal/devices/page.tsx:46`, `src/app/portal/dashboard/portal-dashboard.tsx:62`
- Test: (covered by an assertion added to `tests/unit/portal-shell.test.tsx` is not possible — these are page files; verify by reading the diff + the desktop screenshot in the walkthrough)

Rationale: on desktop the top bar now shows the page title, so each page's in-body page-title `<h1>` must be hidden `≥ md` to avoid a duplicate heading. On mobile it stays. This is a one-class change per page; **no other page markup changes** this slice.

- [ ] **Step 1: Add `md:hidden` to each page-title `<h1>`.** For each file, add `md:hidden` to the existing `<h1>`'s className. Examples:

`src/app/portal/leads/page.tsx:48`:
```tsx
<h1 className="font-display text-xl font-semibold tracking-tight text-text md:hidden">Your leads</h1>
```
`src/app/portal/page.tsx:25`:
```tsx
<h1 className="mb-4 font-display text-xl font-semibold tracking-tight text-text md:hidden">Your account</h1>
```
`src/app/portal/devices/page.tsx:46`:
```tsx
<h1 className="mb-4 font-display text-xl font-semibold tracking-tight text-text md:hidden">Your devices</h1>
```
`src/app/portal/dashboard/portal-dashboard.tsx:62` (the eyebrow h1):
```tsx
<h1 className={`font-semibold uppercase tracking-[.08em] text-text-3 md:hidden ${label13}`}>Your dashboard</h1>
```
For `src/app/portal/activity/page.tsx`: open the file, find its page-title `<h1>` (the one rendering the "Your activity"/section heading), and append `md:hidden` the same way. If activity has **no** in-body `<h1>`, skip it (nothing to hide) and note that in the commit.

- [ ] **Step 2: Typecheck + lint the changed files**

Run: `pnpm typecheck`
Run: `npx eslint src/lib/portal-nav.ts src/components/PortalShell.tsx src/app/portal/leads/page.tsx src/app/portal/page.tsx src/app/portal/devices/page.tsx src/app/portal/dashboard/portal-dashboard.tsx src/app/portal/activity/page.tsx tests/unit/portal-nav.test.ts tests/unit/portal-shell.test.tsx`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Full unit suite (serial)**

Run: `pnpm test:unit -- --no-file-parallelism`
Expected: all green (existing count + the 2 new files). No portal test regressions.

---

## Verification (before the walkthrough)

- **Both themes, both breakpoints** via the running dev server + computed-style/DOM readback (in-app screenshots may stall — the documented environment issue): at `≥ md` the left rail + top-bar title render and the mobile bottom-tab `nav` is `display:none`; at `< md` the rail is `display:none` and the bottom tabs show; the page `<main>` appears once; the in-body page-title `<h1>` is hidden at `md`. Resize to confirm the mobile view is pixel-identical to `origin/phase-2/distribution`.
- `/portal/login` and `/portal/tos` still render bare (no rail, no tabs).

## Reviews (mandatory)

- `pr-reviewer` (always) + `audit-design-system` + `audit-a11y` (UI: nav landmarks, single visible `<h1>` per breakpoint, `aria-current`, focus-visible, token discipline, mobile-parity). **Flag for a11y:** both navs share `aria-label="Portal"` — only one is ever visible (the other is `display:none` per breakpoint, so it drops out of the a11y tree), which is acceptable; if the reviewer disagrees, differentiate the labels (e.g. keep "Portal" on the visible-per-breakpoint one).
- Owner walkthrough with the desktop + mobile views (both themes) before committing.

## Self-audit + commit

- Run the PLAYBOOK §6 self-audit; print the filled checklist in the summary.
- ONE commit for WP-PW-1 after explicit owner "go"; push after a separate "go".

---

## Deliverable

After WP-PW-1: the portal is responsive — desktop gets the admin-style left rail + top-bar title; mobile is unchanged. Page **bodies** are not yet restyled for desktop (they render in the wider column as-is) — that's WP-PW-2 (Dashboard) and WP-PW-3 (Leads table + Activity/Account).
