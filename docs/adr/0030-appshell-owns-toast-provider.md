# ADR-0030: AppShell owns the ToastProvider

- **Status:** Accepted
- **Date:** 2026-07-15
- **Phase / WP:** Phase 2 / WP-TOAST-1 (bugfix)

## Context

`useToast` (UXQ-03: optimistic UI with rollback + toast on failure, FEP-05) throws
`useToast must be used within <ToastProvider>` when no provider is above it. Mounting that
provider was left to each page, which held only while every `useToast` caller was a
component the page author could see.

It stopped holding once `useToast` moved into shared leaves. `LeadDialog`
(`src/app/leads/lead-dialog.tsx`) and `StatusSelect` (`src/components/StatusSelect.tsx`)
both call it, and a page composes them with no signal that it has taken on a provider
requirement. Two pages shipped broken as a result:

- **`/imports/[ref]`** — `RunView` also called `useToast` directly, so it threw on first
  render and the whole run-detail page fell to the Next error boundary. Every import,
  seeded or fresh; found in live testing 2026-07-15.
- **`/partners/[id]`** — mounts `LeadDialog`, so it threw only when a lead row was
  opened. Latent and unreported; found while fixing the first.

Both pages already rendered `<AppShell>`. Five other pages each mounted their own
provider, duplicating a decision none of them owned. Doing nothing leaves the next page
that drops in a shared leaf to fail the same way, at interaction time, in production.

## Decision

Mount `ToastProvider` inside `AppShell`, wrapping `PageHeaderProvider` and the whole
shell tree — the shell is the composition root for every admin page, and already owns
app-level context (`PageHeaderProvider`).

- `AppShell` renders exactly one `ToastProvider`; the toast live region is the shell's.
- Admin pages do **not** mount a `ToastProvider`. The five that did — `leads/leads-view`,
  `rules`, `partners`, `unmatched`, `settings/layout` — had theirs removed; nesting a
  second one would render a duplicate `role="status"` live region and double-announce
  (PRN-14 relies on a single announcement channel).
- Surfaces outside `AppShell` keep owning their own: `/gallery` mounts one directly (it
  renders no shell), and `/portal/*` uses `PortalShell` and has no toast consumer today.
  A portal toast consumer means mounting the provider in `PortalShell`, not in a page.

Alternatives considered:

- **Patch the two broken pages** — smallest diff, but preserves the footgun: it fixes the
  two known instances and not the class.
- **Mount in the root `layout.tsx` / `Providers`** — would cover portal and gallery too,
  but toast is an admin-shell affordance, not app-wide; it would put a live region on the
  pre-auth login/tos routes, and `Providers` is deliberately the server-data seam
  (TanStack Query, FEP-01).
- **Make `useToast` return a no-op when unprovided** — removes the crash by hiding it;
  failed mutations would silently stop reporting, which is worse than a loud boundary.

## Consequences

Easier: any admin page can use `useToast`, or compose a leaf that does, with nothing to
remember — the class of bug is gone for everything under `AppShell`. Five duplicate
provider mounts are gone with it.

Harder: `AppShell` grows another responsibility, and toast is now shell-coupled — a
future admin view that renders outside `AppShell` (a full-screen takeover, a print view)
must mount its own provider, exactly as `/gallery` does. Tests that render a bare
component calling `useToast` still need their own wrapper; only shell renders get it free.

Reopens if: the admin and portal shells merge, or toast is needed on a pre-auth route —
either would argue for moving it up to `Providers`.

Follow-ups: none blocking. `tests/unit/components/appshell-toast.test.tsx` (UXQ-03) pins
both halves — the provider is present, and there is exactly one live region.
