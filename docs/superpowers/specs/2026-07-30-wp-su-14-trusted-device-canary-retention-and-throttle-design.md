# WP-SU-14 — Canary-safe `trusted_devices` retention + trust-refresh throttle (design)

- **Date:** 2026-07-30
- **Phase / WP:** Phase 2 (Distribution) · WP-SU-14 (also discharges the `trusted_devices` pass
  deferred out of WP-SU-13)
- **Tier:** **A** — session security. `trusted_devices` backs AUT-10 reuse detection; both
  mechanisms below touch it directly.
- **Branch / repo:** `phase-2/distribution` in `C:\Personal_Applications\JV_Leads` (the **main
  checkout**). Layered on top of the *uncommitted* WP-SU-13 working changes, per owner decision.
- **Follows:** WP-SU-13 (`otp_challenges` / `reset_tokens` / `signup_verifications` retention) and
  its 4-agent review — **audit-security F-1** and **audit-data F-1**, which pulled `trusted_devices`
  out of WP-SU-13.
- **Governing rules:** AUT-10 (rotating refresh tokens + reuse detection), ADR-0010 (derive cutoffs
  from live constants, never restate literals), ADR-0032 (cron monitors + best-effort bolt-on pass
  rule), PRN-01, PRN-08, SEC-05, SEC-07.

## 1. Problem

WP-SU-13 pruned three pre-tenant auth token tables. `trusted_devices` was **in scope but pulled
out**, because two independent problems make the naive age-prune wrong. Both are documented in the
current `auth-tables.ts` bottom note and were verified against live code:

### F-1a — naive pruning narrows AUT-10 reuse detection (audit-security)

`RefreshTokenService.rotate` (`src/lib/auth/refresh.ts:66-79`) checks **reuse before expiry**:

```
if (!rec || rec.revokedAt != null) return { status: "invalid" };   // 68
if (rec.rotatedTo != null) { revokeFamily(...); return reuse_revoked }  // 70-73  ← BEFORE expiry
if (now > rec.expiresAt) return { status: "invalid" };             // 74
```

And `issue` sets `expiresAt = now + REFRESH_ABSOLUTE_MS` on **every** rotation (`refresh.ts:60`) —
a **sliding per-token** expiry, not an absolute-per-family cap (the "30-day absolute cap" comment at
`refresh.ts:6` is a misnomer). Consequence: a continuously-used family lives indefinitely while its
**old rotated rows** individually pass `expiresAt`.

A naive `DELETE WHERE expiresAt <= now - margin` would delete those old rotated rows of a
**still-active** family. A leaked old token replayed after expiry+margin then matches no row →
`rotate` returns `"invalid"` (line 68) instead of `"reuse_revoked"` (line 72). No access is granted
(the token is expired regardless), but the **family revoke + owner notify** is silently lost — the
AUT-10 detection/response is narrowed.

### F-1b — the insert path is unthrottled (audit-data)

`POST /api/auth/trust/refresh` (`src/app/api/auth/trust/refresh/route.ts`) calls
`TrustedDeviceService.rotate`, which **inserts a row per successful rotation**
(`trusted-device.ts:92-104`), behind only `assertCsrf` — **no throttle**, unlike every sibling
credential endpoint (`throttle.ts`). A script holding one valid trust cookie can loop
`rotate → insert` unbounded (each call presents the *latest* token, so reuse detection never fires
and never stops it). A daily 5 000-row retention batch cannot keep pace, so **retention alone cannot
bound growth** — the throttle is not optional garnish, it is what makes the sweep sufficient.

## 2. Confirmed grounding (read from live code, not restated)

- **Reuse-before-expiry order:** `refresh.ts:66-79` (above).
- **Sliding per-token expiry:** `issue` at `refresh.ts:53-64`; `REFRESH_ABSOLUTE_MS = 30d`
  (`refresh.ts:10`), embedded into `trusted_devices.expiresAt` at issue/rotate time
  (`trusted-device.ts:66,102`).
- **Insert per rotation:** `trusted-device.ts:90-104` (the `"rotated"` branch is the *only* one that
  inserts; `reuse_revoked` is an UPDATE, `invalid` is a no-op).
- **Live-head definition already in code:** `listForUser` treats a family as active iff a row exists
  with `!rotatedTo && !revokedAt && expiresAt > now` (`trusted-device.ts:139`). The sweep predicate
  reuses exactly this definition.
- **Schema:** `trusted_devices` (`src/db/schema.ts:579-604`) — `familyId`, **`tenantId` (NOT
  NULL, FK)**, `tokenHash` (unique idx), `ip`, `deviceLabel`, `expiresAt`, `rotatedTo`, `revokedAt`,
  `createdAt`. Indexes: `_hash_idx` (unique tokenHash), `_family_idx` (familyId),
  `_user_idx` (tenantId, userId). **No `expiresAt` index.**
- **RLS:** `trusted_devices` is deny-by-default, service-role managed (migration `0007`) → a delete
  needs **no migration**.
- **Retention primitive:** `batchedDeleteByAge(db, { table, id, orderBy, where, limit })`
  (`src/modules/retention/batched-delete.ts`) — select-oldest-first → delete-by-id, bounded,
  idempotent, transaction-free. `where` is a single `SQL`; correlated `NOT EXISTS` is expressible.
- **Margin constant:** `AUTH_TABLE_RETENTION_MARGIN_MS = 7 days` (`auth-tables.ts:26`).
- **Throttle machinery:** `AuthAttemptsStore.reserve / snapshot / settle` (`attempts-store.ts:40-57`,
  WP-SU-9 CWE-367 fix) and `rateDecisionWithSelf` (`rate-limit.ts`). Reference wiring:
  `reset/confirm/route.ts:49-63,122-125` — **sliding-window-only**, deliberately not
  `evaluateThrottle` (`reset/confirm/route.ts:40-48`).

## 3. Scope (owner-approved: both mechanisms in one reviewed change)

1. **`sweepTrustedDevices`** — a canary-safe retention pass (fixes F-1a; drops abandoned-device IPs).
2. **`TRUST_REFRESH_THROTTLE`** on `/api/auth/trust/refresh` (fixes F-1b; bounds growth). This is the
   "WP-SU-14" the review named; it ships here because the sweep alone cannot bound growth.
3. **ADR-0035** (design + accepted residual + PRN-08 framing) and an **ADR-0032** update (new cron
   code). Correct the `auth-tables.ts` "pre-tenant" framing for `trusted_devices`.

Out of scope (candidate follow-ups, §10): an `expiresAt` index; a `revokedAt`-early IP purge;
Redis-swap for the rate store (ADR-0010 trigger).

## 4. Mechanism 1 — `sweepTrustedDevices`

Added to `src/modules/retention/auth-tables.ts`, on the shared `batchedDeleteByAge` primitive.

- **orderBy / age column:** `expiresAt`. The row carries its own 30d-embedded expiry, so we anchor on
  the **stored column** — the 30d `REFRESH_ABSOLUTE_MS` literal is **never restated** (ADR-0010).
  This differs from the three siblings, which anchor on `createdAt` and must *add* their TTL.
- **cutoff:** `now − AUTH_TABLE_RETENTION_MARGIN_MS` (reuse the existing 7d constant). A dead
  family's most-recent canary therefore survives ~7d past its ~30d expiry (≈37d after last use).
- **WHERE (canary-safe):**

  ```sql
  expires_at <= :cutoff
  AND NOT EXISTS (
    SELECT 1 FROM trusted_devices h
    WHERE h.family_id = t.family_id
      AND h.rotated_to IS NULL
      AND h.revoked_at IS NULL
      AND h.expires_at > :now        -- live-head definition, == trusted-device.ts:139
  )
  ```

  Built with drizzle `and(lte(T.expiresAt, cutoff), notExists(sql-subquery))`. The subquery's
  liveness threshold is `:now` (no margin), so the family reads as dead the instant its last head
  expires; the outer `expires_at <= :cutoff` supplies the grace window on each row.

**Correctness — the invariants the tests pin:**

| Family state | `NOT EXISTS` (dead?) | Effect | AUT-10 |
|---|---|---|---|
| **Active** (a live head exists) | false | **no row pruned**, incl. old rotated canaries | replay → `reuse_revoked` + revoke + notify — **preserved** |
| **Dead**, past margin | true | rows past `expiresAt+7d` pruned; stale IP dropped | replay → `invalid` (accepted residual, §6) |
| **Dead**, within margin | true | most-recent canary still `> cutoff` → kept | replay → `reuse_revoked` still fires |

Only *rotated* rows are canaries: an expired-but-never-rotated head returns `invalid` (fails line 68
`revokedAt`? no — passes 68, `rotatedTo` null so skips 70, then `now > expiresAt` → invalid at 74),
and a revoked row is caught by the `revokedAt` check at line 68 before the reuse check. So pruning
non-rotated / revoked rows has **zero** AUT-10 cost; the single family-level `NOT EXISTS` handles all
three row kinds correctly.

**PRN-08 framing (corrected):** `trusted_devices` **has** `tenant_id`, unlike the three genuinely
pre-tenant siblings. This age-predicate delete is **tenant-agnostic system maintenance** — a
documented PRN-08 exception, the same class as the cron tenant-list read and `signup-sweep`'s
reconcile pass — **not** "pre-tenant." The `auth-tables.ts` header/bottom comments are corrected to
say this accurately.

**Performance / index:** `expires_at <= cutoff` plans as a seq-scan + top-N sort (no `expiresAt`
index); the `NOT EXISTS` correlates on `family_id` → uses `_family_idx`. At `trusted_devices`
volume, once a day, this matches the siblings' documented **ACCEPTED COST** and ADR-0010's
Redis-swap revisit trigger. **No migration, no index** in this WP.

## 5. Mechanism 2 — `TRUST_REFRESH_THROTTLE` (WP-SU-14)

New `ThrottleConfig` in `throttle.ts`. Wired into `/api/auth/trust/refresh` following the
`reset/confirm` reference exactly: **sliding-window-only** via `reserve → snapshot →
rateDecisionWithSelf(perIdentifier) + rateDecisionWithSelf(perIp) → 429 + Retry-After`, with a
`try/finally settle(id, succeeded)`. **Not** `evaluateThrottle` — AUT-04 progressive lockout's two
escape hatches (owner notification, admin `clearFailures`) are unreachable for a key that isn't an
inbox, and lockout would turn a benign "please sign in again" into a "wait that never fixes it"
(identical reasoning to `reset/confirm/route.ts:40-48`).

- **Key = `familyId`** (per-identifier) **+ IP** (per-IP). The growth vector is chain-rotation
  (each call presents the *latest* token), so a per-**token** key would reset every window and bind
  nothing; `familyId` is stable across the chain and binds it. `familyId` is an internal UUID, never
  the token → SEC-05 safe to place in `auth_attempts.identifier`.
- **Ordering in the route** (minimal edit):
  1. `assertCsrf` (unchanged).
  2. Read the cookie token (unchanged).
  3. **Single-row lookup by `tokenHash`** to get `familyId`. No row → `no_trusted_device` /
     `trust_invalid` (today's behaviour), **no throttle, no insert**. (Implementation: a small
     `TrustedDeviceService.familyForToken(token)` returning `familyId | null`, or reuse the first
     `select` already inside `rotate` by hoisting it — decided under TDD to avoid a double lookup.)
  4. **Throttle gate** on `(familyId, ip, kind="trust_refresh")`. Refused → 429 + `Retry-After`,
     before `rotate` (so no insert).
  5. Allowed → `rotate` as today (may insert on the `rotated` branch), then `settle`.
- **`kind = "trust_refresh"`**; the reserved row is `success:true` (a rotation is not a credential
  failure — matches `reset/confirm`), so only the rate windows bind and no lockout is ever engaged.
- **Limits (starting point, tuned under TDD):** `perIdentifier { limit: 10, windowMs: 900_000 }`
  (10 rotations / 15 min per family) · `perIp { limit: 30, windowMs: 900_000 }`. Well above any
  legitimate trusted-device rotation cadence (a few per day) and far below an insert-flood, so a
  genuine single reuse event is never throttled. Final values confirmed at review.
- **Note:** a refused (429) request skips `rotate`, so a reuse-replay *while throttled* defers its
  `reuse_revoked` to the next un-throttled attempt. Acceptable: the attacker is rate-limited, and a
  legitimate reuse event (rare, low-rate) is never throttled by the generous limits.

## 6. Accepted residual → **ADR-0035**

For a family with **no live head** (fully dead), after the 7d margin its rotated canary rows are
pruned, so a leaked old token of *that dead family* replayed later returns `"invalid"` instead of
`"reuse_revoked"` — the family revoke + notify for that event is lost.

**Accepted because:** (a) **no access is granted** regardless — every token in the family is
rotated/expired/revoked; (b) there is **no live session** to protect; (c) the notify would concern a
device abandoned **≥ margin** ago; (d) the competing goal — dropping the abandoned device's **IP /
device-label** (data-minimisation, the whole point of the sweep) — outweighs the marginal notify.

The ADR states this **honestly**: it is *not* the false premise "past `expiresAt` ⇒ no live read"
(`rotate` checks reuse **before** expiry — §1). The preserved case (active family → canary kept →
live session killed on reuse) is the AUT-10 case that actually matters, and it is fully retained.

ADR-0035 also records: the family-liveness predicate, the PRN-08 tenant-agnostic framing, and the
throttle rationale (key choice, sliding-window-only).

## 7. Cron wiring

`src/app/api/cron/retention-sweep/route.ts`: add `sweepTrustedDevices(db)` as a **fifth best-effort
member of the existing `Promise.all` group**, `.then(r => r.deleted).catch(e => { logError(
"cron_trusted_devices_sweep_failed", {...}); return 0; })`; add `trustedDevices` to the 200 response.
No change to the tenant PII loop, the monitor semantics, or the other passes.

- **New `logError` code:** `cron_trusted_devices_sweep_failed` — appended to **ADR-0032
  Consequences** with a one-line note (its silent death = unbounded IP retention, an alert not a
  legal-grade check-in failure, per the existing best-effort rule).
- **`tests/unit/cron-monitor-wiring.test.ts`:** extend the `@/modules/retention/auth-tables` mock
  with `sweepTrustedDevices`; add `h.trustedDevicesDeleted` / `h.trustedDevicesThrows` +
  `beforeEach` resets; add a "runs the pass, reports its count" test and a "failing pass is
  best-effort, logs `cron_trusted_devices_sweep_failed`, monitor still resolves" test, mirroring the
  WP-SU-13 sibling block (lines 227-262).

## 8. Tests (TDD, requirement IDs in names; vitest serial `--no-file-parallelism`)

**Unit (`tests/unit/…`, no DB):**
- `AUT-10-DEV-RET-01`: `sweepTrustedDevices` cutoff = `now − AUTH_TABLE_RETENTION_MARGIN_MS`,
  anchored on `expiresAt` — **derived from the live constant**, a restated literal fails the build.
- `AUT-10-DEV-THR-01`: `TRUST_REFRESH_THROTTLE` windows are sane (both ≤ the sibling window scale;
  `perIp.limit > perIdentifier.limit`).
- If a pure liveness/predicate helper is extracted, unit-test its truth table directly.

**Integration (`tests/integration/…`, self-skips silently without `DATABASE_URL` — assert on read
counts, do not trust green; per the worktree-false-green lesson):**
- **`AUT-10-DEV-CANARY-01` (the crux):** seed an **active** family (live head + an old, already-past-
  `expiresAt+margin` rotated row) → run `sweepTrustedDevices` → assert the old rotated row **still
  exists** AND `TrustedDeviceService.rotate(oldToken)` returns **`reuse_revoked`** (canary survived).
- **`AUT-10-DEV-DEAD-01`:** seed a **fully-dead** family (head expired past margin, plus rotated
  rows) → sweep → all rows gone; a subsequent `rotate(oldToken)` returns `invalid` (residual, §6).
- **`AUT-10-DEV-MARGIN-01`:** a dead family whose newest row is within the margin → not pruned.
- **`AUT-10-DEV-IDEM-01`:** second run deletes 0; batch bound honoured.
- **`AUT-10-DEV-THR-02/03`:** loop `POST /api/auth/trust/refresh` (or drive the store directly) →
  429 after `perIdentifier.limit` for one family; a second family/IP is unaffected (per-key).

**Cron route test:** covered by the `cron-monitor-wiring.test.ts` additions in §7.

## 9. Process / guardrails

- **Main checkout `C:\Personal_Applications\JV_Leads`, `phase-2/distribution`** — the spawning
  worktree is a divergent branch (WP-03x line, ADRs stop at 0012) and is **not** the target.
- **Commit-free until owner go.** Before any `git add`, run `git diff --cached --name-only`;
  **never** stage `PRODUCT_BRIEF.md`, `WEBSITE-BRIEF.md`, or `docs/legal/` (all present untracked).
- Zod-validate any new input; uniform error envelope. No new dependencies (no ADR needed for deps).
- Self-audit (PLAYBOOK §6) printed in the summary.
- Reviews after build: **`pr-reviewer` + `audit-security` (mandatory — session security) +
  `audit-data` + `audit-devops` (cron)**.

## 10. Candidate follow-ups (NOT built here)

- An `expiresAt` (partial) index on `trusted_devices` if sweep volume ever justifies it — a
  migration, shared with ADR-0010's Redis-swap trigger.
- `revokedAt`-anchored early IP purge for explicitly-revoked-but-not-yet-expired devices, if ≤30d IP
  retention on revoked devices is later judged too long.
- Rate-match sweep cadence/batch to observed insert rate (shared with WP-SU-11 / ADR-0010).
