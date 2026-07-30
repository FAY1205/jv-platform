import { asc, inArray, lte } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { LOCKOUT_WINDOW_MS } from "@/lib/auth/attempts-store";
import { ALREADY_REGISTERED_CAP } from "@/lib/auth/throttle";

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

type DB = PostgresJsDatabase<typeof schema>;

/** Max rows one run deletes. Mirrors RETENTION_SWEEP_BATCH's reasoning — bounded so a single
 *  run stays cheap and predictable under the route's maxDuration, larger because these are
 *  narrow rows with no per-row work. The sweep is idempotent, so any remainder drains on the
 *  next daily run. */
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
 */
export async function sweepAuthAttempts(
  db: DB,
  opts: { now?: Date; limit?: number } = {},
): Promise<AuthAttemptsSweepResult> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? AUTH_ATTEMPTS_SWEEP_BATCH;
  const cutoff = authAttemptsCutoff(now);
  const A = schema.authAttempts;

  // Inclusive boundary (lte), matching purge.ts's isPastRetention contract. The reads this
  // protects all use a strict `gt(createdAt, since)`, so a row exactly AT a window edge is
  // already unreadable — and the cutoff sits 30 days beyond the largest of them regardless.
  const stale = await db
    .select({ id: A.id })
    .from(A)
    .where(lte(A.createdAt, cutoff))
    .orderBy(asc(A.createdAt))
    .limit(limit);

  if (stale.length === 0) return { deleted: 0 };

  const removed = await db
    .delete(A)
    .where(
      inArray(
        A.id,
        stale.map((r) => r.id),
      ),
    )
    .returning({ id: A.id });

  return { deleted: removed.length };
}
