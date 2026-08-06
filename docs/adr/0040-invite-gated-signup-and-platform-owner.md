# ADR-0040 — Invitation-code-gated signup + a platform-owner tier

**Status:** Accepted (2026-08-07)
**Amends:** SCP-02; adds SCP-06 (invite-gated signup) and SCP-07 (platform-owner tier) to SPEC.
**Supersedes (in part):** ADR-0033 (public open self-serve signup) — the "reachable by anyone" premise.

## Context

ADR-0033 opened **public self-serve admin signup**: anyone could create a new isolated tenant +
its first admin, protected only by CAPTCHA (ADR-0034), IP rate-limiting, and enumeration-safe
timing (AUT-05). It explicitly accepted "a larger public attack surface … account creation is now
reachable by anyone" as the cost.

That premise was reversed in code but never recorded: signup now **requires a single-use
invitation code**, and the codes are minted by a new **platform-owner** tier that sits outside the
tenant-scoped `admin`/`partner` role model. Two governance gaps resulted: `SPEC.md:22` (SCP-02)
still says "public self-serve admin signup is open (ADR-0033)", and **23 code sites cite
requirement id "SCP-03"** for the invite/owner feature — but SCP-03 is *external dependencies /
US-region residency*, so the id is squatted and traces to the wrong requirement (audit R-07). This
ADR records the shipped decisions and points the new SCP-06/SCP-07 ids at them.

## Decision

**1. Gate self-serve signup behind a single-use invitation code (SCP-06).**

- `POST /api/auth/signup` requires an `inviteCode`. The gate is validated against `signup_codes`
  (lookup by hash), and the code is **consumed atomically inside the provisioning transaction** — a
  conditional `used_at IS NULL` update makes it single-use even under a concurrent race; losing the
  race rolls the whole signup back (`provision-signup.ts`).
- **Codes:** Crockford-base32, 12 chars (`XXXX-XXXX-XXXX`), **SHA-256-hashed at rest** (hash-only,
  unique hash index — mirrors the signup-token pattern; a hash, not a slow KDF, is sufficient for a
  high-entropy single-use secret), **48-hour TTL** (`SIGNUP_CODE_TTL_MS`), verified with a
  constant-time compare (AUT-09). `normalizeCode` folds case/dashes and O→0, I/L→1 before hashing.
- **Gate ordering** (deliberate): the invite-code check sits **after** the per-identifier/per-IP
  throttle and the global signup ceiling (so code-guessing is rate-limited, ~20/15min per IP) and
  **before** the HIBP breached-password lookup (so a bad code stays cheap — no external work). It is
  independent of whether the email exists, so it leaks nothing about accounts (AUT-05).
- **Issuance:** the owner-only `POST/GET/DELETE /api/platform/signup-codes` API and the
  `settings/invitations` page mint / list / revoke codes; the plaintext code is shown exactly once.
- `signup_codes` (migration 0030) is **tenant-less by necessity** (redeemed before any tenant
  exists) and **deny-by-default under RLS** — see ADR-0042.

*Alternative considered — keep open signup + rely on CAPTCHA/rate-limits (the ADR-0033 posture):*
rejected. This is a low-volume B2B tool with a human onboarding step; an invite code removes the
public account-creation surface entirely rather than merely slowing it.

**2. Authorize code issuance via a platform-owner tier keyed on an environment allowlist (SCP-07).**

- There is no platform-super-admin *role* (roles stay tenant-scoped `admin`|`partner`). "Owner" =
  a tenant admin whose email is in the `ADMIN_ALLOWLIST` env var (`isPlatformOwner` /
  `isCallerPlatformOwner`, which also requires `role === "admin"` and resolves the caller's email
  tenant-scoped, PRN-08).
- The tier gates **only** the platform surfaces: the signup-code API (mint/list/revoke), a cosmetic
  "Invitations" nav reveal (the route re-checks), and an `isPlatformOwner` flag on `/api/me`. It
  grants **no cross-tenant data access** — the only non-tenant-scoped resource it touches is the
  `signup_codes` table, which holds no tenant business data.

*Alternative considered — a database role/column for platform-owner:* rejected for V1. The
`ADMIN_ALLOWLIST` env list already exists (it receives the platform alert mails and was the V1
admin-provisioning list), so reusing it needs no migration, no bootstrap chicken-and-egg, and keeps
owner identity out of tenant data. A DB-backed owner registry becomes worthwhile only when
ownership must be self-managed in-app — a future WP, not V1.

## Consequences

- Public account creation is closed; a new customer needs a code from the platform owner. Signup
  keeps its CAPTCHA + rate-limit + uniform-timing defences (ADR-0033/0034 remain in force for the
  parts not reversed here).
- The platform-owner tier is an **email-vs-allowlist** check that lives outside `getServerScope`;
  every owner-only route re-checks server-side. Rotating owners is an env change (a deploy), not an
  in-app action — acceptable at V1 scale, revisited if self-managed ownership is needed.
- SPEC: **SCP-02 amended** (partner accounts invite-only *and* admin signup now invite-gated);
  **SCP-06 / SCP-07 added**; the 23 squatted "SCP-03" code/test sites re-tagged to SCP-06 (code
  mechanism) / SCP-07 (owner gate), with the two owner-only invitation *surfaces* citing both. The
  doc/ADR references to SCP-03 that genuinely mean *hosting region* stay SCP-03.
- Retention: `signup_codes` is swept by the auth-table retention job (48h TTL + single-use burn).
