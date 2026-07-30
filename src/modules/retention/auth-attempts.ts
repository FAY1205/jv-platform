import { and, eq, lte, ne } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { LOCKOUT_WINDOW_MS } from "@/lib/auth/attempts-store";
import { ALREADY_REGISTERED_CAP } from "@/lib/auth/throttle";
import { NOTICE_KIND } from "@/lib/auth/notice-budget";
import { AUTH_TABLE_RETENTION_MARGIN_MS } from "@/modules/retention/auth-tables";
import { batchedDeleteByAge } from "./batched-delete";

// ─────────────────────────────────────────────────────────────────────────────
// auth_attempts retention pass (WP-SU-11) — the pruning ADR-0010 deferred.
//
// ADR-0010 chose Postgres over Redis for the rate-limit store and recorded the cost:
// "auth_attempts grows unbounded without pruning; a retention sweep should delete rows
// older than the largest window." Two things made it worth building now. (1) WP-SU-8
// added a `signup_notice` kind, so the table records the lowercased EMAIL ADDRESS of a
// person an attacker merely NAMED at signup — someone who never had an account here and
// never interacted with us — alongside IPs, kept forever although nothing reads past 24h.
// That is a data-minimisation problem (GDPR Art. 5(1)(c)/(e) in spirit), not just disk.
// (2) Nothing else prunes it: the WP-GL-B sweep covers leads/lead_notes/audit_log only.
//
// WHY THIS FILE AND NOT purge.ts: purge.ts is deliberately PURE **and client-safe** (no DB
// import). The cutoff below must be derived from LOCKOUT_WINDOW_MS, which lives in
// attempts-store.ts next to the drizzle client — importing it into purge.ts would drag the
// DB layer toward the client bundle. So the pure policy and its one adapter live together
// here, server-side, and purge.ts's client-safety guarantee is left intact.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The largest look-back any read of auth_attempts uses — DERIVED from the live constants,
 * never restated. ADR-0010 says this explicitly, because the figure has ALREADY moved once:
 * it was `LOCKOUT_WINDOW_MS` (1h) until WP-SU-8 added the 24h per-recipient cap on the
 * "you already have an account" mail. A literal `86_400_000` here would be correct today and
 * would silently start deleting rows a live window still reads the next time either constant
 * changes — the failure mode .superpowers/sdd/progress.md lesson 3 recorded happening INSIDE a
 * single commit. Reading the constants means that change can no longer be made in one place only.
 *
 * The two named here are the maximum by construction today; every other window read from this
 * table (the six ThrottleConfigs' 5–15 min rules, SIGNUP_GLOBAL_CEILING's and
 * SIGNUP_ALERT_COOLDOWN's 1h) is smaller, and all of them are covered many times over by the
 * margin below rather than by this max.
 */
export const AUTH_ATTEMPTS_MAX_READ_WINDOW_MS = Math.max(LOCKOUT_WINDOW_MS, ALREADY_REGISTERED_CAP.windowMs);

/**
 * Safety margin added on top of the largest read window. THIS is the property that makes the
 * sweep unable to race a live rate-limit or lockout decision: at 30 days it is ~30x the largest
 * window, so a future WP can widen any window up to a month without this file needing to know.
 * (Anything LONGER than the margin must be added to the max above — the unit test's
 * `>= ALREADY_REGISTERED_CAP.windowMs` assertions are the tripwire.)
 *
 * It also keeps the retention promise honest in the other direction: a deleted row is one that
 * no code path can read, so nothing observable changes — the sweep is pure data minimisation.
 */
export const AUTH_ATTEMPTS_RETENTION_MARGIN_MS = 30 * 24 * 60 * 60 * 1000;

/** How long an auth_attempts row is kept: the largest live read window plus the margin. */
export const AUTH_ATTEMPTS_RETENTION_MS = AUTH_ATTEMPTS_MAX_READ_WINDOW_MS + AUTH_ATTEMPTS_RETENTION_MARGIN_MS;

/** The cutoff instant: rows created at or before this are eligible for deletion. Pure — `now`
 *  is injected (PRN-01 in spirit; mirrors purge.ts's retentionCutoff). */
export function authAttemptsCutoff(now: Date): Date {
  return new Date(now.getTime() - AUTH_ATTEMPTS_RETENTION_MS);
}

/**
 * F-3 (audit-security, WP-SU-13): signup_notice rows hold the raw email of a person an attacker
 * merely NAMED at signup, read only within ALREADY_REGISTERED_CAP.windowMs (24h, notice-budget.ts's
 * NOTICE_KIND). The uniform default keeps every kind ~31 days; this shortens the sharpest one to
 * ~8 days. DERIVED from the live cap window — a restated 86_400_000 would drift the day the cap moves.
 */
export const SIGNUP_NOTICE_RETENTION_MS = ALREADY_REGISTERED_CAP.windowMs + AUTH_TABLE_RETENTION_MARGIN_MS;

/**
 * Retention for one auth_attempts kind. signup_notice gets the short window; EVERY other kind gets
 * the global default — a kind not named here can never be under-retained (the safe fallback). Only
 * NOTICE_KIND is read at 24h (verified: notice-budget.ts counts NOTICE_KIND alone; LOCKOUT_WINDOW_MS
 * bounds all other reads at 1h), so no other kind needs the long window on its own account.
 */
export function authAttemptsRetentionForKind(kind: string): number {
  return kind === NOTICE_KIND ? SIGNUP_NOTICE_RETENTION_MS : AUTH_ATTEMPTS_RETENTION_MS;
}

export function signupNoticeCutoff(now: Date): Date {
  // Route through the map so authAttemptsRetentionForKind is the single policy source the sweep
  // actually consumes (not a parallel definition that could drift — ADR-0010). Equals
  // now - SIGNUP_NOTICE_RETENTION_MS by construction; the "rest" pass's authAttemptsCutoff is the
  // map's non-notice arm (now - AUTH_ATTEMPTS_RETENTION_MS). The two-pass sweep partitions notice
  // vs. rest, so a future THIRD distinct-retention kind would need its own pass, not just a map case.
  return new Date(now.getTime() - authAttemptsRetentionForKind(NOTICE_KIND));
}

type DB = PostgresJsDatabase<typeof schema>;

/** Max rows one sweep PASS deletes. Mirrors RETENTION_SWEEP_BATCH's reasoning — bounded so a single
 *  run stays cheap and predictable under the route's maxDuration, larger because these are
 *  narrow rows with no per-row work. Since the F-3 split runs two passes (signup_notice + the rest),
 *  one sweepAuthAttempts call can delete up to 2× this; the cap is per-pass, not per-call. The sweep
 *  is idempotent, so any remainder drains on the next daily run. */
export const AUTH_ATTEMPTS_SWEEP_BATCH = 5_000;

export interface AuthAttemptsSweepResult {
  deleted: number;
}

/**
 * Delete auth_attempts rows past the retention cutoff. NOT tenant-scoped, and PRN-08 is not
 * bypassed here: auth runs before a tenant is known, so `auth_attempts` carries no tenant_id at
 * all (ADR-0010) — it is a member of the same tenant-less auth-table set as reset_tokens and
 * signup_verifications. There is no scope to filter by, only an age predicate.
 *
 * DELETE-ONLY BY DESIGN — no migration accompanies this WP. The table is RLS deny-by-default
 * (migration 0004) and service-role managed, so the existing policy already covers this write,
 * and removing rows needs no schema change.
 *
 * NO AUDIT ROW, unlike sweepTenantPii. That sweep redacts business records whose history DM-04
 * requires; these are rate-limiter bookkeeping with no business meaning, and writing one
 * audit_log row per deleted attempt would re-persist the very identifiers (email, IP) the delete
 * exists to remove — into an append-only table that cannot then be pruned. The run's count is
 * reported by the cron route instead.
 *
 * Select-then-delete (mirrors sweepTenantPii) rather than one predicate DELETE: it makes the
 * `limit` a hard bound on rows touched, and keeps the ordering explicit. Oldest-first so a
 * backlog larger than one batch drains deterministically instead of leaving arbitrary stragglers.
 * No transaction and no advisory lock: a concurrent duplicate run can at worst try to delete rows
 * the other already removed, which is a no-op — there is no append-only side effect to double-write.
 *
 * ACCEPTED COST: no index leads with `created_at` alone (all three lead with an attacker-chosen
 * column or `kind`), so the select is a sequential scan plus a top-N sort. Once a day, on the
 * volume ADR-0010 sized this table for, that is cheaper than the migration and the write-path
 * index maintenance it would otherwise cost. Revisit together with ADR-0010's "swap in Redis"
 * trigger — the same growth makes both worth doing.
 *
 * BATCH BOUNDS THE SWEEP'S COST, NOT THE INSERT RATE (audit-data, WP-SU-11 review). WP-SU-9's
 * reserve-before-decide writes an auth_attempts row for every request that reaches a throttled
 * endpoint, INCLUDING rejected ones — so a sustained, distributed abuse burst can insert well
 * over AUTH_ATTEMPTS_SWEEP_BATCH rows in a day, and this once-daily drain would then let the
 * table grow DURING the attack rather than holding it flat. That is accepted at V1 volume
 * (ADR-0010's "not urgent at this volume"); if abuse volume is ever observed, rate-match the
 * cadence/batch to the insert rate (a shorter cron interval, or a larger batch) before reaching
 * for the Redis swap.
 *
 * F-3 (WP-SU-13): split into two age-bounded passes — signup_notice drains at its own short
 * cutoff, every other kind at the default — rather than one predicate, via the shared
 * batchedDeleteByAge primitive (auth-tables.ts's sibling sweeps use the same shape).
 */
export async function sweepAuthAttempts(
  db: DB,
  opts: { now?: Date; limit?: number } = {},
): Promise<AuthAttemptsSweepResult> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? AUTH_ATTEMPTS_SWEEP_BATCH;
  const A = schema.authAttempts;

  // F-3: signup_notice drains at its short cutoff; every other kind at the default. Two age
  // predicates rather than one CASE — each stays a bounded, oldest-first batchedDeleteByAge.
  // The passes partition the table exactly (kind is NOT NULL), so no row is missed or deleted twice.
  // The notice pass's `eq(kind, …)` gives auth_attempts_kind_created_idx (migration 0027) a leading
  // equality bound → an index scan, no sort. The rest pass's `ne(kind, …)` does NOT — a `!=` can't
  // bound a btree range, so it plans the same seq-scan + top-N sort the pre-F-3 single pass did
  // (verified by EXPLAIN, audit-data WP-SU-13 review). Same cost class, not a regression.
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
