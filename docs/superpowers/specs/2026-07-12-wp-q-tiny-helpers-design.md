# WP-Q — tiny-helpers bundle (cleanup menu slice B3)

**Date:** 2026-07-12
**Branch:** phase-2/distribution
**Tier:** B (design-system consolidation: 1 helper + 1 new primitive + 1 variant)

## Problem

Three small pieces of hand-rolled markup are duplicated across admin + portal:

1. **Status pill** — the base pill classes (`num inline-flex items-center rounded-full
   px-2.5 py-0.5 text-xs font-semibold`) + `STATUS_PILL[x] ?? "bg-surface-3 text-text-2"`
   are hand-rolled in both `StatusSelect.tsx` (interactive trigger) and
   `src/app/portal/leads/page.tsx:80` (static display pill). `STATUS_PILL` lives inside the
   `"use client"` StatusSelect.
2. **Tappable card Link** — the portal leads card (`portal/leads/page.tsx`, whole-card
   `<Link>`) and the account rows (`portal/portal-account.tsx` LINKS) share the same
   card chrome (`rounded-xl border border-border bg-surface transition-colors
   hover:border-text-3 hover:bg-surface-2 focus-visible:border-brand-ink`).
3. **Embedded map-error** — two identical raw `<div role="status" className="grid h-full
   place-items-center px-4 text-center text-sm text-text-3">Territory map unavailable.</div>`
   at `partners/[id]/page.tsx:242` and `portal/dashboard/portal-dashboard.tsx:121`.

## Decisions (owner)

1. **Extract to a lib module** — `src/lib/status-pill.ts`, pure/non-client.
2. **One flexible `LinkCard`** — a styled `next/link` owning the shared chrome (children + className).
3. **`compact` variant on the existing EmptyState** (not a new component).

**Review follow-up (owner "best practice"):** `PILL_BASE` **drops `.num`** — the ledger
monospace was applied to word status labels (a pre-existing misuse the extraction inherited);
status labels now render in the UI font, matching the `Badge` primitive. Reserved `.num` for
actual numerics. Also folded in during review: the 3rd embedded map-error (admin dashboard
`Coverage map unavailable.`) → compact EmptyState; `LinkCard` gains the DSN-03 `active` press
state; test IDs cite `DSN-03`/`DSN-06`.

## Design

### 1. `src/lib/status-pill.ts` (new, pure — no "use client")
```ts
import { cn } from "@/lib/cn";

export const STATUS_PILL: Record<string, string> = {
  New: "bg-surface-3 text-text-2",
  Contacted: "bg-brand-soft text-brand-ink",
  Appointment: "bg-warn-soft text-warn",
  "Under contract": "bg-prev-soft text-prev",
  Closed: "bg-success-soft text-success",
  Dead: "bg-danger-soft text-danger",
};

/** Shared status-pill base (shape/size); color comes from STATUS_PILL. */
const PILL_BASE = "num inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold";

/** Full className for a status pill: base + status color (fallback for unknown) + optional extra. */
export function statusPillClass(status: string, extra?: string): string {
  return cn(PILL_BASE, STATUS_PILL[status] ?? "bg-surface-3 text-text-2", extra);
}
```
- `StatusSelect.tsx`: delete the local `STATUS_PILL`; import `{ statusPillClass }`; trigger
  className → `cn(statusPillClass(val), "cursor-pointer gap-1 outline-none focus-visible:ring-1 focus-visible:ring-brand-ink disabled:opacity-60")`.
  (`statusPillClass` already supplies `inline-flex items-center`; the trigger adds cursor/gap/focus/disabled.)
- `src/components/index.ts`: remove the `STATUS_PILL` re-export from the `./StatusSelect` line
  (no external consumer remains once portal-leads switches).
- `src/app/portal/leads/page.tsx`: import `{ statusPillClass }` from `@/lib/status-pill`;
  pill → `className={statusPillClass(l.status, "ml-auto")}`.

### 2. `src/components/LinkCard.tsx` (new)
```tsx
import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

export type LinkCardProps = React.ComponentPropsWithoutRef<typeof Link>;

// Shared tappable-card chrome. Deliberately NO display utility — callers set block/flex,
// so there is no display-class conflict via cn() (which doesn't dedupe).
const base =
  "rounded-xl border border-border bg-surface transition-colors " +
  "hover:border-text-3 hover:bg-surface-2 focus-visible:border-brand-ink";

export const LinkCard = React.forwardRef<HTMLAnchorElement, LinkCardProps>(function LinkCard(
  { className, children, ...props },
  ref,
) {
  return (
    <Link ref={ref} className={cn(base, className)} {...props}>
      {children}
    </Link>
  );
});
```
- Barrel-export from `src/components/index.ts`.
- `portal/leads/page.tsx`: the whole-card `<Link>` → `<LinkCard href={…} className="block p-4 shadow-sm">…`.
- `portal/portal-account.tsx`: each LINKS `<Link>` → `<LinkCard href={l.href} className="flex min-h-[52px] flex-col justify-center px-4 py-2.5">…`.

### 3. EmptyState `compact` variant
```tsx
export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** Compact inline/embedded status (e.g. a map error filling its container). */
  compact?: boolean;
  className?: string;
}
```
- When `compact`: render
  `<div role="status" className={cn("grid h-full place-items-center gap-1 px-4 text-center", className)}>`
  with `<p className="text-sm text-text-3">{title}</p>` + optional `<p className="text-xs text-text-3">{description}</p>`.
  No icon circle, no action. Non-compact path unchanged.
- `partners/[id]/page.tsx:242` + `portal/dashboard/portal-dashboard.tsx:121`:
  raw div → `<EmptyState compact title="Territory map unavailable." />`.

## Tests (TDD)
- `tests/unit/status-pill.test.ts` (pure): known status → base + its color; unknown → base +
  fallback; `extra` appended; `PILL_BASE` present.
- LinkCard render (in `tests/unit/components/…`): renders an `<a>` with `href`, merges a
  consumer className alongside the base chrome, forwards ref to the anchor, no `display` class in base.
- EmptyState compact render: `compact` → `role="status"` + title text, no icon circle;
  non-compact still renders the icon slot + action (regression).

## Gallery
- Add a `LinkCard` card (a block content card + a label/hint row) with a states note.
- Add a `compact` EmptyState example beside the existing EmptyState usage.
- `statusPillClass` is a helper, not a component — no dedicated card (its pills already
  render via the StatusSelect card).

## Out of scope
- Admin leads table-cell `<a>` links (`leads-view.tsx`) — a table-cell link, not a card.
- StatusSelect internals beyond the helper swap; SEED_LEAD_STATUSES; the pill color values.

## Verification
- `pnpm exec vitest run tests/unit/status-pill.test.ts <linkcard/emptystate files> --no-file-parallelism` green;
  full unit suite green serial; `pnpm typecheck` clean; eslint changed files clean.
- Computed-style/readback (or /gallery): LinkCard hover/focus chrome intact; the two map
  errors render as `role="status"` with the same text.
- Self-audit: PLAYBOOK §6 printed. Agents: **pr-reviewer** + **audit-design-system**
  (MANDATORY — primitive/token discipline) + **audit-frontend-arch** (client/server boundary
  of the new lib module + LinkCard). One commit; owner "go" before commit AND push.
