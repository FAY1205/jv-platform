# ADR-0049: Fixed staff tiers with tenant-configurable capabilities

- **Status:** Accepted (2026-08-18)
- **Date:** 2026-08-18
- **Phase / WP:** Phase C (Roles, Permissions & Team) / WP-ROLE-1..3, WP-TEAM-1
- **Companion design docs:** the Phase C role-model recommendation + §11 amendment (session
  scratchpad, summarized here — this ADR is the durable record).

## Context

The app shipped with a hard role binary (`admin` | `partner`) and one gate
(`requireAdminResponse`). Phase C needs real staff roles and a team page, and the owner
requires permissions to be **configurable, with defaults set**. Twenty CRM was the reference:
per-workspace role rows with coarse capability booleans and an `isEditable` flag (its system
Admin role is locked). Two hazards shaped the design: `scope.role` comparisons are **data-shape
selectors** (a naïvely-added role would fall down the partner arm of the scope builders), and
`author_role` is the PRN-13 stream boundary in RLS.

## Decision

1. **Two axes.** STREAM (PRN-13, binary forever): admin-stream staff vs partner. Every
   data-shape decision keys on `isPartnerStream(scope)`; note/task writes stamp
   `streamOf(scope)`; `author_role` stays a two-value enum. TIER (allow/deny): `admin`,
   `member`, `viewer` — enum values on `users.role`; enforcement via the capability seam
   (`src/lib/authz.ts`: 13 cluster-grained capabilities, `can()` /
   `requireCapabilityResponse()` / `requirePassthroughResponse()` for the ADR-0047 portal
   pass-through). Application code compares role literals only inside the seam files
   (AUTHZ-04 ban test).
2. **The workspace owner is a pointer, not a role.** `tenants.owner_user_id` → the tenant's
   root admin seat; backfilled to the earliest admin, set at signup provisioning for new
   tenants. Owner-only invariants live in the team handlers: only the owner touches admin
   seats or transfers ownership; nobody demotes/deactivates the owner. Named **"workspace
   owner"** everywhere — never bare "owner" — to keep it apart from ADR-0040's env-allowlist
   **"platform owner"** (mechanism untouched).
3. **Configurable capabilities, three bands.** `role_capabilities (tenant_id, role,
   capabilities jsonb, PK(tenant_id, role))` — one row per CONFIGURED tier; a missing row
   means the live code defaults (`DEFAULT_TIER_CAPABILITIES`); reset-to-defaults = DELETE the
   row; **no seed, no backfill** (a tenant that never opened the editor keeps tracking
   default improvements). Bands: **always-on** (`leads.read`, `views.own` — lockout-proof
   floor), **tenant-editable** (`leads.write`, `work.write`, `ingest.run`, `runs.void`,
   `data.export`, `rules.manage`, `partners.manage`, `ai.use`), **admin-locked**
   (`team.manage`, `settings.manage`, `ops.admin` — the permissions editor itself and
   lateral-escalation surfaces; structurally ungrantable). `effectiveCapabilities(tier,
   stored|null)` = `(stored ∩ editable) ∪ always-on` is the ONE normalizer: the write side
   (PATCH /api/admin/team/permissions) Zod-REJECTS locked/unknown keys loudly; the read side
   strips them silently. Admin is locked-full and never consults storage (Twenty's
   `isEditable=false` analog). The tier names are default descriptions, not contracts —
   a tenant granting viewer `data.export` is exercising its own governance (audited).
4. **Resolution.** `getServerScope` LEFT JOINs `role_capabilities` onto the live users-row
   read (one round trip); `resolveScope` attaches the normalized set for member/viewer only,
   refuses deactivated seats (`users.deactivated_at` — the PTL-01 twin), refuses unknown role
   values, and refuses a non-partner row carrying a `partner_id` (SCP-08 — also a DB CHECK:
   `(role='partner') = (partner_id IS NOT NULL)`). Effects bind next-request; no session
   invalidation on role/permission change (deactivation DOES revoke devices + ban).
5. **RLS backstop.** Policies generalize the staff arm as an **allowlist**
   (`app_current_role() = ANY ('admin','member','viewer')` — SCP-09: name what you ADMIT; an
   unknown claim value is denied, matching `resolveScope`). The backstop's job stays stream +
   tenant isolation; tier read-only-ness is app-layer (ADR-0013; write DML is revoked from
   `authenticated` anyway, 0045/0046). The one kept `<> 'partner'`: the `lead_status_history`
   author subquery compares ENUM-typed `users.role` and must not name a new enum value in the
   same migration batch; an enum column is never NULL, so it denies safely.
6. **team_invites** joins the ADR-0042 auth-plane posture (deny-all RLS, owner-connection
   only, token SHA-256-hashed at rest, AUT-09 verify) — recorded here as the exception-list
   addition. It ships WITH a retention sweep (expiry-anchored + margin) per the SET-08 rule
   this PR's audit minted: an auth-plane table storing emails/credential hashes ships its
   sweep in the same PR.
7. **NOT a DM-08 rules table.** `role_capabilities` configures who may call which endpoints;
   it never enters the pipeline or affects what a re-run would produce (PRN-01/PRN-05
   untouched). No rules snapshot; the append-only `audit_log` before/after entries
   (`team.permissions_changed`, ACT-04-visible) are its history. Do not "fix" this into the
   snapshot chain.

## Explicitly rejected

- Custom role creation / permissions tables (revisit: ≥2 paying tenants concretely blocked by
  the fixed matrix; the upgrade path is generalizing `role_capabilities.role` to a role-row
  FK — the seam survives).
- Per-user overrides; per-member lead visibility (a new scoping axis — its own project).
- A DB capability catalog (the code union IS the catalog; a DB copy is a second truth).
- Expressing capabilities in RLS (dynamic-policy machinery; backstop stays stream+tenant).
- Seeding/backfilling `role_capabilities`; per-toggle autosave in the editor.
- An `owner` enum value (backfill ambiguity, RLS/JWT surface, polarity surface).

## Consequences

- **New-capability rule:** a stored row is an explicit choice over the then-known set. Every
  future capability addition must state its backfill posture for configured tenants
  (default-off is the safe default); the AUTHZ-07 band-partition test fails the build on an
  unclassified key.
- Owner decisions 1/2/4/6 of the Phase C list (member upload/AI, viewer notes, member
  export) demote from policy calls to **default** calls — a tenant flips them itself.
- The client capability list (`/api/me` → `useCurrentUser().canDo`) may lag until refetch;
  the server gate is authoritative.
- Hard-delete paths for `users` must release the owner pin first
  (`tenants.owner_user_id` is ON DELETE RESTRICT): signup-sweep and `deprovisionAdmin` do.
