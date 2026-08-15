# ADR-0045: Saved views are per-user data; admin-only is a product gate, not the visibility rule

- **Status:** Accepted (2026-08-16)
- **Date:** 2026-08-16
- **Phase / WP:** CRM-3 / WP-SV-1 (SV-01..05)

## Context

`saved_views` (migration 0043) introduces an isolation axis this codebase did not have.
Every other table is scoped by tenant, by partner org, or by author ROLE. A saved view
is owned by one PERSON: two admins share a tenant, share the admin role, and must not
see each other's view menu (the owner decision at mockup sign-off — shared/team views
are explicitly out of v1).

That makes two different rules easy to confuse, and the confusion is the risk:

1. **Visibility** — a row belongs to `tenant_id` AND `user_id`. This is the boundary.
2. **Availability** — saved views are an ADMIN feature in v1, because a partner's portal
   has no admin-leads filter state to save. This is a product decision about who gets
   the feature at all.

Written as code they look alike (both are "a check before the query"), so a later
session could plausibly enforce the product rule in the policy, or delete the visibility
rule while "opening the feature up to partners". Only the second is a leak, and it is
the kind of leak no cross-tenant probe catches: it leaks sideways, WITHIN a tenant, to a
colleague of the same role.

## Decision

- **The visibility rule is the per-user pin, and it lives in three places at once:**
  `ownerWhere(saved_views, user_id, scope)` in the module (lib/scope.ts, shared with
  `notifications`), the RLS policy `saved_views_scope` pinning
  `tenant_id = app_current_tenant() AND user_id = app_current_user()` on BOTH halves,
  and the fact that `user_id` is only ever written from a `ScopeContext` — never from a
  request body (the Zod contracts are strict and 400 a smuggled `userId`).
- **The RLS policy does NOT pin `app_current_role() = 'admin'`.** The per-user pin
  already means no session can read or write a row that is not its own, whatever its
  role. Writing the product gate into the policy would create a rule that has to be
  RELAXED to ship the next feature, and a policy you expect to loosen is a policy that
  gets loosened carelessly.
- **The product gate lives at the route (`requireAdminResponse`) and in the module
  (`assertAdmin`, raising `SavedViewScopeError`).** Duplicated on purpose: the route is
  the HTTP answer, and the module guard means a future un-gated caller cannot silently
  create partner-owned rows in a table nobody audits for partner rows.
- **The tenant/user pair is app-enforced, not FK-enforced.** A composite FK would need
  `UNIQUE (id, tenant_id)` on `users`; it is not warranted because both columns come
  from one `ScopeContext` on the single write path, and every read AND-s both halves, so
  a mismatched pair matches nothing rather than matching the wrong person — it fails
  closed.

### The trigger (the reason this ADR exists)

**If the user pin is EVER relaxed — shared/team views, partner-facing views, an
"organization views" feature — a role arm MUST land in `saved_views_scope` in the SAME
migration that relaxes it.** The moment `user_id = app_current_user()` stops being the
boundary, role becomes the boundary, and there is no third thing holding the line.

Correspondingly: `assertAdmin` in `modules/saved-views` becomes a role ARM (admin views
here, partner views there) — it is never simply DELETED. Deleting it while widening the
policy is the exact sequence that turns a personal bookmark table into a cross-role read.

## Consequences

Easier: the predicate is one shared builder, so the per-user axis has one definition and
a change reaches `notifications` too; the RLS policy is short enough to assert exactly
(the tests count `app_current_tenant()` and `app_current_user()` occurrences per half
rather than substring-matching). Harder: nothing prevents an admin from being unable to
hand a colleague a view — the answer in v1 is "re-create it", which is acceptable for a
filter bookmark and is the thing shared views would fix.

Reopened if: shared/team views are decided (the trigger above fires), partner-facing
views are decided (a portal filter blob plus a role arm — the blob schema is composed
from the ADMIN leads validators today and would need its own), or a per-user retention
question arrives (`saved_views.filters.q` can hold seller text an admin searched for —
tracked as a candidate against WP-RET-3/C-13).
