# WP-SU-14 — Canary-safe `trusted_devices` retention + trust-refresh throttle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prune abandoned `trusted_devices` rows without weakening AUT-10 reuse detection, and throttle the trust-refresh endpoint so its insert path can't grow unbounded.

**Architecture:** A canary-safe retention pass (`sweepTrustedDevices`) deletes a row only when its family has **no live head** (preserving the reuse canaries of active families), hung best-effort on the daily `retention-sweep` cron. A sliding-window throttle on `/api/auth/trust/refresh`, keyed on `familyId` + IP, bounds the row-per-rotation insert path. One new ADR (0035) records the accepted residual and the tenant-agnostic framing; ADR-0032 gains the new cron alert code.

**Tech Stack:** TypeScript, Next.js App Router route handlers, Drizzle ORM (postgres-js), Vitest (serial), Supabase Postgres.

## Global Constraints

- **Repo/branch:** work in the **main checkout** `C:\Personal_Applications\JV_Leads` on `phase-2/distribution` (layered on the uncommitted WP-SU-13). The spawning worktree is a divergent branch — do **not** edit files there.
- **COMMIT-FREE until owner go.** Every task ends with a **Checkpoint (no commit)**. Before any eventual `git add`, run `git diff --cached --name-only` and confirm it **never** includes `PRODUCT_BRIEF.md`, `WEBSITE-BRIEF.md`, or `docs/legal/`.
- **PRN-01:** pipeline purity — N/A here, but the sweep cutoff takes an injected `now` and stays pure.
- **AUT-10:** `rotate()` checks token reuse **before** expiry (`refresh.ts:66-79`); the sweep must never delete a live family's rotated canaries.
- **ADR-0010:** derive cutoffs from live constants; never restate a lifetime literal. The sweep anchors on the **stored** `expiresAt` column.
- **PRN-08:** `trusted_devices` has `tenant_id`; the age-delete is a **documented tenant-agnostic system-maintenance exception**, not a pre-tenant table.
- **SEC-05:** never place a token in `auth_attempts.identifier`; use `familyId` (internal UUID).
- **Tests:** vitest **serial** — run with `--no-file-parallelism`. Integration files **self-skip** without `DATABASE_URL` (assert on read counts; do not trust green).
- **Test naming:** requirement IDs in test names (`AUT-10-DEV-*`).
- No new dependencies.

---

### Task 1: `TRUST_REFRESH_THROTTLE` config

**Files:**
- Modify: `src/lib/auth/throttle.ts` (append after `SIGNUP_THROTTLE`, ~line 106)
- Test: `tests/unit/trusted-device-retention.test.ts` (create; shared with Task 2's unit test)

**Interfaces:**
- Produces: `export const TRUST_REFRESH_THROTTLE: ThrottleConfig` — `{ perIdentifier: {limit:10, windowMs:900_000}, perIp: {limit:30, windowMs:900_000} }`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/trusted-device-retention.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TRUST_REFRESH_THROTTLE } from "@/lib/auth/throttle";

describe("WP-SU-14: trust-refresh throttle config", () => {
  it("AUT-10-DEV-THR-01: per-family tighter than per-IP, matched windows, sane limits", () => {
    expect(TRUST_REFRESH_THROTTLE.perIdentifier.limit).toBeGreaterThan(0);
    expect(TRUST_REFRESH_THROTTLE.perIp.limit).toBeGreaterThan(TRUST_REFRESH_THROTTLE.perIdentifier.limit);
    expect(TRUST_REFRESH_THROTTLE.perIdentifier.windowMs).toBe(TRUST_REFRESH_THROTTLE.perIp.windowMs);
    expect(TRUST_REFRESH_THROTTLE.perIdentifier.windowMs).toBeGreaterThanOrEqual(60_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --no-file-parallelism tests/unit/trusted-device-retention.test.ts`
Expected: FAIL — `TRUST_REFRESH_THROTTLE` is not exported.

- [ ] **Step 3: Add the constant**

In `src/lib/auth/throttle.ts`, after `SIGNUP_THROTTLE` (~line 106):

```ts
// WP-SU-14 (AUT-10 growth bound): /api/auth/trust/refresh inserts a trusted_devices row per
// SUCCESSFUL rotation and was the one insert-per-call auth endpoint with no throttle (audit-data
// F-1). The growth vector is chain-rotation — each call presents the LATEST token — so the key is
// the FAMILY (stable across the chain), not the per-call token, plus per-IP defence-in-depth.
// Wired sliding-window-ONLY at the call site (like RESET_CONFIRM/VERIFY): AUT-04 lockout's escape
// hatches (owner notify, admin clearFailures) don't apply to a non-inbox key, and lockout would turn
// a benign "please sign in again" into a wait that never fixes it. Limits sit far above any real
// device's rotation cadence (a few/day) and far below an insert-flood.
export const TRUST_REFRESH_THROTTLE: ThrottleConfig = {
  perIdentifier: { limit: 10, windowMs: 900_000 }, // 10 rotations / 15min per family
  perIp: { limit: 30, windowMs: 900_000 }, // 30 / 15min per IP
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --no-file-parallelism tests/unit/trusted-device-retention.test.ts`
Expected: PASS.

- [ ] **Step 5: Checkpoint (no commit)** — `git status` shows only `throttle.ts` + the new unit test modified. Do not commit.

---

### Task 2: `sweepTrustedDevices` — canary-safe retention pass

**Files:**
- Modify: `src/modules/retention/auth-tables.ts` (replace the bottom deferral note `:109-117`; adjust header note `:15`; add drizzle imports `:1`)
- Test: `tests/unit/trusted-device-retention.test.ts` (add cutoff test)
- Test: `tests/integration/trusted-device-retention.test.ts` (create)

**Interfaces:**
- Consumes: `batchedDeleteByAge` (`./batched-delete`), `AUTH_TABLE_RETENTION_MARGIN_MS`, `AUTH_TABLE_SWEEP_BATCH` (already in this file).
- Produces:
  - `export function trustedDevicesCutoff(now: Date): Date` — `now − AUTH_TABLE_RETENTION_MARGIN_MS`.
  - `export async function sweepTrustedDevices(db, opts?: { now?: Date; limit?: number }): Promise<{ deleted: number }>`.

- [ ] **Step 1: Write the failing unit test (cutoff derivation)**

Append to `tests/unit/trusted-device-retention.test.ts`:

```ts
import { trustedDevicesCutoff, AUTH_TABLE_RETENTION_MARGIN_MS } from "@/modules/retention/auth-tables";

describe("WP-SU-14: trusted_devices retention cutoff", () => {
  it("AUT-10-DEV-RET-01: cutoff = now − AUTH_TABLE_RETENTION_MARGIN_MS, anchored on stored expiresAt (derived, not a restated literal)", () => {
    const now = new Date("2026-07-30T00:00:00.000Z");
    expect(trustedDevicesCutoff(now).getTime()).toBe(now.getTime() - AUTH_TABLE_RETENTION_MARGIN_MS);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --no-file-parallelism tests/unit/trusted-device-retention.test.ts`
Expected: FAIL — `trustedDevicesCutoff` not exported.

- [ ] **Step 3: Implement the sweep + fix the framing**

In `src/modules/retention/auth-tables.ts`:

(a) Extend the drizzle import (line 1) to:

```ts
import { and, eq, gt, isNotNull, isNull, lte, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
```

(b) Adjust the header note (line 15) from the "pulled out" parenthetical to:

```ts
// (trusted_devices is ALSO swept here — WP-SU-14, at the bottom of this file. It differs: it HAS a
// tenant_id and needs family-liveness-aware pruning to preserve AUT-10 reuse detection.)
```

(c) Replace the entire bottom deferral note (lines 109-117) with:

```ts
// ── trusted_devices (AUT-10 / ACC-02) — CANARY-SAFE, family-liveness-aware (WP-SU-14). Unlike the
// three siblings above, this table HAS a tenant_id; the age-predicate delete is nonetheless
// tenant-agnostic SYSTEM MAINTENANCE — a documented PRN-08 exception, same class as the cron
// tenant-list read — NOT a pre-tenant table. Anchored on the STORED expiresAt (the 30d
// REFRESH_ABSOLUTE_MS is already baked in at issue/rotate time), so no lifetime literal is restated
// (ADR-0010).
//
// A row is pruned ONLY when its family has NO LIVE HEAD — no row with rotatedTo IS NULL AND revokedAt
// IS NULL AND expiresAt > now (the exact live-head definition in trusted-device.ts:139). This is
// load-bearing for AUT-10: rotate() (refresh.ts:66-79) checks token REUSE *before* expiry, so an
// ACTIVE family's old rotated rows are its reuse canaries — deleting them turns a leaked-token replay
// from "reuse_revoked" (revoke family + notify) into "invalid". Keeping every row while a live head
// exists preserves that canary; once the family is fully dead, its rows past expiresAt + margin are
// pruned, dropping the abandoned device's IP/label. Accepted residual (ADR-0035): a fully-dead family
// loses its canary after the margin — acceptable, no access is granted (all tokens expired/rotated/
// revoked) and no live session exists to protect.
export function trustedDevicesCutoff(now: Date): Date {
  return new Date(now.getTime() - AUTH_TABLE_RETENTION_MARGIN_MS);
}

export async function sweepTrustedDevices(
  db: DB,
  opts: { now?: Date; limit?: number } = {},
): Promise<{ deleted: number }> {
  const now = opts.now ?? new Date();
  const T = schema.trustedDevices;
  const h = alias(schema.trustedDevices, "h");
  // Correlated NOT EXISTS: is there a LIVE HEAD in this row's family?
  const liveHead = db
    .select({ id: h.id })
    .from(h)
    .where(and(eq(h.familyId, T.familyId), isNull(h.rotatedTo), isNull(h.revokedAt), gt(h.expiresAt, now)));
  return batchedDeleteByAge(db, {
    table: T,
    id: T.id,
    orderBy: T.expiresAt,
    where: and(lte(T.expiresAt, trustedDevicesCutoff(now)), notExists(liveHead))!,
    limit: opts.limit ?? AUTH_TABLE_SWEEP_BATCH,
  });
}
```

> If drizzle's `notExists(builder)` rejects the correlated subquery at typecheck/runtime, fall back to a raw `sql` NOT EXISTS: `where: and(lte(T.expiresAt, trustedDevicesCutoff(now)), sql`not exists (select 1 from ${T} h where h.family_id = ${T.familyId} and h.rotated_to is null and h.revoked_at is null and h.expires_at > ${now})`)!` — verify the generated SQL correlates on the OUTER `trusted_devices`.

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `npx vitest run --no-file-parallelism tests/unit/trusted-device-retention.test.ts`
Expected: PASS (both `AUT-10-DEV-THR-01` and `AUT-10-DEV-RET-01`).

- [ ] **Step 5: Write the integration test (the AUT-10 crux)**

Create `tests/integration/trusted-device-retention.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { sha256Hex } from "@/lib/auth/hash";
import { TrustedDeviceService } from "@/lib/auth/trusted-device";
import { sweepTrustedDevices, trustedDevicesCutoff } from "@/modules/retention/auth-tables";

// WP-SU-14: the sweep predicate is SQL, proven against the real trusted_devices table.
// Self-skips without DATABASE_URL (must NOT self-skip in this environment — read the counts).
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-su14-ret";
const DAY = 24 * 3_600_000;

suite("WP-SU-14: canary-safe trusted_devices retention", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let svc: TrustedDeviceService;
  const userId = randomUUID();
  let tenantId = "";
  const now = new Date();
  const cutoff = trustedDevicesCutoff(now); // now − 7d

  // Insert a raw row directly so we can pin expiresAt / rotatedTo precisely (the service refuses to
  // rotate an expired head, so a live-family-with-old-rotated-row can't be built through it alone).
  async function row(familyId: string, token: string, opts: { expiresAt: Date; rotatedTo: string | null; issuedAt?: Date }) {
    const id = randomUUID();
    await db.insert(schema.trustedDevices).values({
      id, familyId, tenantId, userId, partnerId: null,
      tokenHash: sha256Hex(token), deviceLabel: "UA", ip: "1.2.3.4",
      issuedAt: opts.issuedAt ?? new Date(now.getTime() - 40 * DAY),
      expiresAt: opts.expiresAt,
      lastSeenAt: opts.issuedAt ?? new Date(now.getTime() - 40 * DAY),
      rotatedTo: opts.rotatedTo, revokedAt: null,
    });
    return id;
  }
  const familyRows = (familyId: string) =>
    db.select({ id: schema.trustedDevices.id }).from(schema.trustedDevices).where(eq(schema.trustedDevices.familyId, familyId));

  // Family fixtures.
  const active = randomUUID(); const activeOldToken = "active-old-tok";
  const dead = randomUUID();   const deadOldToken = "dead-old-tok";
  const margin = randomUUID();

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    svc = new TrustedDeviceService(db);
    await db.delete(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const [t] = await db.insert(schema.tenants).values({ name: "SU14 Ret", slug: SLUG }).returning({ id: schema.tenants.id });
    tenantId = t.id;
    await db.insert(schema.users).values({ id: userId, tenantId, email: "su14@ret.test", role: "partner", partnerId: null });

    // ACTIVE family: an OLD rotated canary (expiresAt past cutoff) + a LIVE head (expiresAt future).
    await row(active, activeOldToken, { expiresAt: new Date(now.getTime() - 10 * DAY), rotatedTo: randomUUID() });
    await row(active, "active-head-tok", { expiresAt: new Date(now.getTime() + 20 * DAY), rotatedTo: null, issuedAt: new Date(now.getTime() - 1 * DAY) });

    // DEAD family: an old rotated row + an expired head, BOTH past cutoff. No live head.
    await row(dead, deadOldToken, { expiresAt: new Date(now.getTime() - 10 * DAY), rotatedTo: randomUUID() });
    await row(dead, "dead-head-tok", { expiresAt: new Date(now.getTime() - 8 * DAY), rotatedTo: null });

    // DEAD-BUT-WITHIN-MARGIN family: dead (head expired) but both rows still inside the 7d margin.
    await row(margin, "margin-old-tok", { expiresAt: new Date(now.getTime() - 5 * DAY), rotatedTo: randomUUID() });
    await row(margin, "margin-head-tok", { expiresAt: new Date(now.getTime() - 3 * DAY), rotatedTo: null });
  });

  afterAll(async () => {
    await db.delete(schema.trustedDevices).where(inArray(schema.trustedDevices.familyId, [active, dead, margin]));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    await client.end();
  });

  it("AUT-10-DEV-CANARY-01: an ACTIVE family's old rotated canary SURVIVES a sweep and still triggers reuse_revoked", async () => {
    await sweepTrustedDevices(db, { now });
    // The old rotated row is past its own cutoff, but its family has a live head → preserved.
    expect((await familyRows(active)).length).toBe(2);
    // And the canary still fires: replaying the leaked old token revokes the family (AUT-10 intact).
    const reuse = await svc.rotate(activeOldToken, now.getTime(), "1.2.3.4");
    expect(reuse.result.status).toBe("reuse_revoked");
  });

  it("AUT-10-DEV-DEAD-01: a FULLY-DEAD family past the margin is pruned (abandoned IP dropped)", async () => {
    // Re-seed dead (the canary test above may share the sweep run; keep this independent).
    await sweepTrustedDevices(db, { now });
    expect((await familyRows(dead)).length).toBe(0);
    // Residual (ADR-0035): the leaked old token of a dead+pruned family now reads as invalid.
    const gone = await svc.rotate(deadOldToken, now.getTime(), "1.2.3.4");
    expect(gone.result.status).toBe("invalid");
  });

  it("AUT-10-DEV-MARGIN-01: a just-dead family within the 7d margin is NOT pruned (canary grace window)", async () => {
    await sweepTrustedDevices(db, { now });
    expect((await familyRows(margin)).length).toBe(2);
  });

  it("AUT-10-DEV-IDEM-01: a second sweep at the same instant removes none of the survivors", async () => {
    const before = (await familyRows(active)).length + (await familyRows(margin)).length;
    await sweepTrustedDevices(db, { now });
    const after = (await familyRows(active)).length + (await familyRows(margin)).length;
    expect(after).toBe(before);
  });
});
```

> Note: `CANARY-01` runs `svc.rotate(activeOldToken)` which **revokes** the active family as a side effect (that is the behaviour under test). It runs before `IDEM-01`; `IDEM-01` asserts survivor **count** stability (revoked rows still exist — revoke is an UPDATE, not a delete — and are within/near margin so the sweep leaves them), which holds. Keep this test order.

- [ ] **Step 6: Run the integration test**

Run: `npx vitest run --no-file-parallelism tests/integration/trusted-device-retention.test.ts`
Expected (with `DATABASE_URL` set): PASS, 4 tests. Without it: the suite self-skips — confirm the run log shows **skipped**, not silently absent.

- [ ] **Step 7: Checkpoint (no commit)** — `auth-tables.ts` + the two test files. Do not commit.

---

### Task 3: `familyForToken` + throttle wiring in the route

**Files:**
- Modify: `src/lib/auth/trusted-device.ts` (add `familyForToken`)
- Modify: `src/app/api/auth/trust/refresh/route.ts` (wire throttle)
- Test: `tests/integration/trust-refresh-throttle.test.ts` (create)

**Interfaces:**
- Consumes: `TRUST_REFRESH_THROTTLE` (Task 1); `AuthAttemptsStore.reserve/snapshot/settle`; `rateDecisionWithSelf`.
- Produces: `TrustedDeviceService.familyForToken(presented: string): Promise<string | null>`.

- [ ] **Step 1: Write the failing integration test (throttle binds per family)**

Create `tests/integration/trust-refresh-throttle.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";
import { TRUST_REFRESH_THROTTLE } from "@/lib/auth/throttle";
import { rateDecisionWithSelf } from "@/lib/auth/rate-limit";

// WP-SU-14: exercises the EXACT machinery the route uses (reserve → snapshot → rateDecisionWithSelf
// with kind="trust_refresh", keyed on familyId). Self-skips without DATABASE_URL.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const KIND = "trust_refresh";

suite("WP-SU-14: trust-refresh throttle binds per family", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let attempts: AuthAttemptsStore;
  const famA = randomUUID();
  const famB = randomUUID();

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    attempts = new AuthAttemptsStore(db);
  });
  afterAll(async () => {
    await db.delete(schema.authAttempts).where(inArray(schema.authAttempts.identifier, [famA, famB]));
    await client.end();
  });

  // Mirrors the route: reserve, snapshot (which now includes the reservation), decide WithSelf.
  // Distinct IP per family so the per-IP dimension never cross-contaminates the per-family assertion.
  async function attempt(familyId: string, ip: string, at: number): Promise<boolean> {
    await attempts.reserve(familyId, ip, KIND);
    const snap = await attempts.snapshot(familyId, ip, KIND, at, TRUST_REFRESH_THROTTLE);
    return rateDecisionWithSelf(snap.attempts, at, TRUST_REFRESH_THROTTLE.perIdentifier).allowed;
  }

  it("AUT-10-DEV-THR-02: the (limit+1)th rotation for one family in the window is refused", async () => {
    const at = Date.now();
    const L = TRUST_REFRESH_THROTTLE.perIdentifier.limit;
    const results: boolean[] = [];
    for (let i = 0; i < L + 1; i++) results.push(await attempt(famA, "9.9.9.1", at + i));
    expect(results.slice(0, L).every(Boolean)).toBe(true);
    expect(results[L]).toBe(false);
  });

  it("AUT-10-DEV-THR-03: a different family is unaffected by famA's burst", async () => {
    expect(await attempt(famB, "9.9.9.2", Date.now())).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --no-file-parallelism tests/integration/trust-refresh-throttle.test.ts`
Expected (with `DATABASE_URL`): FAIL — the current window has no `trust_refresh` limit wired anywhere the assertion depends on… actually this test exercises library code that already exists once Task 1 landed, so it should PASS immediately. That is intentional: it pins the CONFIG+machinery contract the route depends on. If it passes at Step 2, proceed — the route wiring below is what makes that contract reachable in production.

> This is a contract test, not a red-first unit. Its job is to lock the throttle math to `TRUST_REFRESH_THROTTLE`; the route wiring (Steps 3-4) is what connects it to the endpoint and is verified by typecheck + review.

- [ ] **Step 3: Add `familyForToken` to the service**

In `src/lib/auth/trusted-device.ts`, add a method to `TrustedDeviceService` (after `rotate`, before `revokeFamily`):

```ts
  /** Resolve the family a presented token belongs to WITHOUT loading/rotating it. Lets the route
   *  throttle /api/auth/trust/refresh per family before the insert-heavy rotate (WP-SU-14). Returns
   *  null for an unknown token — nothing to throttle, and rotate would insert nothing either. */
  async familyForToken(presented: string): Promise<string | null> {
    const T = schema.trustedDevices;
    const [row] = await this.db
      .select({ familyId: T.familyId })
      .from(T)
      .where(eq(T.tokenHash, sha256Hex(presented)))
      .limit(1);
    return row?.familyId ?? null;
  }
```

(`eq`, `sha256Hex`, `schema` are already imported in this file.)

- [ ] **Step 4: Wire the throttle into the route**

Replace `src/app/api/auth/trust/refresh/route.ts` entirely with:

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { jsonError, newTraceId } from "@/lib/http";
import { assertCsrf } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/client-ip";
import { TrustedDeviceService } from "@/lib/auth/trusted-device";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";
import { TRUST_REFRESH_THROTTLE } from "@/lib/auth/throttle";
import { rateDecisionWithSelf } from "@/lib/auth/rate-limit";
import { establishSessionForEmail } from "@/lib/auth/otp-session";
import { latestTosVersion } from "@/lib/auth/tos-store";
import { needsTosAcceptance, CURRENT_TOS_VERSION } from "@/lib/legal/tos";
import { notifyTrustReuse } from "@/lib/auth/notify";
import { logError } from "@/lib/observability";
import { TRUST_COOKIE_NAME, TRUST_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";

// AUT-10: skip OTP on a trusted device. Rotate the trust token (reuse ⇒ revoke family + notify),
// then mint a fresh Supabase session. Pre-session → Origin-checked.
const TRUST_REFRESH_KIND = "trust_refresh";

export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: false })) {
    return jsonError("csrf_origin_rejected", "Request origin not allowed.", 403);
  }

  const store = await cookies();
  const token = store.get(TRUST_COOKIE_NAME)?.value;
  const clear = () => store.set(TRUST_COOKIE_NAME, "", { ...TRUST_COOKIE_OPTIONS, maxAge: 0 });
  if (!token) return jsonError("no_trusted_device", "No trusted device on this browser.", 401);

  const db = getDb();
  const now = Date.now();
  const ip = clientIp(request);
  const svc = new TrustedDeviceService(db);

  // WP-SU-14 (AUT-10 growth bound): resolve the family BEFORE the insert-heavy rotate and throttle
  // per family + IP. An unknown token inserts nothing, so it needs no throttle. familyId is an
  // internal UUID, never the token (SEC-05-safe as an auth_attempts identifier).
  const familyId = await svc.familyForToken(token);
  if (!familyId) {
    clear();
    return jsonError("trust_invalid", "Please sign in again.", 401);
  }

  const attempts = new AuthAttemptsStore(db);
  const attemptId = await attempts.reserve(familyId, ip, TRUST_REFRESH_KIND);
  const snap = await attempts.snapshot(familyId, ip, TRUST_REFRESH_KIND, now, TRUST_REFRESH_THROTTLE);
  // *WithSelf: the snapshot includes the reservation above (WP-SU-9). Sliding-window ONLY —
  // deliberately not evaluateThrottle (see TRUST_REFRESH_THROTTLE).
  const byFamily = rateDecisionWithSelf(snap.attempts, now, TRUST_REFRESH_THROTTLE.perIdentifier);
  const byIp = rateDecisionWithSelf(snap.ipAttempts, now, TRUST_REFRESH_THROTTLE.perIp);
  if (!byFamily.allowed || !byIp.allowed) {
    const retryAfterSec = Math.ceil(Math.max(byFamily.retryAfterMs, byIp.retryAfterMs) / 1000);
    // Refused BEFORE rotate ⇒ no row inserted. The reserved attempt stays success:true (not settled
    // to a failure): trust_refresh is sliding-window-only, so nothing reads a lockout ladder for it.
    return NextResponse.json(
      { code: "too_many_requests", message: "Too many attempts. Please wait and try again.", traceId: newTraceId() },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }

  let succeeded = false;
  try {
    const { result, email } = await svc.rotate(token, now, ip);

    if (result.status === "reuse_revoked") {
      clear();
      logError("trust_token_reuse", { familyId: result.familyId });
      if (email) await notifyTrustReuse(email);
      return jsonError("trust_reuse", "This device was signed out for security. Please sign in again.", 401);
    }
    if (result.status !== "rotated" || !email) {
      clear();
      return jsonError("trust_invalid", "Please sign in again.", 401);
    }

    // Persist the rotated trust token and mint a fresh Supabase session (no OTP).
    store.set(TRUST_COOKIE_NAME, result.token, TRUST_COOKIE_OPTIONS);
    if (!(await establishSessionForEmail(email))) {
      return jsonError("session_failed", "Could not establish a session. Please sign in.", 500);
    }

    const [u] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${email}`);
    const accepted = u ? await latestTosVersion(db, u.id) : null;

    succeeded = result.status === "rotated";
    return NextResponse.json({
      code: "ok",
      message: "Welcome back.",
      tosRequired: needsTosAcceptance(accepted, CURRENT_TOS_VERSION),
    });
  } finally {
    // Settle the reserved attempt with the real outcome (matches reset/confirm). success feeds only
    // the rate window here; no lockout ladder consults trust_refresh, so this is observational.
    await attempts.settle(attemptId, succeeded);
  }
}
```

- [ ] **Step 5: Typecheck + run the throttle test**

Run: `npx tsc --noEmit` (expect clean) then
`npx vitest run --no-file-parallelism tests/integration/trust-refresh-throttle.test.ts`
Expected (with `DATABASE_URL`): PASS, 2 tests; else self-skips.

- [ ] **Step 6: Checkpoint (no commit)** — `trusted-device.ts` + route + throttle test. Do not commit.

---

### Task 4: Cron wiring + monitor-wiring test

**Files:**
- Modify: `src/app/api/cron/retention-sweep/route.ts` (add 5th best-effort pass + response field; import; update comment)
- Modify: `tests/unit/cron-monitor-wiring.test.ts` (mock + two tests)

**Interfaces:**
- Consumes: `sweepTrustedDevices` (Task 2).
- Produces: response field `trustedDevices` on the 200; `logError` code `cron_trusted_devices_sweep_failed`.

- [ ] **Step 1: Write the failing test additions**

In `tests/unit/cron-monitor-wiring.test.ts`:

(a) Add to the `vi.hoisted` object (after `otpChallengesThrows`, ~line 29):

```ts
  trustedDevicesDeleted: 0,
  trustedDevicesThrows: false,
```

(b) Extend the `@/modules/retention/auth-tables` mock (~line 86-93):

```ts
vi.mock("@/modules/retention/auth-tables", () => ({
  sweepOtpChallenges: vi.fn(async () => {
    if (h.otpChallengesThrows) throw new Error("otp_challenges pass down");
    return { deleted: h.otpChallengesDeleted };
  }),
  sweepResetTokens: vi.fn(async () => ({ deleted: h.resetTokensDeleted })),
  sweepSignupVerifications: vi.fn(async () => ({ deleted: h.signupVerificationsDeleted })),
  sweepTrustedDevices: vi.fn(async () => {
    if (h.trustedDevicesThrows) throw new Error("trusted_devices pass down");
    return { deleted: h.trustedDevicesDeleted };
  }),
}));
```

(c) Add to `beforeEach` resets (~line 127):

```ts
  h.trustedDevicesDeleted = 0;
  h.trustedDevicesThrows = false;
```

(d) Add two tests after the WP-SU-13 sibling block (~line 262):

```ts
  // ── WP-SU-14 (AUT-10): the canary-safe trusted_devices pass on the same daily sweep. ──

  it("WP-SU-14: retention-sweep runs the trusted_devices pass and reports what it deleted", async () => {
    h.trustedDevicesDeleted = 7;
    const { GET } = await import("@/app/api/cron/retention-sweep/route");
    const res = await GET(authed());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ code: "ok", trustedDevices: 7 });
    expect(h.outcomes).toEqual([{ slug: "retention-sweep", ok: true }]);
  });

  it("WP-SU-14: a failing trusted_devices pass is best-effort — logs its code, does NOT fail the PII purge check-in", async () => {
    h.trustedDevicesThrows = true;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/cron/retention-sweep/route");
    const res = await GET(authed());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ code: "ok", trustedDevices: 0 });
    expect(h.outcomes).toEqual([{ slug: "retention-sweep", ok: true }]);

    const line = errSpy.mock.calls
      .map((c) => c[0] as string)
      .find((l) => typeof l === "string" && l.includes("cron_trusted_devices_sweep_failed"));
    expect(line).toBeDefined();
    expect(JSON.parse(line!)).toMatchObject({ code: "cron_trusted_devices_sweep_failed" });
    errSpy.mockRestore();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --no-file-parallelism tests/unit/cron-monitor-wiring.test.ts`
Expected: FAIL — response has no `trustedDevices` field / `sweepTrustedDevices` not called.

- [ ] **Step 3: Wire the cron route**

In `src/app/api/cron/retention-sweep/route.ts`:

(a) Add to the auth-tables import (~line 7-11):

```ts
import {
  sweepOtpChallenges,
  sweepResetTokens,
  sweepSignupVerifications,
  sweepTrustedDevices,
} from "@/modules/retention/auth-tables";
```

(b) Add a fifth member to the `Promise.all` array (after the `sweepSignupVerifications` block, ~line 103) and destructure it:

```ts
      const [authAttempts, otpChallenges, resetTokens, signupVerifications, trustedDevices] = await Promise.all([
        // ...existing four passes unchanged...
        sweepTrustedDevices(db)
          .then((r) => r.deleted)
          .catch((e) => {
            logError("cron_trusted_devices_sweep_failed", { message: e instanceof Error ? e.message : String(e) });
            return 0;
          }),
      ]);

      return { tenants: swept, purged, authAttempts, otpChallenges, resetTokens, signupVerifications, trustedDevices };
```

(c) Update the trailing parenthetical in the big comment (~lines 77-78) from "(trusted_devices is deliberately NOT swept here…)" to:

```ts
      // trusted_devices is now swept here too (WP-SU-14) — but CANARY-SAFE: it prunes a row only when
      // its family has no live head, so an active family's reuse canaries survive (AUT-10 preserved).
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --no-file-parallelism tests/unit/cron-monitor-wiring.test.ts`
Expected: PASS — all existing tests plus the two new WP-SU-14 tests.

- [ ] **Step 5: Checkpoint (no commit)** — cron route + wiring test. Do not commit.

---

### Task 5: ADR-0035 (new) + ADR-0032 update

**Files:**
- Create: `docs/adr/0035-trusted-device-canary-retention-and-throttle.md`
- Modify: `docs/adr/0032-sentry-server-side-transport-and-cron-monitors.md` (Consequences, replace the trusted_devices parenthetical `:183-186`)

- [ ] **Step 1: Write ADR-0035**

Create `docs/adr/0035-trusted-device-canary-retention-and-throttle.md`:

```markdown
# ADR-0035: Canary-safe `trusted_devices` retention + trust-refresh throttle

- **Status:** Accepted (owner-approved, 2026-07-30)
- **Date:** 2026-07-30
- **Phase / WP:** Phase 2 (Distribution) · WP-SU-14 (discharges the `trusted_devices` pass deferred
  out of WP-SU-13)
- **Relates to:** ADR-0010 (Postgres rate-limit store; derive cutoffs from live constants),
  ADR-0032 (cron monitors + best-effort bolt-on rule). Governed by AUT-10, PRN-08, SEC-05.

## Context

WP-SU-13 pruned three pre-tenant auth token tables. `trusted_devices` was pulled from that WP by its
4-agent review, for two independent reasons:

1. **A naive age-prune narrows AUT-10 reuse detection (audit-security F-1).** `rotate()`
   (`src/lib/auth/refresh.ts:66-79`) checks token REUSE (`rotatedTo != null` → `reuse_revoked` +
   `revokeFamily` + notify) *before* it checks expiry (`now > expiresAt`). And `issue()` sets
   `expiresAt = now + REFRESH_ABSOLUTE_MS` on every rotation — a **sliding per-token** expiry, not an
   absolute-per-family cap (the "30-day absolute cap" comment is a misnomer). So a continuously-used
   family lives indefinitely while its old rotated rows individually pass `expiresAt`. A naive
   `DELETE WHERE expiresAt <= now - margin` would delete those old rotated rows of a **still-active**
   family, turning a leaked-token replay from `reuse_revoked` into `invalid` — the family revoke +
   owner notify silently lost. (No access is granted — the token is expired regardless — but the
   AUT-10 detection/response is narrowed.) This is **not** the false premise "past `expiresAt` ⇒ no
   live read": the reuse check runs first, so an expired rotated row is still a live canary.
2. **The insert path is unthrottled (audit-data F-1).** `/api/auth/trust/refresh` inserts a row per
   successful rotation behind only `assertCsrf`. A script with one valid trust cookie can chain-rotate
   (always presenting the latest token, so reuse never fires) and insert unbounded; a daily retention
   batch cannot keep pace. Retention alone therefore cannot bound growth.

## Decision

**Prune `trusted_devices` family-liveness-aware, and throttle the trust-refresh insert path.**

- **Canary-safe pruning.** `sweepTrustedDevices` (`src/modules/retention/auth-tables.ts`) deletes a
  row only when `expiresAt <= now − 7d` **AND** its family has **no live head**
  (`NOT EXISTS` a row with `rotated_to IS NULL AND revoked_at IS NULL AND expires_at > now` — the
  exact live-head definition in `trusted-device.ts:139`). An **active** family's rows are never
  pruned, so its reuse canaries survive; a **fully-dead** family's rows past the margin are pruned,
  dropping the abandoned device's IP/label. Anchored on the **stored** `expiresAt` (the 30d
  `REFRESH_ABSOLUTE_MS` is already baked in), so no lifetime literal is restated (ADR-0010). Hung
  best-effort on the daily `retention-sweep` cron behind its own `cron_trusted_devices_sweep_failed`
  code (ADR-0032 bolt-on rule).
- **Throttle.** `TRUST_REFRESH_THROTTLE` (per-family 10/15min + per-IP 30/15min), wired
  sliding-window-only (`reserve → snapshot → rateDecisionWithSelf`), **not** `evaluateThrottle` —
  AUT-04 lockout's escape hatches (owner notify, admin `clearFailures`) don't apply to a non-inbox
  key, and lockout would turn "please sign in again" into a wait that never fixes it (identical
  reasoning to `reset/confirm`). Keyed on **`familyId`** (stable across the rotation chain; a
  per-token key would reset every window and bind nothing), an internal UUID never the token (SEC-05).
- **PRN-08 framing.** `trusted_devices` HAS a `tenant_id`, unlike the three genuinely pre-tenant
  siblings. The age-predicate delete is nonetheless **tenant-agnostic system maintenance** — a
  documented PRN-08 exception, the same class as the cron tenant-list read — because the predicate is
  an age/liveness condition, not a tenant scope. It is NOT described as "pre-tenant."

## Accepted residual

For a family with **no live head** (fully dead), after the 7d margin its rotated canary rows are
pruned, so a leaked old token of *that dead family* replayed later returns `invalid` instead of
`reuse_revoked` — that event's family revoke + notify is lost. **Accepted because:** no access is
granted regardless (every token in the family is rotated/expired/revoked); there is no live session
to protect; the notify would concern a device abandoned ≥ the margin ago; and the competing goal —
dropping the abandoned device's IP/device-label (data-minimisation, the point of the sweep) —
outweighs the marginal notify. The case that matters — an **active** family, where a reuse replay
kills a live session — is fully preserved.

## Consequences

- **Closes:** audit-security F-1 (reuse-detection narrowing) and audit-data F-1 (unbounded growth).
- **New alert code:** `cron_trusted_devices_sweep_failed` (enumerated in ADR-0032 Consequences; owner
  wires the Sentry rule). A healthy run is silent; the rows-deleted count rides in the 200 response.
- **No migration / no index.** The `expiresAt <= cutoff` predicate plans as a seq-scan + top-N sort
  (no `expiresAt` index); the `NOT EXISTS` correlates on `family_id` → uses `trusted_devices_family_idx`.
  At this table's volume, once a day, this matches the siblings' accepted cost and ADR-0010's
  Redis-swap revisit trigger. An `expiresAt` index is a candidate follow-up if volume justifies it.
- **Reopens if:** trust-refresh volume rises enough to justify an index, or a `revokedAt`-anchored
  early IP purge for explicitly-revoked-but-not-yet-expired devices is later wanted.
```

- [ ] **Step 2: Update ADR-0032 Consequences**

In `docs/adr/0032-sentry-server-side-transport-and-cron-monitors.md`, replace the trailing
parenthetical (lines ~183-186, "(trusted_devices was in WP-SU-13's original scope but was pulled…)")
with:

```markdown
  WP-SU-14 adds one more of the same class — `cron_trusted_devices_sweep_failed` — for the
  canary-safe `trusted_devices` retention pass now hung off this daily sweep (ADR-0035). Caught, not
  propagated, for the identical reason: this monitor answers "did the LGL-02 consumer-PII purge run",
  so a data-minimisation hygiene failure must not fail its check-in. A healthy run is silent; the
  rows-deleted count rides in the 200 response. Alert on it, or `trusted_devices` silently resumes
  retaining abandoned-device IPs. Unlike the naive prune WP-SU-13 rejected, this pass is
  family-liveness-aware, so it preserves AUT-10 reuse detection for active families (ADR-0035).
```

- [ ] **Step 3: Verify the docs read correctly**

Run: `npx vitest run --no-file-parallelism tests/unit/cron-monitor-wiring.test.ts tests/unit/trusted-device-retention.test.ts`
Expected: PASS (docs edits don't affect tests; this reconfirms the suite is green before review).

- [ ] **Step 4: Checkpoint (no commit)** — both ADR files. Do not commit.

---

## Final gate (after all tasks) — reviews, then hold for owner go

- [ ] **Full targeted test run:** `npx vitest run --no-file-parallelism tests/unit/trusted-device-retention.test.ts tests/unit/cron-monitor-wiring.test.ts tests/integration/trusted-device-retention.test.ts tests/integration/trust-refresh-throttle.test.ts` — all green (integration self-skips if no `DATABASE_URL`; note that in the summary).
- [ ] **Typecheck:** `npx tsc --noEmit` — clean.
- [ ] **Self-audit:** run PLAYBOOK §6 and print the filled checklist in the summary.
- [ ] **Reviews (mandatory):** `pr-reviewer` + `audit-security` (session security) + `audit-data` + `audit-devops` (cron). Fold findings.
- [ ] **Guardrail:** `git diff --cached --name-only` is empty (nothing staged); `git status` shows only WP-SU-14 files + the still-uncommitted WP-SU-13 files. **Never** stage `PRODUCT_BRIEF.md`, `WEBSITE-BRIEF.md`, `docs/legal/`.
- [ ] **Hold for owner go** before any commit.

## Self-review (author)

- **Spec coverage:** §4 sweep → Task 2; §5 throttle → Tasks 1+3; §6 residual + §4 PRN-08 framing → Task 5 (ADR-0035) + Task 2 comments; §7 cron → Task 4; §8 tests → Tasks 1-4. All covered.
- **Type consistency:** `sweepTrustedDevices(db, {now?,limit?}) → {deleted}`, `trustedDevicesCutoff(now)→Date`, `familyForToken(string)→Promise<string|null>`, `TRUST_REFRESH_THROTTLE: ThrottleConfig` — used identically in every task and test.
- **Placeholders:** none — every step carries real code/commands.
- **Risk flagged:** the drizzle correlated `notExists` (Task 2 Step 3) has a raw-`sql` fallback noted inline.
