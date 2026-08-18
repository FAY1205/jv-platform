# Security audit — double JWT verify (WP-PERF-AUTH / C-42)

Date: 2026-08-18 · Scope: `src/proxy.ts`, `src/lib/scope-context.ts`, `src/lib/supabase/*`,
`src/lib/auth/*` · Auditor: `audit-security` (OWASP ASVS + spec AUT/SEC) · Gate: Tier A (auth) —
**owner greenlight + the dashboard preconditions below required before any code merge.**

## Why this exists

Every `/api/*` request verifies the auth JWT **twice over the network**: `proxy.ts`
(middleware) calls `supabase.auth.getUser()` (a GoTrue round trip that also refreshes/rotates the
token), then the route's `getServerScope()` calls `supabase.auth.getUser()` **again** before it
reads the authoritative `users`/`partners` rows. Two GoTrue RTTs per request is a constant latency
tax on every screen (and compounds on the assistant path). C-42 proposed removing one; this audit
was the gate on doing so.

## Verdict

| Option | Verdict |
|---|---|
| **A — local verify** (`getClaims()` in the route, keep the edge `getUser()`) | ✅ **Safe with mitigations — RECOMMENDED** |
| **B — trust a middleware-set identity header in the route** | ❌ **Unsafe — reject** (spoofable; a new trust boundary against the RLS-bypass model, for zero extra benefit over A) |

**Why A is sound in THIS app:** `getServerScope` already re-reads the authoritative `users` row
(tenant/role) and, for partners, the `partners` lifecycle (PTL-01) from Postgres on **every**
request. So tenant/role/partner revocation is already immediate and independent of GoTrue — the
route's second `getUser()` only re-checks a signature the edge verified microseconds earlier. Under
ADR-0013 the app bypasses RLS (table-owner connection), so that DB identity resolution is the SOLE
tenant gate — and Option A does not weaken it.

## Recommended change (Option A, route-only)

1. **(Owner, dashboard) Enable asymmetric JWT signing keys** (ECC P-256) on the Supabase project.
   **Critical:** `getClaims()` only verifies **locally** once the project uses asymmetric keys;
   with today's HS256 tokens it *silently falls back to a network `getUser()`* (behaviour-identical,
   but **zero latency win**). So the code swap must not merge before the keys are on, or it does
   nothing. Rollout is graceful (the legacy HS secret stays a standby key; old tokens use the
   network fallback until they expire/refresh).
2. **(Owner, dashboard) Confirm the access-token TTL is ≤ 1h** (AUT-13) — it bounds the residual
   window below; not in the repo (no `supabase/config.toml`).
3. **(Code) Change ONLY `getServerScope`** (`src/lib/scope-context.ts`) from `getUser()` to
   `getClaims()`, reading the subject from `data.claims.sub`; keep the live `users`/`partners` DB
   resolution unchanged (that is what enforces PRN-08/PTL-01). Cache the JWKS module-level so the
   hot path never fetches it.
4. **(Code) Leave `proxy.ts` on the network `getUser()`** — it keeps token refresh, the live
   ban/session check, and the ADR-0032 outage semantics. Net: **2 network verifies → 1** (at the edge).
5. **Reject Option B.**

## Residual risk the owner must accept

- **A ≤1h post-revocation window on the access token itself:** after a logout-elsewhere or
  password reset, an already-issued access token stays valid at the *route* until it expires (≤1h).
  **This window exists today** (access tokens are stateless; AUT-14 revokes the *refresh* token, not
  the access token). Keeping the edge `getUser()` closes it on the next navigation and on refresh.
  Immediate role/tenant/partner revocation is **unaffected** (enforced by live DB reads). Nothing in
  the app requires sub-minute access-token revocation.
- **SDK-version dependency:** the local-verify safety (HS256 / `alg:none` bounced to the network
  fallback, JWKS-by-`kid`, `exp` checked) is a property of `@supabase/supabase-js` 2.112.3. The
  alg-confusion tests below must gate every future SDK bump.

## Tests that MUST exist before merge

- **Local-verify-no-network:** with asymmetric keys, `getServerScope` resolves a scope from a valid
  token while the network `getUser` path is stubbed to throw — proves no GoTrue call on the hot path.
- **Alg-confusion rejection (ASVS V3.5.3):** an `alg:none` token and an HS256 token re-signed with the
  public key are both rejected (→ `UnauthenticatedError`).
- **Expired-token rejection:** a signature-valid but expired token → `UnauthenticatedError`.
- **Wrong-key / cross-project token** (`kid` not in JWKS) → rejected.
- **Behaviour-preserving swap (PRN-08):** a scope resolved via `getClaims` is byte-identical to one
  via `getUser` for the same user; a token whose `sub` maps to tenant A cannot read tenant B.
- **Partner-revoke immediacy (PTL-01):** revoke a partner mid-session → the next `getClaims` request
  still 403s (proves the DB lookup, not `getUser`, is the revocation gate).
- **Spoofed-header rejection:** a forged identity header is ignored by `getServerScope` (a regression
  fence, in case anyone later tries Option B).

## Not verifiable from code (owner to confirm)

- Whether asymmetric signing keys are enabled + JWKS is served for prod/preview (dashboard state).
- Access-token TTL ≤ 1h (dashboard).
- The real per-request latency delta (probe a timed loop against `pnpm audit:serve` once keys are on).
- That `getClaims` reuses a cached JWKS across per-request clients (verify at runtime; pass a
  module-cached `jwks` if not).

## Confirmed clean (unchanged by this)

Cookie hardening (`__Host-jv-auth`, HttpOnly/Secure/Lax — AUT-12); `timingSafeEqual` secret
comparisons (AUT-09); the pure `resolveScope` mapping (well tested). The RLS backstop (ADR-0013)
and the DB identity resolution (PRN-08/PTL-01) are untouched.

## Decision

Route-only Option A, **owner-gated on**: (1) enable asymmetric keys, (2) confirm TTL ≤ 1h, (3) accept
the ≤1h residual. On greenlight, implement steps 3–4 + the test suite as its own Tier-A PR.
