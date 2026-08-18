# ADR-0047: Portal data routes are scope-gated, not partner-role-gated

- **Status:** Accepted (2026-08-17)
- **Date:** 2026-08-17
- **Phase / WP:** CRM hardening / candidate C-4 (WP-TSK-3 audit-tenancy F-9)

## Context

`/api/portal/*` are the partner-facing data routes. Unlike the admin surfaces —
which call `requireAdminResponse(scope)` to 403 a non-admin (`src/lib/auth/guard.ts`)
— the portal routes carry **no equivalent role gate**. They authenticate the caller,
enforce ToS acceptance (`requireTosResponse`, F-04/LGL-01), and then hand the resolved
`ScopeContext` to the query layer, which filters by tenant + partner ownership
(PRN-08). There is no `requirePartnerResponse`.

The audit (WP-TSK-3, audit-tenancy F-9) did not find a leak. It found **silence**: the
code never states who these routes are for, so a future change could alter admin
reachability without anyone noticing the intent was deliberate. This ADR records the
intent so the silence is no longer the risk.

What actually happens when an **admin** scope reaches a portal route today: the partner
reads compose on one predicate, `visibleLeadsWhere(scope)` (`src/modules/portal/queries.ts`),
which is `leadWhere(scope)` + kept + not-soft-deleted, and applies the distribution
hold (`releasedLeads()`) **only** when `scope.role === "partner"`. For an admin,
`leadWhere` scopes to the admin's own tenant, so the admin gets an ordinary
admin-scoped, tenant-bounded read through partner-shaped code. No other partner's
private view is surfaced as the admin's; nothing crosses a tenant boundary. Portal-scope
tests and a possible future "admin previews the partner portal" affordance both rely on
this pass-through being harmless.

## Decision

Portal data routes are **scope-gated, not partner-role-gated**. The audience is recorded
here rather than enforced with a partner-only guard.

- The security boundary for `/api/portal/*` is the scope guard (PRN-08) plus the ToS
  gate — the same boundary that separates the two streams everywhere else in the app.
  Tenant + partner-ownership scoping, not a role check, is what keeps one partner from
  seeing another's data.
- An **admin** scope reaching a portal route is **intentional and safe**: it degrades to
  an admin-scoped, tenant-bounded read. This is the defense-in-depth posture, not an
  oversight, and it keeps the admin-preview-portal path open.
- **Rejected: add `requirePartnerResponse` to `/api/portal/*`.** A partner-only gate
  would 403 admins, breaking portal-scope tests that exercise admin pass-through and
  foreclosing admin-preview-portal — all to close a gap that is documentation, not a
  leak. The distribution hold already keys on `scope.role === "partner"`, so partner-only
  semantics that *matter* are already expressed where they belong (in the query), not at
  the route edge.

## Consequences

- **Easier:** the intent is now explicit; a reviewer touching a portal route has a
  recorded answer to "should an admin be able to read this?" (yes, by design).
- **Harder:** nothing today. If a future portal route ever needs to be *genuinely*
  partner-only (e.g. it exposes something an admin must not read even within their own
  tenant), that route adds its own guard and this ADR is the place to note the exception.
- **Reopens this** if the `authenticated`/PostgREST surface ever becomes load-bearing
  beyond the current owner-connection architecture (ADR-0013), or if an
  admin-preview-portal feature is explicitly cut — at which point the pass-through's
  value disappears and a partner-only guard becomes cheap. Related: C-27 (RLS
  admin/partner author asymmetry) tracks the DB-layer side of the same surface.

## Amendment — Phase C (2026-08-18): pass-through is capability-checked, not unconditional

The original safety argument — "an **admin** scope degrades to an admin-scoped,
tenant-bounded read" — was tier-specific and does not generalize. Phase C introduces
admin-stream tiers (`member`/`viewer`) whose whole point is that they are *not* allowed
everything an admin is; an unconditional pass-through would have handed a read-only
viewer the full-tenant seller-PII export via `/api/portal/leads/export` and a tenant-wide
status write via the portal status route (audit-tenancy WP-ROLE-1a F-1).

The decision stands for partners and is amended for staff:

- A **partner** still passes on scope alone — no tier check; partners hold no capability
  by construction and the scope guard (PRN-08) remains their boundary.
- An **admin-stream** caller flowing through a portal route must now hold the same
  capability the equivalent admin surface requires: `requirePassthroughResponse(scope, cap)`
  (`src/lib/authz.ts`) — `leads.read` for portal reads, `leads.write` for the status
  write, `data.export` for the export. An admin holds all of these, so admin
  pass-through (and the future admin-preview-portal affordance) is unchanged.
- The shared notes/tasks routes (the other role-gate-free surface) carry the same gate:
  `leads.read` on reads, `work.write` on writes (F-2).
- Conformance is mechanical, not remembered: `tests/unit/route-gate-conformance.test.ts`
  (AUTHZ-06) asserts every `getServerScope` route names one of the tier gates or sits on
  a reasoned allowlist.
