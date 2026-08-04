# WP-B — AppShell + Shell Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Reskin the app shell to the Survey identity — route-glyph brand mark, regrouped nav (Route/Review/Network/Admin) with count badges, a sidebar user block, and one canonical topbar cluster (title/actions slot · expanding search · bell · theme) — without touching any page body.

**Architecture:** Extract three small shell components (`PageHeader` context+slot, `SearchExpand`, `ThemeToggle`), relocate `ProfileMenu` into a sidebar user block, and re-assemble `AppShell`. Add a tenant-scoped `leadsCount` for the Leads nav badge. Spec: `docs/superpowers/specs/2026-07-11-wpb-appshell-design.md`.

**Tech Stack:** Next 16 App Router · React 19 · Tailwind v4 · TanStack Query · Radix DropdownMenu · vitest + Testing Library.

## Global Constraints

- PRN-12: tokens only — brand-mark colors via `stroke-*`/`fill-*` Tailwind utilities (`stroke-text`, `stroke-brand`), never hex.
- PRN-08: `leadsCount` filters through `tenantWhere(scope)`; the route is admin-guarded like `unmatched/count`.
- PRN-15 / §6.17: nav counts via TanStack Query only; the one prefs store (`usePreferences`) drives theme/nav — no server data in component state.
- DSN-03: every new interactive element (SearchExpand, ThemeToggle, user block) ships default/hover/focus-visible/active states.
- DIRECTION: no shell chrome text below ~13px; radii snapped to tokens (F-63).
- No page body is edited (touch-each-page-once is WP-E). No new dependency.
- One commit for the WP, gated by PLAYBOOK §6 self-audit + pr-reviewer + owner walkthrough. Tasks end at "verify green".
- Gate: `pnpm run typecheck && pnpm run lint && pnpm run test:unit`.

---

### Task 0: Green baseline

- [ ] **Step 1:** `pnpm run test:unit` → confirm 421/421 green before starting.

---

### Task 1: `leadsCount` query + `/api/leads/count` route

**Files:**
- Modify: `src/modules/leads/queries.ts` (add `leadsCount` after `unmatchedCount`, ~line 315)
- Create: `src/app/api/leads/count/route.ts`

**Interfaces:** Produces `leadsCount(scope: ScopeContext): Promise<number>` and `GET /api/leads/count → { count: number }`.

- [ ] **Step 1:** Add the query (mirrors `unmatchedCount`, tenant-scoped):

```ts
/** Total lead count for the workspace — drives the Leads nav badge. Tenant-scoped (PRN-08). */
export async function leadsCount(scope: ScopeContext): Promise<number> {
  const db = getDb();
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.leads).where(tenantWhere(scope));
  return Number(row?.n ?? 0);
}
```

- [ ] **Step 2:** Create the route (byte-mirror of `src/app/api/leads/unmatched/count/route.ts`, swapping the query):

```ts
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { leadsCount } from "@/modules/leads/queries";
import { jsonOk, jsonError } from "@/lib/http";

// Lightweight total-leads count for the nav badge. Admin-only (PRN-08).
export async function GET() {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    return jsonOk({ count: await leadsCount(scope) });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("leads_count_failed", "Failed to count leads", 500);
  }
}
```

- [ ] **Step 3:** `pnpm run typecheck` → clean. (Query behavior is covered by the integration DB suite the same way `unmatchedCount` is; the nav-badge render is unit-tested in Task 6.)

---

### Task 2: `PageHeader` context + slot

**Files:** Create `src/components/PageHeader.tsx`; Test `tests/unit/components/page-header.test.tsx`; export from `src/components/index.ts`.

**Interfaces:** Produces `PageHeaderProvider`, `usePageHeader(value: { title?: React.ReactNode; actions?: React.ReactNode })`, and `PageHeaderSlot` (reads context, renders title as `<h1>` + actions).

- [ ] **Step 1: Failing test.**

```tsx
import { render, screen } from "@testing-library/react";
import { PageHeaderProvider, PageHeaderSlot, usePageHeader } from "@/components/PageHeader";

function Page({ title }: { title?: string }) {
  usePageHeader({ title });
  return null;
}

describe("DSN: PageHeader slot", () => {
  it("DSN-PH-01: renders a title a page provides, else nothing", () => {
    const { rerender } = render(
      <PageHeaderProvider><PageHeaderSlot /><Page title="Leads" /></PageHeaderProvider>,
    );
    expect(screen.getByRole("heading", { name: "Leads" })).toBeInTheDocument();
    rerender(<PageHeaderProvider><PageHeaderSlot /><Page /></PageHeaderProvider>);
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
```

- [ ] **Step 2:** Run `pnpm exec vitest run tests/unit/components/page-header.test.tsx` → FAIL (module missing).

- [ ] **Step 3: Implement.**

```tsx
"use client";
import * as React from "react";

type Header = { title?: React.ReactNode; actions?: React.ReactNode };
type Ctx = { header: Header; set: (h: Header) => void };
const PageHeaderContext = React.createContext<Ctx | null>(null);

export function PageHeaderProvider({ children }: { children: React.ReactNode }) {
  const [header, set] = React.useState<Header>({});
  return <PageHeaderContext.Provider value={{ header, set }}>{children}</PageHeaderContext.Provider>;
}

/** A page declares its topbar title/actions; cleared on unmount. Safe no-op outside a provider. */
export function usePageHeader(value: Header) {
  const ctx = React.useContext(PageHeaderContext);
  const { title, actions } = value;
  React.useEffect(() => {
    if (!ctx) return;
    ctx.set({ title, actions });
    return () => ctx.set({});
  }, [ctx, title, actions]);
}

/** The topbar's title/actions region. Renders nothing until a page provides a title. */
export function PageHeaderSlot() {
  const ctx = React.useContext(PageHeaderContext);
  const { title, actions } = ctx?.header ?? {};
  if (!title && !actions) return null;
  return (
    <div className="flex min-w-0 items-center gap-3">
      {title && <h1 className="truncate font-display text-lg font-semibold tracking-tight text-text">{title}</h1>}
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
```

- [ ] **Step 4:** Run the test → PASS. Add to `index.ts`: `export { PageHeaderProvider, PageHeaderSlot, usePageHeader } from "./PageHeader";`

---

### Task 3: `SearchExpand` component

**Files:** Create `src/components/SearchExpand.tsx`; Test `tests/unit/components/search-expand.test.tsx`; export from `index.ts`.

**Interfaces:** Produces `SearchExpand` — a collapsed icon that expands to a field; ⌘K expands+focuses; submit → `/leads?q=`.

- [ ] **Step 1: Failing test** (mock the router):

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { SearchExpand } from "@/components/SearchExpand";
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("DSN: SearchExpand", () => {
  it("DSN-SR-01: expands on click and routes to /leads on submit", () => {
    render(<SearchExpand />);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "98101" } });
    fireEvent.submit(input.closest("form")!);
    expect(push).toHaveBeenCalledWith("/leads?q=98101");
  });
});
```

- [ ] **Step 2:** Run → FAIL (missing module).

- [ ] **Step 3: Implement** (all states; ⌘K listener; Escape/empty-blur collapses):

```tsx
"use client";
import * as React from "react";
import { useRouter } from "next/navigation";

export function SearchExpand() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const s = q.trim();
    router.push(s ? `/leads?q=${encodeURIComponent(s)}` : "/leads");
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        aria-label="Search"
        onClick={() => { setOpen(true); requestAnimationFrame(() => inputRef.current?.focus()); }}
        className="grid h-9 w-9 place-items-center rounded-md border border-transparent text-text-2 transition-colors hover:border-border hover:bg-surface active:scale-95"
      >
        <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="flex h-9 w-full max-w-[300px] items-center gap-2.5 rounded-md border border-border bg-surface px-3 text-text-3 focus-within:border-brand-line">
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input
        ref={inputRef}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        onBlur={() => q.trim() === "" && setOpen(false)}
        placeholder="Search leads, partners, ZIP codes…"
        aria-label="Search leads"
        className="w-full bg-transparent text-sm text-text outline-none placeholder:text-text-3"
      />
      <kbd className="num hidden rounded-xs border border-border px-1.5 text-[0.8125rem] text-text-3 sm:inline">⌘K</kbd>
    </form>
  );
}
```

- [ ] **Step 4:** Run → PASS. Add to `index.ts`: `export { SearchExpand } from "./SearchExpand";`

---

### Task 4: `ThemeToggle` component

**Files:** Create `src/components/ThemeToggle.tsx`; Test `tests/unit/components/theme-toggle.test.tsx`; export from `index.ts`.

**Interfaces:** Produces `ThemeToggle` — cycles `system → light → dark` via `setPreferences`.

- [ ] **Step 1: Failing test:**

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { setPreferences, DEFAULT_PREFERENCES } from "@/lib/preferences";

describe("DSN: ThemeToggle", () => {
  beforeEach(() => setPreferences(DEFAULT_PREFERENCES));
  it("DSN-TH-01: advances the theme preference on click", () => {
    render(<ThemeToggle />);
    const btn = screen.getByRole("button", { name: /theme/i });
    fireEvent.click(btn); // system → light
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement:**

```tsx
"use client";
import * as React from "react";
import { usePreferences, setPreferences, nextTheme, type ThemePref } from "@/lib/preferences";

const ICON: Record<ThemePref, React.ReactNode> = {
  system: <path d="M4 5h16v11H4zM8 20h8M12 16v4" />,
  light: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" /></>,
  dark: <path d="M20 14.5A8 8 0 019.5 4 7 7 0 1020 14.5z" />,
};
const NEXT_LABEL: Record<ThemePref, string> = { system: "light", light: "dark", dark: "system" };

export function ThemeToggle() {
  const { theme } = usePreferences();
  return (
    <button
      type="button"
      aria-label={`Theme: ${theme}. Switch to ${NEXT_LABEL[theme]}`}
      onClick={() => setPreferences({ theme: nextTheme(theme) })}
      className="grid h-9 w-9 place-items-center rounded-md border border-transparent text-text-2 transition-colors hover:border-border hover:bg-surface active:scale-95"
    >
      <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {ICON[theme]}
      </svg>
    </button>
  );
}
```

- [ ] **Step 4:** Run → PASS. Add to `index.ts`: `export { ThemeToggle } from "./ThemeToggle";`

---

### Task 5: `ProfileMenu` → sidebar user block

**Files:** Modify `src/components/ProfileMenu.tsx`; Test `tests/unit/components/ws7-components.test.tsx` (update existing ProfileMenu case).

**Interfaces:** `ProfileMenu` renders a full-width user block (avatar + name/email + role) as the `DropdownMenuTrigger`; menu opens `side="top"`; content gains "Help & guides", drops the Theme item.

- [ ] **Step 1:** Update the trigger to a sidebar block + fix avatar AA (`bg-surface-3 text-text-2`, not `bg-brand text-white`):

```tsx
<DropdownMenuTrigger asChild>
  <button type="button" aria-label="Account menu"
    className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-3">
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-3 text-[0.8125rem] font-semibold text-text-2">
      {email ? initialsFromEmail(email) : "…"}
    </span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-semibold text-text">{email || "Account"}</span>
      {data && <span className="block truncate text-[0.8125rem] capitalize text-text-3">{data.role}</span>}
    </span>
  </button>
</DropdownMenuTrigger>
```

- [ ] **Step 2:** `DropdownMenuContent` → `side="top" align="start" className="min-w-[224px]"`; remove the Theme `DropdownMenuItem` (now in the topbar); add Help before Sign out:

```tsx
<DropdownMenuItem asChild><Link href="/dev/emails">Help &amp; guides</Link></DropdownMenuItem>
```

- [ ] **Step 3:** Update the ws7 ProfileMenu test: it now finds the account trigger by name and asserts the menu shows Settings + Help & guides + Sign out and **no** "Theme:" item. Run `pnpm exec vitest run tests/unit/components/ws7-components.test.tsx` → PASS.

---

### Task 6: `AppShell` reskin (integration)

**Files:** Modify `src/components/AppShell.tsx`; Test `tests/unit/components/appshell.test.tsx` (new — asserts the exported nav structure, no fragile full render).

**Interfaces:** Consumes Tasks 1–5. Exports `NAV_SECTIONS` for testing.

- [ ] **Step 1: Failing test on the regrouped nav:**

```tsx
import { NAV_SECTIONS } from "@/components/AppShell";
describe("F-63: shell nav", () => {
  it("F-63: groups the rail by the weekly job — Route/Review/Network/Admin", () => {
    expect(NAV_SECTIONS.map((s) => s.label)).toEqual(["Route", "Review", "Network", "Admin"]);
    const route = NAV_SECTIONS[0].items.map((i) => i.href);
    expect(route).toEqual(["/dashboard", "/leads"]);
    expect(NAV_SECTIONS[1].items.map((i) => i.href)).toEqual(["/unmatched", "/imports"]);
  });
});
```

- [ ] **Step 2:** Run → FAIL (`NAV_SECTIONS` not exported / wrong grouping).

- [ ] **Step 3: Regroup + export** `NAV_SECTIONS`, add the Leads badge marker:

```ts
export const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  { label: "Route", items: [
    { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
    { href: "/leads", label: "Leads", icon: "leads", badge: "leads" },
  ]},
  { label: "Review", items: [
    { href: "/unmatched", label: "Unmatched", icon: "unmatched", badge: "unmatched" },
    { href: "/imports", label: "Imports", icon: "runs" },
  ]},
  { label: "Network", items: [
    { href: "/partners", label: "Partners", icon: "partners" },
    { href: "/coverage", label: "Coverage", icon: "coverage" },
  ]},
  { label: "Admin", items: [
    { href: "/rules", label: "Rules", icon: "rules" },
    { href: "/activity", label: "Activity", icon: "activity" },
    { href: "/settings", label: "Settings", icon: "settings" },
  ]},
];
```
Update `NavItem`: `badge?: "leads" | "unmatched"`.

- [ ] **Step 4: Brand mark** — replace the `JV` tile block (lines ~135-138) with the route-glyph (tokens via `stroke-*`/`fill-*`):

```tsx
<Link href="/dashboard" onClick={onNavigate} className="flex items-center gap-2.5 px-2 pb-5">
  <svg viewBox="0 0 34 34" fill="none" aria-hidden="true" className="h-[30px] w-[30px] shrink-0">
    <rect x="1.5" y="1.5" width="31" height="31" rx="7" className="stroke-text" strokeWidth="1.5" />
    <path d="M7 24 L14 12 L21 19 L27 9" className="stroke-brand" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="7" cy="24" r="2.4" className="fill-text" />
    <circle cx="27" cy="9" r="2.8" className="fill-brand" />
  </svg>
  <span className="min-w-0">
    <span className="block truncate font-display text-[0.95rem] font-semibold tracking-tight">{APP_NAME}</span>
    <span className="block text-[0.8125rem] text-text-3">Operations</span>
  </span>
</Link>
```

- [ ] **Step 5: Add the Leads count query + render both badges.** Near the `unmatched` query add:

```tsx
const leads = useQuery({
  queryKey: ["leads", "count"],
  queryFn: () => apiGet<{ count: number }>("/api/leads/count"),
  staleTime: 30_000,
});
const leadsTotal = leads.data?.count ?? 0;
```
In the item render, replace the single unmatched-badge block with:

```tsx
{item.badge === "unmatched" && unmatchedCount > 0 && (
  <span className="num ml-auto rounded-full bg-warn-soft px-1.5 py-0.5 text-[0.8125rem] font-semibold text-warn" aria-label={`${unmatchedCount} unmatched`}>{unmatchedCount}</span>
)}
{item.badge === "leads" && leadsTotal > 0 && (
  <span className="num ml-auto rounded-full bg-surface-3 px-1.5 py-0.5 text-[0.8125rem] font-semibold text-text-2" aria-label={`${leadsTotal} leads`}>{leadsTotal.toLocaleString()}</span>
)}
```

- [ ] **Step 6: Snap group labels + nav radii; place `ProfileMenu` at the foot** (replacing the Help link). Group label: `text-[0.8125rem]` (was `.62rem`). Nav link `rounded-[11px]` → `rounded-md`; icon-hover animation kept. Replace the `mt-auto` Help block with:

```tsx
<div className="mt-auto border-t border-border-soft pt-2"><ProfileMenu /></div>
```
Import `ProfileMenu` from `./ProfileMenu`.

- [ ] **Step 7: Topbar** — wrap the shell content in `<PageHeaderProvider>` (around the whole returned tree) and rebuild the `<header>` right of the menu button:

```tsx
<button ref={menuBtnRef} … menu button (rounded-md) … />
<PageHeaderSlot />
<div className="ml-auto flex items-center gap-2">
  <SearchExpand />
  <NotificationBell />
  <ThemeToggle />
</div>
```
Remove the old `<form onSubmit={submitSearch}>` block and the AppShell-level ⌘K `useEffect` + `submitSearch`/`search`/`searchRef` (moved into `SearchExpand`). Import `PageHeaderProvider, PageHeaderSlot, SearchExpand, ThemeToggle` from `@/components` (or relative).

- [ ] **Step 8:** Run the nav test + typecheck:
`pnpm exec vitest run tests/unit/components/appshell.test.tsx` → PASS; `pnpm run typecheck` → clean.

---

### Task 7: Barrel exports + full verification

- [ ] **Step 1:** Confirm `index.ts` exports `PageHeaderProvider/PageHeaderSlot/usePageHeader`, `SearchExpand`, `ThemeToggle`.
- [ ] **Step 2:** `pnpm run typecheck && pnpm run lint && pnpm run test:unit` → all green (expect 421 + the 4 new tests). Note any integration DB failures are the known env pool issue.
- [ ] **Step 3:** Sanity-grep no stray `text-white` on brand in shell files: `pnpm exec grep -rn "bg-brand text-white" src/components/AppShell.tsx src/components/ProfileMenu.tsx` → no matches.

---

## Post-plan (session-level)

1. PLAYBOOK §6 self-audit — printed.
2. pr-reviewer on the diff; fix findings.
3. Owner walkthrough of the new shell.
4. Single WP-B commit after 1–3.

## Self-Review (against spec)

- §2 sidebar → Tasks 4/5/6 (brand mark, nav, badges, user block). §3 topbar → Task 6.7 (cluster) + Tasks 3/4. §4 PageHeader → Task 2. §5 SearchExpand → Task 3. §6 ProfileMenu → Task 5. §7 token-snap → Task 6 (labels/radii). §2 leadsCount → Task 1. All covered.
- Placeholders: none — full code for every new file; anchored edits for AppShell/ProfileMenu.
- Type consistency: `NavItem.badge: "leads" | "unmatched"`; `usePageHeader({title,actions})` ↔ `PageHeaderSlot`; `leadsCount(scope)` ↔ route. Names consistent.
