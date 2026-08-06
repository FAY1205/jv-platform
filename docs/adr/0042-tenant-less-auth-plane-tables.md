# ADR-0042 — Two auth-plane tables (`notice_claims`, `signup_codes`) are tenant-less by necessity

**Status:** Accepted (2026-08-07)
**Phase / WP:** recorded under WP-GOV-1 (audit R-23)
**Related:** SEAM-01, SCP-01, SEC-01, AUT-04 (WP-SU-16), SCP-06 (ADR-0040)

## Context

SCP-01 requires `tenant_id` on every table and a tenant-scoped RLS policy shipped in the same
migration (SEAM-01, DM-11). The project keeps a **closed exception list** of pre-tenant/auth-plane
tables that legitimately have no tenant scoping (`auth_attempts`, `reset_tokens`, `trusted_devices`,
`otp_challenges`), documented in `.claude/agents/audit-tenancy.md`; **adding to that list requires
an ADR.**

Two tenant-less tables were added without one (audit R-23): `notice_claims`
(migration 0028, reshaped in 0029) and `signup_codes` (migration 0030 — note the drizzle auto-name
`0030_tan_sentinels.sql` creates the `signup_codes` table; there is no `tan_sentinels` table). This
ADR records why each is tenant-less and formally reopens/extends the exception list.

## Decision

Accept `notice_claims` and `signup_codes` onto the tenant-less exception list. Both are **auth-plane
tables keyed on a global identifier before any tenant is known**, and both are **server-managed via
the service role with deny-by-default RLS**.

- **`notice_claims`** (AUT-04 / WP-SU-16): one atomic `(identifier, kind)` claim so that among N
  racing wrong-credential attempts exactly one wins the owner lockout-notification — a guarantee a
  read-then-write budget cannot make (CWE-367 / TOCTOU). `identifier` is the lowercased login email;
  **login is pre-tenant**, so there is no `tenant_id` to scope by.
- **`signup_codes`** (SCP-06 / ADR-0040): a single-use, 48h, hashed invitation code. It is
  **redeemed in order to create the tenant**, so no `tenant_id` exists at write/lookup time; the
  created tenant is recorded afterward in `used_by_tenant_id` purely as an audit trail.
- **RLS:** each table has RLS **enabled with no permissive policy** (deny-by-default, SEC-01). The
  `service_role` the server uses bypasses RLS; any `authenticated`/`anon` access is refused. This is
  the same posture the existing exception tables use.

*Alternative considered — force a `tenant_id`:* impossible without inventing a placeholder tenant
for pre-tenant records, which would defeat the point (the identifier/code is the key precisely
because no tenant exists yet) and weaken isolation rather than strengthen it.

## Consequences

- The exception list in `.claude/agents/audit-tenancy.md` is updated to include `notice_claims` and
  `signup_codes`, so the tenancy audit stops flagging them and future additions still require an ADR
  (the gate stays closed).
- Two accuracy notes recorded so the list isn't misread: (1) the list's label "pre-tenant auth
  tables" is loose — `trusted_devices` actually *does* carry a `tenant_id`; the accurate framing is
  "auth-plane / pre-session tables." (2) "deny-by-default RLS" means RLS enabled with **no** policy
  (service-role bypass only), not a restrictive policy.
- Any future admin auth-maintenance action on these tenant-less tables must first prove the target
  identifier resolves inside the caller's tenant and respond uniformly either way (the proposed
  AUT-16 discipline) — tracked separately, not built here.
