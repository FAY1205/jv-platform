# WP-SU-13 — Auth sibling-table retention — Implementation Plan

> **AS-BUILT (2026-07-30, after the 4-agent review gate): trusted_devices was PULLED.**
> The four-reviewer round (pr-reviewer + audit-security + audit-data + audit-devops) surfaced two
> independent problems specific to the `trusted_devices` pass, and the owner chose to drop it and land
> the rest:
> 1. **AUT-10 reuse-detection reduction on a false premise** (audit-security F-1, verified against
>    refresh.ts): rotate() checks token REUSE *before* expiry, so pruning an active family's old
>    rotated rows means a leaked old token replayed after expiry+margin returns "invalid" instead of
>    "reuse_revoked" — losing the family revoke + owner notify. The design's "past expiresAt ⇒ no live
>    read" premise is false for this path, and the code's "owner-approved" claim wasn't in the plan/spec.
> 2. **Unbounded growth** (audit-data F-1): its insert path /api/auth/trust/refresh is unthrottled,
>    unlike its siblings, so retention alone doesn't bound it.
> So Task 4 (trusted_devices) is NOT built. Correct treatment (family-liveness-aware pruning that keeps
> a rotated row while its family has a live head, + a throttle on trust/refresh, + an ADR for any
> accepted trade) is a dedicated follow-up WP. Tasks 1-3 (otp_challenges, reset_tokens,
> signup_verifications) + Task 5 (F-3) shipped, with these folds from the review:
> cron passes run via Promise.all (audit-devops F-1, 60s-budget), F-3 rest-pass index comment
> (audit-data F-2), unused-var + comment cleanups. The batchedDeleteByAge type-guard (audit-data F-4)
> was attempted but drizzle's PgColumn generic rejects the partial config — documented as an invariant
> instead.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prune dead rows from four pre-tenant auth tables (`otp_challenges`, `reset_tokens`, `signup_verifications`, `trusted_devices`) and right-size the `auth_attempts.signup_notice` cutoff (audit F-3), closing the same data-minimisation gap WP-SU-11 closed for `auth_attempts`.

**Architecture:** A shared `batchedDeleteByAge` primitive (select-oldest-first → delete-by-id, batched, idempotent, no transaction) plus thin per-table policy functions in `auth-tables.ts`, each deriving its cutoff from the live TTL constant. Four best-effort passes bolt onto the existing daily `retention-sweep` cron behind their own `cron_*_sweep_failed` codes. `auth-attempts.ts` is refactored onto the same primitive and its single cutoff becomes a `kind → retention` map. Delete-only ⇒ no migration (all four tables are RLS deny-by-default).

**Tech Stack:** TypeScript, Drizzle ORM (`postgres-js`), Vitest (serial), Next.js route handler, Sentry cron monitors.

## Global Constraints

- **Location:** ALL work lands in the main repo `C:\Personal_Applications\JV_Leads` on branch `phase-2/distribution`. The spawning worktree (`…\.claude\worktrees\interesting-curran-2ccb96`) is a divergent branch — NOT the target. Use absolute paths; prefix Bash with `cd /c/Personal_Applications/JV_Leads &&` (the shell resets to the worktree between calls).
- **ADR-0010 — derive, never restate:** every cutoff is computed from a live imported constant (`OTP_TTL_MS`, `RESET_TTL_MS`, `SIGNUP_TTL_MS`, `REFRESH_ABSOLUTE_MS`, `ALREADY_REGISTERED_CAP.windowMs`). A restated literal (`600000`, `"signup_notice"`, `"24h"`) is a bug the tripwire tests must fail on.
- **PRN-01:** sweep cutoffs are pure — `now: Date` is injected, never `Date.now()` inside.
- **SEC-05:** never log an email, token, OTP, or IP. `logError` `detail` carries only counts/messages/ids.
- **Delete-only, no migration:** confirmed RLS deny-by-default — migrations 0005 (reset_tokens), 0006 (otp_challenges), 0007 (trusted_devices), 0025 (signup_verifications).
- **Tests:** Vitest **serial** — `npx vitest run --no-file-parallelism <path>`. Test names carry requirement IDs (`it("SU-13-OTP-01: …")`). Integration suites self-skip without `DATABASE_URL` via `const suite = process.env.DATABASE_URL ? describe : describe.skip` — **read the reported counts; a self-skip is not a pass.**
- **Commit-free until owner go.** Each task ends at a **review checkpoint** (`git diff`), NOT a commit. Before any future `git add`, run `git diff --cached --name-only`; NEVER stage `PRODUCT_BRIEF.md`, `WEBSITE-BRIEF.md`, or `docs/legal/`.
- **Margin:** `AUTH_TABLE_RETENTION_MARGIN_MS = 7 * 24 * 60 * 60 * 1000` (7 days), shared by the four sibling passes and the `signup_notice` override.
- **Batch:** `AUTH_TABLE_SWEEP_BATCH = 5_000` (mirrors `AUTH_ATTEMPTS_SWEEP_BATCH`).

---

## File Structure

- Create `src/modules/retention/batched-delete.ts` — the generic `batchedDeleteByAge` primitive.
- Create `src/modules/retention/auth-tables.ts` — margin/batch constants + the four sibling policies (cutoff + sweep each).
- Modify `src/modules/retention/auth-attempts.ts` — refactor onto the primitive; single cutoff → `kind` map (F-3).
- Modify `src/lib/auth/notice-budget.ts:20` — `export` the `NOTICE_KIND` literal so retention consumes the same source.
- Modify `src/app/api/cron/retention-sweep/route.ts` — four best-effort passes + response fields.
- Modify `docs/adr/0032-sentry-server-side-transport-and-cron-monitors.md` — append the four codes + F-3 note to Consequences.
- Create `tests/unit/auth-tables-retention.test.ts` — pure cutoff/tripwire tests for the four tables.
- Create `tests/integration/auth-tables-retention.test.ts` — real-DB sweep behaviour for the four tables.
- Modify `tests/unit/auth-attempts-retention.test.ts` — add the F-3 map assertions.
- Modify `tests/integration/auth-attempts-retention.test.ts` — add a `signup_notice` short-cutoff case.

---

### Task 1: Shared primitive + `otp_challenges` policy

**Files:**
- Create: `src/modules/retention/batched-delete.ts`
- Create: `src/modules/retention/auth-tables.ts`
- Test: `tests/unit/auth-tables-retention.test.ts` (create), `tests/integration/auth-tables-retention.test.ts` (create)

**Interfaces:**
- Produces: `batchedDeleteByAge(db, { table, id, orderBy, where, limit }): Promise<{ deleted: number }>`
- Produces: `AUTH_TABLE_RETENTION_MARGIN_MS`, `AUTH_TABLE_SWEEP_BATCH`, `OTP_CHALLENGES_RETENTION_MS`, `otpChallengesCutoff(now: Date): Date`, `sweepOtpChallenges(db, { now?, limit? }): Promise<{ deleted: number }>`

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/auth-tables-retention.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { OTP_TTL_MS } from "@/lib/auth/otp";
import {
  AUTH_TABLE_RETENTION_MARGIN_MS,
  OTP_CHALLENGES_RETENTION_MS,
  otpChallengesCutoff,
} from "@/modules/retention/auth-tables";

// WP-SU-13 (ADR-0010): cutoffs are DERIVED from the live TTL constants, never restated. A literal
// (`600000`) passes on the day it is written and silently starts deleting rows a live read still
// uses the moment OTP_TTL_MS moves. These tripwires make that impossible.
describe("WP-SU-13: otp_challenges retention cutoff", () => {
  it("SU-13-OTP-01: retention is the live OTP read window PLUS the shared margin", () => {
    expect(OTP_CHALLENGES_RETENTION_MS).toBe(OTP_TTL_MS + AUTH_TABLE_RETENTION_MARGIN_MS);
  });

  it("SU-13-OTP-02: retention covers the OTP TTL (build-fails if a literal drifts below it)", () => {
    expect(OTP_CHALLENGES_RETENTION_MS).toBeGreaterThanOrEqual(OTP_TTL_MS);
  });

  it("SU-13-MARGIN-01: the shared margin is a generous >= 7 days", () => {
    expect(AUTH_TABLE_RETENTION_MARGIN_MS).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000);
  });

  it("SU-13-OTP-03: the cutoff is exactly the retention window before now, and is pure", () => {
    const now = new Date("2026-07-30T03:00:00.000Z");
    expect(otpChallengesCutoff(now).getTime()).toBe(now.getTime() - OTP_CHALLENGES_RETENTION_MS);
    expect(now.toISOString()).toBe("2026-07-30T03:00:00.000Z"); // caller clock never mutated
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /c/Personal_Applications/JV_Leads && npx vitest run --no-file-parallelism tests/unit/auth-tables-retention.test.ts`
Expected: FAIL — cannot resolve `@/modules/retention/auth-tables`.

- [ ] **Step 3: Write the primitive**

Create `src/modules/retention/batched-delete.ts`:

```typescript
import { asc, inArray, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";

// WP-SU-13: the one place the retention delete loop lives. Mirrors sweepAuthAttempts' shape exactly
// — select the oldest N rows matching an age predicate, then delete them by id — so every sibling
// pass is bounded, idempotent, oldest-first, and transaction-free (a duplicate concurrent run at
// worst re-deletes rows the other already removed, a no-op; there is no append-only side effect to
// double-write). Delete-only: every target table is RLS deny-by-default, so no migration is needed.
type DB = PostgresJsDatabase<typeof schema>;

export interface BatchedDeleteSpec {
  /** The table to prune. */
  table: PgTable;
  /** Its primary-key column (used for the delete-by-id set and the returning count). */
  id: PgColumn;
  /** The age column to drain oldest-first — createdAt for token tables, expiresAt for sessions. */
  orderBy: PgColumn;
  /** The age predicate: rows matching this are eligible for deletion. */
  where: SQL;
  /** Hard cap on rows removed per run. */
  limit: number;
}

export async function batchedDeleteByAge(db: DB, spec: BatchedDeleteSpec): Promise<{ deleted: number }> {
  const stale = await db
    .select({ id: spec.id })
    .from(spec.table)
    .where(spec.where)
    .orderBy(asc(spec.orderBy))
    .limit(spec.limit);
  if (stale.length === 0) return { deleted: 0 };

  const ids = stale.map((r) => r.id as string);
  const removed = await db.delete(spec.table).where(inArray(spec.id, ids)).returning({ id: spec.id });
  return { deleted: removed.length };
}
```

- [ ] **Step 4: Write `auth-tables.ts` with the margin/batch constants and the OTP policy**

Create `src/modules/retention/auth-tables.ts`:

```typescript
import { lte } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { OTP_TTL_MS } from "@/lib/auth/otp";
import { batchedDeleteByAge } from "./batched-delete";

// ─────────────────────────────────────────────────────────────────────────────
// WP-SU-13: retention for the four pre-tenant auth SIBLING tables of auth_attempts.
// Same data-minimisation gap ADR-0010 named and WP-SU-11 closed for auth_attempts —
// these tables hold raw third-party emails (otp_challenges.identifier), token hashes,
// and IPs (trusted_devices) on dead rows that nothing prunes. Each cutoff is DERIVED
// from that table's own live read window; a restated literal is a bug (ADR-0010).
// ─────────────────────────────────────────────────────────────────────────────

type DB = PostgresJsDatabase<typeof schema>;

/**
 * Race-safety margin above each table's longest live-read window. 7 days is >= ~1000x the
 * minute-scale token TTLs (otp 10m, reset 30m) and 7x the 24h ones, so the sweep can never race a
 * live read; and it keeps raw third-party emails (otp identifier, signup_notice) to ~8 days instead
 * of ~31. The cutoffs below ADD it to a live TTL constant — never a restated literal (ADR-0010).
 */
export const AUTH_TABLE_RETENTION_MARGIN_MS = 7 * 24 * 60 * 60 * 1000;

/** Max rows one pass deletes. Mirrors AUTH_ATTEMPTS_SWEEP_BATCH — bounded, idempotent, drains the
 *  remainder next daily run. */
export const AUTH_TABLE_SWEEP_BATCH = 5_000;

// ── otp_challenges (PTL-01) — createdAt-anchored. OtpStore.latestActive reads the most-recent
// UNCONSUMED row and enforces expiry in-app against expiresAt; a row older than OTP_TTL_MS is
// expired and unreadable-for-auth regardless of consumed state, so the TTL is the whole read window.
export const OTP_CHALLENGES_RETENTION_MS = OTP_TTL_MS + AUTH_TABLE_RETENTION_MARGIN_MS;

export function otpChallengesCutoff(now: Date): Date {
  return new Date(now.getTime() - OTP_CHALLENGES_RETENTION_MS);
}

export async function sweepOtpChallenges(db: DB, opts: { now?: Date; limit?: number } = {}): Promise<{ deleted: number }> {
  const now = opts.now ?? new Date();
  const C = schema.otpChallenges;
  return batchedDeleteByAge(db, {
    table: C,
    id: C.id,
    orderBy: C.createdAt,
    where: lte(C.createdAt, otpChallengesCutoff(now)),
    limit: opts.limit ?? AUTH_TABLE_SWEEP_BATCH,
  });
}
```

- [ ] **Step 5: Run the unit test to verify it passes**

Run: `cd /c/Personal_Applications/JV_Leads && npx vitest run --no-file-parallelism tests/unit/auth-tables-retention.test.ts`
Expected: PASS (4 tests).

> **Type note:** if `db.select({ id: spec.id }).from(spec.table)` reports a type error on the generic `PgTable`/`PgColumn`, keep the imports from `drizzle-orm/pg-core` and cast the row id via `r.id as string` (already done). Do not loosen `spec` to `any`.

- [ ] **Step 6: Write the failing integration test**

Create `tests/integration/auth-tables-retention.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { OTP_TTL_MS } from "@/lib/auth/otp";
import { otpChallengesCutoff, sweepOtpChallenges } from "@/modules/retention/auth-tables";

// WP-SU-13: the sweep boundary is a SQL predicate, so it is proven against the real table.
// Self-skips without DATABASE_URL (must NOT self-skip in this environment — read the counts).
const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("WP-SU-13: otp_challenges retention sweep", () => {
  const db = getDb();
  // A unique identifier prefix keeps these fixtures independent of every other row in the table.
  const TAG = `su13-otp-${randomUUID().slice(0, 8)}`;
  const now = new Date();
  const cutoff = otpChallengesCutoff(now);
  const MIN = 60_000;

  async function seed(suffix: string, createdAt: Date) {
    await db.insert(schema.otpChallenges).values({
      identifier: `${TAG}-${suffix}@example.test`,
      codeHash: "x",
      pepper: "p",
      expiresAt: new Date(createdAt.getTime() + OTP_TTL_MS),
      createdAt,
    });
  }
  const remaining = async () =>
    (await db.select({ id: schema.otpChallenges.id }).from(schema.otpChallenges).where(eq(schema.otpChallenges.pepper, "p")))
      .length; // narrowed below via identifier filter in assertions

  const mineRemaining = async (): Promise<string[]> =>
    (await db.select({ identifier: schema.otpChallenges.identifier }).from(schema.otpChallenges))
      .map((r) => r.identifier)
      .filter((i) => i.startsWith(TAG))
      .sort();

  beforeAll(async () => {
    // Drain any pre-existing past-cutoff backlog so `deleted` counts below are exact rather than
    // "mine plus whatever else was already old" — those rows are unreadable by any code path and
    // deleting them IS this sweep's job (mirrors the WP-SU-11 retention suite's beforeAll).
    for (let pass = 0; pass < 10; pass++) {
      const { deleted } = await sweepOtpChallenges(db, { now });
      if (deleted === 0) break;
    }
    await seed("ancient", new Date(cutoff.getTime() - 24 * 60 * MIN)); // day past cutoff → delete
    await seed("at-cutoff", cutoff); // boundary inclusive → delete
    await seed("just-inside", new Date(cutoff.getTime() + MIN)); // 1 min inside → keep
    await seed("fresh", now); // keep
  });
  afterAll(async () => {
    for (const i of await mineRemaining()) {
      await db.delete(schema.otpChallenges).where(eq(schema.otpChallenges.identifier, i));
    }
  });

  it("SU-13-OTP-04: deletes rows past the cutoff (boundary inclusive), keeps in-window rows", async () => {
    const { deleted } = await sweepOtpChallenges(db, { now });
    expect(deleted).toBe(2);
    expect(await mineRemaining()).toEqual([`${TAG}-fresh@example.test`, `${TAG}-just-inside@example.test`].sort());
  });

  it("SU-13-OTP-05: idempotent — a second sweep at the same instant deletes nothing", async () => {
    const { deleted } = await sweepOtpChallenges(db, { now });
    expect(deleted).toBe(0);
  });

  it("SU-13-OTP-06: bounded per run — limit caps rows removed, remainder drains next run", async () => {
    await seed("b1", new Date(cutoff.getTime() - MIN));
    await seed("b2", new Date(cutoff.getTime() - 2 * MIN));
    const first = await sweepOtpChallenges(db, { now, limit: 1 });
    expect(first.deleted).toBe(1);
    const second = await sweepOtpChallenges(db, { now, limit: 10 });
    expect(second.deleted).toBe(1);
  });
});
```

> Remove the unused `remaining` helper before running — it is shown only to illustrate the pepper-tag isolation idea; `mineRemaining` (identifier-prefix filter) is the one the assertions use.

- [ ] **Step 7: Run the integration test to verify it passes**

Run: `cd /c/Personal_Applications/JV_Leads && npx vitest run --no-file-parallelism tests/integration/auth-tables-retention.test.ts`
Expected: PASS (3 tests) if `DATABASE_URL` is set; if it prints `skipped`, STOP and report — the env is missing (worktree-false-green risk).

- [ ] **Step 8: Review checkpoint (do NOT commit — owner-go gate)**

Run: `cd /c/Personal_Applications/JV_Leads && git status && git diff --stat`
Confirm only the four intended files changed. Leave unstaged.

---

### Task 2: `reset_tokens` policy

**Files:**
- Modify: `src/modules/retention/auth-tables.ts`
- Test: `tests/unit/auth-tables-retention.test.ts`, `tests/integration/auth-tables-retention.test.ts`

**Interfaces:**
- Consumes: `batchedDeleteByAge`, `AUTH_TABLE_RETENTION_MARGIN_MS`, `AUTH_TABLE_SWEEP_BATCH`
- Produces: `RESET_TOKENS_RETENTION_MS`, `resetTokensCutoff(now: Date): Date`, `sweepResetTokens(db, { now?, limit? }): Promise<{ deleted: number }>`

- [ ] **Step 1: Write the failing unit test** — append to `tests/unit/auth-tables-retention.test.ts`:

```typescript
import { RESET_TTL_MS } from "@/lib/auth/reset-token";
import { RESET_TOKENS_RETENTION_MS, resetTokensCutoff } from "@/modules/retention/auth-tables";

describe("WP-SU-13: reset_tokens retention cutoff", () => {
  it("SU-13-RST-01: retention is the live reset TTL plus the shared margin", () => {
    expect(RESET_TOKENS_RETENTION_MS).toBe(RESET_TTL_MS + AUTH_TABLE_RETENTION_MARGIN_MS);
  });
  it("SU-13-RST-02: retention covers the reset TTL", () => {
    expect(RESET_TOKENS_RETENTION_MS).toBeGreaterThanOrEqual(RESET_TTL_MS);
  });
  it("SU-13-RST-03: the cutoff is exactly the retention window before now", () => {
    const now = new Date("2026-07-30T03:00:00.000Z");
    expect(resetTokensCutoff(now).getTime()).toBe(now.getTime() - RESET_TOKENS_RETENTION_MS);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /c/Personal_Applications/JV_Leads && npx vitest run --no-file-parallelism tests/unit/auth-tables-retention.test.ts`
Expected: FAIL — `RESET_TOKENS_RETENTION_MS` is not exported.

- [ ] **Step 3: Implement the reset policy** — append to `src/modules/retention/auth-tables.ts` (and add `import { RESET_TTL_MS } from "@/lib/auth/reset-token";` at the top):

```typescript
// ── reset_tokens (AUT-06) — createdAt-anchored. ResetStore.findByHash + verifyResetToken reject
// past expiresAt (RESET_TTL_MS, 30m). A row older than the TTL is unusable; used rows are single-use.
export const RESET_TOKENS_RETENTION_MS = RESET_TTL_MS + AUTH_TABLE_RETENTION_MARGIN_MS;

export function resetTokensCutoff(now: Date): Date {
  return new Date(now.getTime() - RESET_TOKENS_RETENTION_MS);
}

export async function sweepResetTokens(db: DB, opts: { now?: Date; limit?: number } = {}): Promise<{ deleted: number }> {
  const now = opts.now ?? new Date();
  const R = schema.resetTokens;
  return batchedDeleteByAge(db, {
    table: R,
    id: R.id,
    orderBy: R.createdAt,
    where: lte(R.createdAt, resetTokensCutoff(now)),
    limit: opts.limit ?? AUTH_TABLE_SWEEP_BATCH,
  });
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `cd /c/Personal_Applications/JV_Leads && npx vitest run --no-file-parallelism tests/unit/auth-tables-retention.test.ts`
Expected: PASS (7 tests total).

- [ ] **Step 5: Write the failing integration test** — append a suite to `tests/integration/auth-tables-retention.test.ts` (add imports `RESET_TTL_MS` from `@/lib/auth/reset-token`, `resetTokensCutoff, sweepResetTokens` from auth-tables):

```typescript
suite("WP-SU-13: reset_tokens retention sweep", () => {
  const db = getDb();
  const now = new Date();
  const cutoff = resetTokensCutoff(now);
  const MIN = 60_000;
  const uid = () => randomUUID();
  const tags: string[] = [];

  async function seed(createdAt: Date): Promise<string> {
    const userId = uid();
    tags.push(userId);
    await db.insert(schema.resetTokens).values({
      userId,
      tokenHash: `su13-rst-${randomUUID()}`,
      expiresAt: new Date(createdAt.getTime() + RESET_TTL_MS),
      createdAt,
    });
    return userId;
  }
  const mineRemaining = async () =>
    (await db.select({ userId: schema.resetTokens.userId }).from(schema.resetTokens))
      .map((r) => r.userId)
      .filter((u) => tags.includes(u)).length;

  let past: string, inside: string;
  beforeAll(async () => {
    // Drain pre-existing past-cutoff backlog so `deleted` counts are exact (WP-SU-11 pattern).
    for (let pass = 0; pass < 10; pass++) {
      const { deleted } = await sweepResetTokens(db, { now });
      if (deleted === 0) break;
    }
    past = await seed(new Date(cutoff.getTime() - MIN)); // delete
    inside = await seed(new Date(cutoff.getTime() + MIN)); // keep
  });
  afterAll(async () => {
    for (const u of tags) await db.delete(schema.resetTokens).where(eq(schema.resetTokens.userId, u));
  });

  it("SU-13-RST-04: deletes past-cutoff tokens, keeps in-window tokens", async () => {
    const { deleted } = await sweepResetTokens(db, { now });
    expect(deleted).toBe(1);
    expect(await mineRemaining()).toBe(1);
  });
  it("SU-13-RST-05: idempotent", async () => {
    expect((await sweepResetTokens(db, { now })).deleted).toBe(0);
  });
});
```

- [ ] **Step 6: Run the integration test to verify it passes**

Run: `cd /c/Personal_Applications/JV_Leads && npx vitest run --no-file-parallelism tests/integration/auth-tables-retention.test.ts`
Expected: PASS (all suites) with `DATABASE_URL` set.

- [ ] **Step 7: Review checkpoint (do NOT commit)** — `git diff --stat`; only auth-tables.ts + the two test files changed.

---

### Task 3: `signup_verifications` policy (used-rows-only)

**Files:**
- Modify: `src/modules/retention/auth-tables.ts`
- Test: `tests/unit/auth-tables-retention.test.ts`, `tests/integration/auth-tables-retention.test.ts`

**Interfaces:**
- Consumes: `batchedDeleteByAge`, margin/batch constants
- Produces: `SIGNUP_VERIFICATIONS_RETENTION_MS`, `signupVerificationsCutoff(now: Date): Date`, `sweepSignupVerifications(db, { now?, limit? }): Promise<{ deleted: number }>`

**Design note (load-bearing):** the predicate is `and(isNotNull(usedAt), lte(createdAt, cutoff))`. The `usedAt IS NOT NULL` guard means this pass NEVER removes an unconsumed row, so `signup-sweep.ts`'s expired+unconsumed abandoned-tenant detection signal is untouched. This pass closes only the residue `signup-sweep` leaves behind: happy-path **used** rows.

- [ ] **Step 1: Write the failing unit test** — append to `tests/unit/auth-tables-retention.test.ts`:

```typescript
import { SIGNUP_TTL_MS } from "@/lib/auth/signup-token";
import { SIGNUP_VERIFICATIONS_RETENTION_MS, signupVerificationsCutoff } from "@/modules/retention/auth-tables";

describe("WP-SU-13: signup_verifications retention cutoff", () => {
  it("SU-13-SGN-01: retention is the live signup TTL plus the shared margin", () => {
    expect(SIGNUP_VERIFICATIONS_RETENTION_MS).toBe(SIGNUP_TTL_MS + AUTH_TABLE_RETENTION_MARGIN_MS);
  });
  it("SU-13-SGN-02: retention covers the signup TTL", () => {
    expect(SIGNUP_VERIFICATIONS_RETENTION_MS).toBeGreaterThanOrEqual(SIGNUP_TTL_MS);
  });
  it("SU-13-SGN-03: the cutoff is exactly the retention window before now", () => {
    const now = new Date("2026-07-30T03:00:00.000Z");
    expect(signupVerificationsCutoff(now).getTime()).toBe(now.getTime() - SIGNUP_VERIFICATIONS_RETENTION_MS);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /c/Personal_Applications/JV_Leads && npx vitest run --no-file-parallelism tests/unit/auth-tables-retention.test.ts`
Expected: FAIL — `SIGNUP_VERIFICATIONS_RETENTION_MS` not exported.

- [ ] **Step 3: Implement the policy** — append to `src/modules/retention/auth-tables.ts` (add `and, isNotNull` to the `drizzle-orm` import: `import { and, isNotNull, lte } from "drizzle-orm";`, and `import { SIGNUP_TTL_MS } from "@/lib/auth/signup-token";`):

```typescript
// ── signup_verifications (SCP-02/AUT-06) — createdAt-anchored, USED ROWS ONLY. signup-sweep.ts
// already sweeps expired + UNCONSUMED rows and uses them as its abandoned-tenant detection signal;
// the isNotNull(usedAt) guard here means this pass never removes an unconsumed row, so that signal
// is untouched. It closes only the residue signup-sweep leaves: happy-path used rows.
export const SIGNUP_VERIFICATIONS_RETENTION_MS = SIGNUP_TTL_MS + AUTH_TABLE_RETENTION_MARGIN_MS;

export function signupVerificationsCutoff(now: Date): Date {
  return new Date(now.getTime() - SIGNUP_VERIFICATIONS_RETENTION_MS);
}

export async function sweepSignupVerifications(
  db: DB,
  opts: { now?: Date; limit?: number } = {},
): Promise<{ deleted: number }> {
  const now = opts.now ?? new Date();
  const S = schema.signupVerifications;
  return batchedDeleteByAge(db, {
    table: S,
    id: S.id,
    orderBy: S.createdAt,
    where: and(isNotNull(S.usedAt), lte(S.createdAt, signupVerificationsCutoff(now)))!,
    limit: opts.limit ?? AUTH_TABLE_SWEEP_BATCH,
  });
}
```

> `and(...)` returns `SQL | undefined`; the non-null assertion `!` is safe (both operands are present) and keeps `where: SQL`.

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `cd /c/Personal_Applications/JV_Leads && npx vitest run --no-file-parallelism tests/unit/auth-tables-retention.test.ts`
Expected: PASS (10 tests total).

- [ ] **Step 5: Write the failing integration test** — append a suite to `tests/integration/auth-tables-retention.test.ts` (imports: `SIGNUP_TTL_MS` from `@/lib/auth/signup-token`, `signupVerificationsCutoff, sweepSignupVerifications` from auth-tables). This is the suite that proves the `signup-sweep` interaction:

```typescript
suite("WP-SU-13: signup_verifications retention sweep (used rows only)", () => {
  const db = getDb();
  const now = new Date();
  const cutoff = signupVerificationsCutoff(now);
  const MIN = 60_000;
  const tags: string[] = [];

  async function seed(createdAt: Date, used: boolean): Promise<string> {
    const userId = randomUUID();
    tags.push(userId);
    await db.insert(schema.signupVerifications).values({
      userId,
      tokenHash: `su13-sgn-${randomUUID()}`,
      expiresAt: new Date(createdAt.getTime() + SIGNUP_TTL_MS),
      usedAt: used ? new Date(createdAt.getTime() + MIN) : null,
      createdAt,
    });
    return userId;
  }
  const mineRemaining = async (): Promise<string[]> =>
    (await db.select({ userId: schema.signupVerifications.userId }).from(schema.signupVerifications))
      .map((r) => r.userId)
      .filter((u) => tags.includes(u))
      .sort();

  let usedOld: string, unusedOld: string;
  beforeAll(async () => {
    // Drain pre-existing USED past-cutoff backlog so `deleted` counts are exact (WP-SU-11 pattern).
    // The sweep only touches usedAt-set rows, so this never disturbs unconsumed abandonment rows.
    for (let pass = 0; pass < 10; pass++) {
      const { deleted } = await sweepSignupVerifications(db, { now });
      if (deleted === 0) break;
    }
    usedOld = await seed(new Date(cutoff.getTime() - MIN), true); // used + past cutoff → DELETE
    unusedOld = await seed(new Date(cutoff.getTime() - MIN), false); // UNCONSUMED + past cutoff → KEEP
    await seed(new Date(cutoff.getTime() + MIN), true); // used + in-window → keep
  });
  afterAll(async () => {
    for (const u of tags) await db.delete(schema.signupVerifications).where(eq(schema.signupVerifications.userId, u));
  });

  it("SU-13-SGN-04: deletes USED past-cutoff rows but NEVER an unconsumed row (signup-sweep's signal)", async () => {
    const { deleted } = await sweepSignupVerifications(db, { now });
    expect(deleted).toBe(1); // only usedOld
    const left = await mineRemaining();
    expect(left).toContain(unusedOld); // unconsumed abandoned-signal row survives
    expect(left).not.toContain(usedOld);
    expect(left.length).toBe(2);
  });
  it("SU-13-SGN-05: idempotent", async () => {
    expect((await sweepSignupVerifications(db, { now })).deleted).toBe(0);
  });
});
```

- [ ] **Step 6: Run the integration test to verify it passes**

Run: `cd /c/Personal_Applications/JV_Leads && npx vitest run --no-file-parallelism tests/integration/auth-tables-retention.test.ts`
Expected: PASS with `DATABASE_URL`.

- [ ] **Step 7: Review checkpoint (do NOT commit)** — `git diff --stat`.

---

### Task 4: `trusted_devices` policy (expiresAt-anchored)

**Files:**
- Modify: `src/modules/retention/auth-tables.ts`
- Test: `tests/unit/auth-tables-retention.test.ts`, `tests/integration/auth-tables-retention.test.ts`

**Interfaces:**
- Consumes: `batchedDeleteByAge`, margin/batch constants
- Produces: `trustedDevicesCutoff(now: Date): Date`, `sweepTrustedDevices(db, { now?, limit? }): Promise<{ deleted: number }>`

**Design note:** `expiresAt`-anchored. `trusted_devices.expiresAt = issuedAt + REFRESH_ABSOLUTE_MS`; every read (`rotate`, `listForUser` head filter, `familyScope`) stops mattering once the row is past `expiresAt`. Delete where `expiresAt <= now - MARGIN` — covers expired and revoked-then-expired rows uniformly. There is no restated literal to drift (the 30d lifetime lives in `expiresAt`, set in `refresh.ts`); the tripwire seeds a freshly-issued row (`expiresAt = now + REFRESH_ABSOLUTE_MS`) and asserts it survives.

- [ ] **Step 1: Write the failing unit test** — append to `tests/unit/auth-tables-retention.test.ts`:

```typescript
import { trustedDevicesCutoff } from "@/modules/retention/auth-tables";

describe("WP-SU-13: trusted_devices retention cutoff (expiresAt-anchored)", () => {
  it("SU-13-DEV-01: the cutoff is exactly the shared margin before now, and is pure", () => {
    const now = new Date("2026-07-30T03:00:00.000Z");
    expect(trustedDevicesCutoff(now).getTime()).toBe(now.getTime() - AUTH_TABLE_RETENTION_MARGIN_MS);
    expect(now.toISOString()).toBe("2026-07-30T03:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /c/Personal_Applications/JV_Leads && npx vitest run --no-file-parallelism tests/unit/auth-tables-retention.test.ts`
Expected: FAIL — `trustedDevicesCutoff` not exported.

- [ ] **Step 3: Implement the policy** — append to `src/modules/retention/auth-tables.ts`:

```typescript
// ── trusted_devices (AUT-10/ACC-02) — expiresAt-anchored. expiresAt embeds REFRESH_ABSOLUTE_MS
// (30d, set in refresh.ts); rotate/listForUser/familyScope all stop mattering once a row is past
// expiresAt. Delete rows whose expiry is more than the margin in the past — covers expired AND
// revoked-then-expired rows uniformly, dropping their retained IP. A revoked-but-not-yet-expired
// row keeps its IP until its natural <= 30d expiry (accepted; revoked-early purge is a follow-up).
export function trustedDevicesCutoff(now: Date): Date {
  return new Date(now.getTime() - AUTH_TABLE_RETENTION_MARGIN_MS);
}

export async function sweepTrustedDevices(db: DB, opts: { now?: Date; limit?: number } = {}): Promise<{ deleted: number }> {
  const now = opts.now ?? new Date();
  const T = schema.trustedDevices;
  return batchedDeleteByAge(db, {
    table: T,
    id: T.id,
    orderBy: T.expiresAt,
    where: lte(T.expiresAt, trustedDevicesCutoff(now)),
    limit: opts.limit ?? AUTH_TABLE_SWEEP_BATCH,
  });
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `cd /c/Personal_Applications/JV_Leads && npx vitest run --no-file-parallelism tests/unit/auth-tables-retention.test.ts`
Expected: PASS (11 tests total).

- [ ] **Step 5: Write the failing integration test** — append a suite to `tests/integration/auth-tables-retention.test.ts` (imports: `REFRESH_ABSOLUTE_MS` from `@/lib/auth/refresh`, `trustedDevicesCutoff, sweepTrustedDevices` from auth-tables). `trusted_devices` needs a real `tenantId` FK — reuse an existing tenant or create one:

```typescript
suite("WP-SU-13: trusted_devices retention sweep (expiresAt-anchored)", () => {
  const db = getDb();
  const now = new Date();
  const cutoff = trustedDevicesCutoff(now); // now - MARGIN
  const MIN = 60_000;
  const tags: string[] = [];
  let tenantId: string;

  async function seed(expiresAt: Date, opts: { revoked?: boolean } = {}): Promise<string> {
    const familyId = randomUUID();
    tags.push(familyId);
    await db.insert(schema.trustedDevices).values({
      familyId,
      tenantId,
      userId: randomUUID(),
      tokenHash: `su13-dev-${randomUUID()}`,
      ip: "203.0.113.9",
      issuedAt: new Date(expiresAt.getTime() - REFRESH_ABSOLUTE_MS),
      expiresAt,
      revokedAt: opts.revoked ? new Date(expiresAt.getTime() - MIN) : null,
    });
    return familyId;
  }
  const mineRemaining = async (): Promise<string[]> =>
    (await db.select({ familyId: schema.trustedDevices.familyId }).from(schema.trustedDevices))
      .map((r) => r.familyId)
      .filter((f) => tags.includes(f))
      .sort();

  let expiredOld: string, revokedOld: string, live: string;
  beforeAll(async () => {
    // Any existing tenant satisfies the FK; the sweep is age-only and tenant-agnostic.
    const [t] = await db.select({ id: schema.tenants.id }).from(schema.tenants).limit(1);
    tenantId = t.id;
    // Drain pre-existing past-expiry backlog so `deleted` counts are exact (WP-SU-11 pattern).
    for (let pass = 0; pass < 10; pass++) {
      const { deleted } = await sweepTrustedDevices(db, { now });
      if (deleted === 0) break;
    }
    expiredOld = await seed(new Date(cutoff.getTime() - MIN)); // expired > margin ago → DELETE
    revokedOld = await seed(new Date(cutoff.getTime() - MIN), { revoked: true }); // also DELETE
    live = await seed(new Date(now.getTime() + REFRESH_ABSOLUTE_MS)); // freshly issued → KEEP
  });
  afterAll(async () => {
    for (const f of tags) await db.delete(schema.trustedDevices).where(eq(schema.trustedDevices.familyId, f));
  });

  it("SU-13-DEV-02: deletes expired and revoked-past-expiry rows, keeps a freshly-issued row", async () => {
    const { deleted } = await sweepTrustedDevices(db, { now });
    expect(deleted).toBe(2);
    expect(await mineRemaining()).toEqual([live]);
  });
  it("SU-13-DEV-03: idempotent", async () => {
    expect((await sweepTrustedDevices(db, { now })).deleted).toBe(0);
  });
});
```

- [ ] **Step 6: Run the integration test to verify it passes**

Run: `cd /c/Personal_Applications/JV_Leads && npx vitest run --no-file-parallelism tests/integration/auth-tables-retention.test.ts`
Expected: PASS with `DATABASE_URL` (all four sibling suites green).

- [ ] **Step 7: Review checkpoint (do NOT commit)** — `git diff --stat`.

---

### Task 5: F-3 — `auth_attempts` kind→retention map

**Files:**
- Modify: `src/lib/auth/notice-budget.ts:20` (export `NOTICE_KIND`)
- Modify: `src/modules/retention/auth-attempts.ts` (map + reuse `batchedDeleteByAge`)
- Test: `tests/unit/auth-attempts-retention.test.ts`, `tests/integration/auth-attempts-retention.test.ts`

**Interfaces:**
- Consumes: `NOTICE_KIND` (now exported from notice-budget), `batchedDeleteByAge`, `AUTH_TABLE_RETENTION_MARGIN_MS`
- Produces: `SIGNUP_NOTICE_RETENTION_MS`, `signupNoticeCutoff(now: Date): Date`, `authAttemptsRetentionForKind(kind: string): number` (keeps existing `AUTH_ATTEMPTS_RETENTION_MS`, `authAttemptsCutoff`, `sweepAuthAttempts` signatures unchanged)

- [ ] **Step 1: Export `NOTICE_KIND`** — `src/lib/auth/notice-budget.ts:20`, change `const NOTICE_KIND = "signup_notice";` to:

```typescript
export const NOTICE_KIND = "signup_notice";
```

- [ ] **Step 2: Write the failing unit tests** — append to `tests/unit/auth-attempts-retention.test.ts`:

```typescript
import { NOTICE_KIND } from "@/lib/auth/notice-budget";
import { AUTH_TABLE_RETENTION_MARGIN_MS } from "@/modules/retention/auth-tables";
import {
  SIGNUP_NOTICE_RETENTION_MS,
  AUTH_ATTEMPTS_RETENTION_MS,
  authAttemptsRetentionForKind,
} from "@/modules/retention/auth-attempts";

// WP-SU-13 F-3: signup_notice rows record a raw third-party email, read only within
// ALREADY_REGISTERED_CAP.windowMs (24h), yet the uniform WP-SU-11 cutoff kept them ~31 days. The
// map shortens ONLY signup_notice; every other kind keeps the safe global default (no under-retention).
describe("WP-SU-13 F-3: auth_attempts kind-specific retention", () => {
  it("SU-13-F3-01: signup_notice retention is the live 24h cap window plus the shared margin (derived)", () => {
    expect(SIGNUP_NOTICE_RETENTION_MS).toBe(ALREADY_REGISTERED_CAP.windowMs + AUTH_TABLE_RETENTION_MARGIN_MS);
  });
  it("SU-13-F3-02: signup_notice retention still covers its 24h read window", () => {
    expect(SIGNUP_NOTICE_RETENTION_MS).toBeGreaterThanOrEqual(ALREADY_REGISTERED_CAP.windowMs);
  });
  it("SU-13-F3-03: the refinement bites — signup_notice is retained STRICTLY less than the default", () => {
    expect(SIGNUP_NOTICE_RETENTION_MS).toBeLessThan(AUTH_ATTEMPTS_RETENTION_MS);
  });
  it("SU-13-F3-04: the map returns the short window for signup_notice and the default for others", () => {
    expect(authAttemptsRetentionForKind(NOTICE_KIND)).toBe(SIGNUP_NOTICE_RETENTION_MS);
    expect(authAttemptsRetentionForKind("login")).toBe(AUTH_ATTEMPTS_RETENTION_MS);
    expect(authAttemptsRetentionForKind("otp")).toBe(AUTH_ATTEMPTS_RETENTION_MS);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd /c/Personal_Applications/JV_Leads && npx vitest run --no-file-parallelism tests/unit/auth-attempts-retention.test.ts`
Expected: FAIL — `SIGNUP_NOTICE_RETENTION_MS` / `authAttemptsRetentionForKind` not exported.

- [ ] **Step 4: Refactor `auth-attempts.ts`** — add imports and the map, and rewrite the sweep as two passes. Add near the top:

```typescript
import { and, eq, lte, ne } from "drizzle-orm";
import { NOTICE_KIND } from "@/lib/auth/notice-budget";
import { AUTH_TABLE_RETENTION_MARGIN_MS } from "@/modules/retention/auth-tables";
import { batchedDeleteByAge } from "./batched-delete";
```

Add after the existing `AUTH_ATTEMPTS_RETENTION_MS` / `authAttemptsCutoff` definitions (keep those unchanged — they remain the default):

```typescript
/**
 * F-3 (audit-security, WP-SU-13): signup_notice rows hold the raw email of a person an attacker
 * merely NAMED at signup, read only within ALREADY_REGISTERED_CAP.windowMs (24h, notice-budget.ts's
 * NOTICE_KIND). The uniform default keeps every kind ~31 days; this shortens the sharpest one to
 * ~8 days. DERIVED from the live cap window — a restated 86_400_000 would drift the day the cap moves.
 */
export const SIGNUP_NOTICE_RETENTION_MS = ALREADY_REGISTERED_CAP.windowMs + AUTH_TABLE_RETENTION_MARGIN_MS;

export function signupNoticeCutoff(now: Date): Date {
  return new Date(now.getTime() - SIGNUP_NOTICE_RETENTION_MS);
}

/**
 * Retention for one auth_attempts kind. signup_notice gets the short window; EVERY other kind gets
 * the global default — a kind not named here can never be under-retained (the safe fallback). Only
 * NOTICE_KIND is read at 24h (verified: notice-budget.ts counts NOTICE_KIND alone; LOCKOUT_WINDOW_MS
 * bounds all other reads at 1h), so no other kind needs the long window on its own account.
 */
export function authAttemptsRetentionForKind(kind: string): number {
  return kind === NOTICE_KIND ? SIGNUP_NOTICE_RETENTION_MS : AUTH_ATTEMPTS_RETENTION_MS;
}
```

Replace the body of `sweepAuthAttempts` with two passes (keep the exported signature and the existing doc-comment; append a line noting the F-3 split):

```typescript
export async function sweepAuthAttempts(
  db: DB,
  opts: { now?: Date; limit?: number } = {},
): Promise<AuthAttemptsSweepResult> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? AUTH_ATTEMPTS_SWEEP_BATCH;
  const A = schema.authAttempts;

  // F-3: signup_notice drains at its short cutoff; every other kind at the default. Two age
  // predicates rather than one CASE — each stays a bounded, oldest-first batchedDeleteByAge.
  const notice = await batchedDeleteByAge(db, {
    table: A,
    id: A.id,
    orderBy: A.createdAt,
    where: and(eq(A.kind, NOTICE_KIND), lte(A.createdAt, signupNoticeCutoff(now)))!,
    limit,
  });
  const rest = await batchedDeleteByAge(db, {
    table: A,
    id: A.id,
    orderBy: A.createdAt,
    where: and(ne(A.kind, NOTICE_KIND), lte(A.createdAt, authAttemptsCutoff(now)))!,
    limit,
  });

  return { deleted: notice.deleted + rest.deleted };
}
```

Delete the now-unused local `asc`/`inArray` imports from `auth-attempts.ts` if they are no longer referenced (the primitive owns them). Leave `AUTH_ATTEMPTS_MAX_READ_WINDOW_MS`, `AUTH_ATTEMPTS_RETENTION_MARGIN_MS`, `AUTH_ATTEMPTS_RETENTION_MS`, `authAttemptsCutoff`, `AUTH_ATTEMPTS_SWEEP_BATCH` exactly as they are — the existing enumeration tripwire still guards them.

- [ ] **Step 5: Run the unit test to verify it passes**

Run: `cd /c/Personal_Applications/JV_Leads && npx vitest run --no-file-parallelism tests/unit/auth-attempts-retention.test.ts`
Expected: PASS — the original WP-SU-11 tests AND the four new F-3 tests.

- [ ] **Step 6: Extend the integration test with a signup_notice case** — append to the existing `suite(...)` in `tests/integration/auth-attempts-retention.test.ts`. Import at top: `import { NOTICE_KIND } from "@/lib/auth/notice-budget"; import { signupNoticeCutoff } from "@/modules/retention/auth-attempts";`

```typescript
  it("SU-13-F3-05: a signup_notice row older than its SHORT cutoff is swept though the default would keep it", async () => {
    const nCut = signupNoticeCutoff(now);
    // Between the short (8d) and default (31d) cutoffs: the default pass would keep it, the notice
    // pass must delete it. Seeded with the REAL signup_notice kind (not this file's random KIND).
    const id = `su13-f3-${randomUUID()}@example.test`;
    await db.insert(schema.authAttempts).values({
      identifier: id,
      ip: null,
      kind: NOTICE_KIND,
      success: false,
      createdAt: new Date(nCut.getTime() - 60_000), // 1 min past the short cutoff
    });
    // Sanity: it is NOT past the default cutoff, so only the kind-specific pass can remove it.
    expect(nCut.getTime()).toBeGreaterThan(cutoff.getTime());

    await sweepAuthAttempts(db, { now });
    const [row] = await db
      .select({ id: schema.authAttempts.id })
      .from(schema.authAttempts)
      .where(eq(schema.authAttempts.identifier, id));
    expect(row).toBeUndefined();
  });
```

> This shares the file's existing `db`, `now`, `cutoff`. The row uses a unique `identifier`, so `afterAll`'s `KIND`-scoped cleanup won't catch it — add `await db.delete(schema.authAttempts).where(eq(schema.authAttempts.identifier, id));` at the end of the test (self-cleaning), since it is `NOTICE_KIND`, not the suite `KIND`.

- [ ] **Step 7: Run the full auth_attempts + auth-tables suites**

Run: `cd /c/Personal_Applications/JV_Leads && npx vitest run --no-file-parallelism tests/unit/auth-attempts-retention.test.ts tests/integration/auth-attempts-retention.test.ts tests/unit/auth-tables-retention.test.ts tests/integration/auth-tables-retention.test.ts`
Expected: PASS. If integration prints `skipped`, STOP and report the missing `DATABASE_URL`.

- [ ] **Step 8: Review checkpoint (do NOT commit)** — `git diff --stat`; confirm `notice-budget.ts`, `auth-attempts.ts`, and the two test files changed.

---

### Task 6: Cron wiring + ADR-0032 update + self-audit

**Files:**
- Modify: `src/app/api/cron/retention-sweep/route.ts`
- Modify: `docs/adr/0032-sentry-server-side-transport-and-cron-monitors.md` (Consequences)
- Test: `tests/unit/cron-monitor-wiring.test.ts` (must still pass — no change expected)

**Interfaces:**
- Consumes: `sweepOtpChallenges`, `sweepResetTokens`, `sweepSignupVerifications`, `sweepTrustedDevices` from `@/modules/retention/auth-tables`

**Design note (honest scope):** WP-SU-11's `auth_attempts` pass was added to this route WITHOUT a dedicated route test — each sweep is proven by its own integration test, and the best-effort/monitor-safety property is structurally identical across passes and covered by review. WP-SU-13 follows that precedent: no fragile route handler test; correctness rests on Tasks 1–5's integration tests + the unchanged `cron-monitor-wiring.test.ts`.

- [ ] **Step 1: Add the four passes to the route** — in `src/app/api/cron/retention-sweep/route.ts`, add the import:

```typescript
import {
  sweepOtpChallenges,
  sweepResetTokens,
  sweepSignupVerifications,
  sweepTrustedDevices,
} from "@/modules/retention/auth-tables";
```

After the existing `auth_attempts` best-effort block (the `let authAttempts = 0; try { … } catch { … }`), add — each pass best-effort behind its OWN code, so a hygiene failure never fails the LGL-02 monitor check-in (ADR-0032 §106-115):

```typescript
      // WP-SU-13: prune the auth SIBLING tables (otp_challenges, reset_tokens, signup_verifications,
      // trusted_devices). Each is best-effort behind its own code, for the same reason as the
      // auth_attempts pass above — this monitor answers "did the LGL-02 consumer-PII purge run", and
      // a data-minimisation hygiene failure must not raise a legal-grade alarm or mark a purge that
      // DID run as failed (ADR-0032). Cross-tenant by construction: these tables predate the tenant.
      let otpChallenges = 0;
      try {
        otpChallenges = (await sweepOtpChallenges(db)).deleted;
      } catch (e) {
        logError("cron_otp_challenges_sweep_failed", { message: e instanceof Error ? e.message : String(e) });
      }
      let resetTokens = 0;
      try {
        resetTokens = (await sweepResetTokens(db)).deleted;
      } catch (e) {
        logError("cron_reset_tokens_sweep_failed", { message: e instanceof Error ? e.message : String(e) });
      }
      let signupVerifications = 0;
      try {
        signupVerifications = (await sweepSignupVerifications(db)).deleted;
      } catch (e) {
        logError("cron_signup_verifications_sweep_failed", { message: e instanceof Error ? e.message : String(e) });
      }
      let trustedDevices = 0;
      try {
        trustedDevices = (await sweepTrustedDevices(db)).deleted;
      } catch (e) {
        logError("cron_trusted_devices_sweep_failed", { message: e instanceof Error ? e.message : String(e) });
      }

      return { tenants: swept, purged, authAttempts, otpChallenges, resetTokens, signupVerifications, trustedDevices };
```

Remove the old `return { tenants: swept, purged, authAttempts };` line it replaces.

- [ ] **Step 2: Typecheck + run the cron wiring test**

Run: `cd /c/Personal_Applications/JV_Leads && npx tsc --noEmit && npx vitest run --no-file-parallelism tests/unit/cron-monitor-wiring.test.ts tests/unit/cron-monitors.test.ts`
Expected: PASS — typecheck clean, monitor wiring unchanged (the sweeps are added inside the existing monitor callback, schedule untouched).

- [ ] **Step 3: Append the new codes to ADR-0032 Consequences** — in `docs/adr/0032-…md`, in the "What stays open" bullet, after the WP-SU-11 `cron_auth_attempts_sweep_failed` paragraph, add:

```markdown
  WP-SU-13 adds four more of the same class — `cron_otp_challenges_sweep_failed`,
  `cron_reset_tokens_sweep_failed`, `cron_signup_verifications_sweep_failed`,
  `cron_trusted_devices_sweep_failed` — the auth SIBLING-table retention passes hung off this daily
  sweep. Each is caught, not propagated, for the identical reason as `cron_auth_attempts_sweep_failed`:
  this monitor answers "did the LGL-02 consumer-PII purge run", so a data-minimisation hygiene failure
  must not fail its check-in. A healthy run is silent; the rows-deleted counts ride in the 200 response.
  Alert on all four, or these tables silently resume growing with raw third-party emails
  (otp_challenges), token hashes, and IPs (trusted_devices) in them. WP-SU-13 also right-sizes the
  auth_attempts `signup_notice` cutoff (F-3): those rows now drain at ~8 days, not ~31 — no new code,
  the same `cron_auth_attempts_sweep_failed` covers a failure.
```

- [ ] **Step 4: Run the full retention + cron test set**

Run: `cd /c/Personal_Applications/JV_Leads && npx vitest run --no-file-parallelism tests/unit/auth-tables-retention.test.ts tests/unit/auth-attempts-retention.test.ts tests/integration/auth-tables-retention.test.ts tests/integration/auth-attempts-retention.test.ts tests/unit/cron-monitor-wiring.test.ts`
Expected: ALL PASS (integration green with `DATABASE_URL`, not skipped).

- [ ] **Step 5: Self-audit + review checkpoint (do NOT commit)**

Run the PLAYBOOK §6 self-audit and print the filled checklist in the summary. Then:
Run: `cd /c/Personal_Applications/JV_Leads && git status && git diff --cached --name-only`
Confirm: the six source/doc files + four test files are the only changes, and NOTHING is staged (`git diff --cached` is empty — no `PRODUCT_BRIEF.md` / `WEBSITE-BRIEF.md` / `docs/legal/`). Hold for owner go and the review pass (`pr-reviewer` + `audit-data` + `audit-security` + `audit-devops`).

---

## Self-Review

**1. Spec coverage:**
- §3/§5 four sibling passes → Tasks 1–4. ✓
- §4 shared primitive + thin policies → Task 1 (`batched-delete.ts`), reused in 2–5. ✓
- §5 `signup_verifications` used-rows-only guard → Task 3 (`isNotNull(usedAt)`, SU-13-SGN-04 proves unconsumed rows survive). ✓
- §5 `trusted_devices` expiresAt-anchored → Task 4 (SU-13-DEV-02 covers expired + revoked). ✓
- §6 F-3 kind→retention map + derived tripwire → Task 5 (SU-13-F3-01..05, `NOTICE_KIND` exported so the literal is single-sourced). ✓
- §7 shared 7-day margin → Task 1 constant, asserted SU-13-MARGIN-01. ✓
- §8 tests: pure tripwires + integration + self-skip discipline → every task; cron test → Task 6. ✓
- §9 cron wiring + four codes + ADR-0032 update → Task 6. ✓
- §10 no migration / commit-free / serial / no brief-or-legal staging → Global Constraints + every checkpoint step. ✓
- §11 follow-ups explicitly NOT built. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows real code and exact run commands. The one illustrative `remaining` helper in Task 1 Step 6 is explicitly flagged for removal.

**3. Type consistency:** `batchedDeleteByAge(db, { table, id, orderBy, where, limit })` and `{ deleted: number }` are used identically in Tasks 1–5. `sweepXxx(db, { now?, limit? })` signature is uniform. `authAttemptsRetentionForKind`, `signupNoticeCutoff`, `SIGNUP_NOTICE_RETENTION_MS` names match between Task 5 impl and its tests. `NOTICE_KIND` is exported (Task 5 Step 1) before it is imported (Task 5 impl + Task 6 test import path).
```
