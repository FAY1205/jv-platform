import { and, eq, gt, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import type { AttemptSnapshot, ThrottleConfig } from "./throttle";

// AUT-03/04: Postgres-backed auth-attempt log (ADR-0010 — no new infra at this
// volume). Records each attempt and reads the timestamp snapshot the pure throttle
// decision consumes. Server-managed via the service role; the table is RLS
// deny-by-default (0004 migration).

type DB = PostgresJsDatabase<typeof schema>;

/** Lockout look-back — covers the full exponential escalation (cap is 1h). */
export const LOCKOUT_WINDOW_MS = 3_600_000;

const toMs = (rows: { t: Date }[]): number[] =>
  rows.map((r) => (r.t instanceof Date ? r.t : new Date(r.t as unknown as string)).getTime());

export class AuthAttemptsStore {
  constructor(private db: DB) {}

  /**
   * WP-SU-9 (CWE-367): reserve this attempt BEFORE the throttle decision, so the snapshot that
   * follows counts it. Returns the row id, which `settle` later stamps with the real outcome.
   *
   * WHY THIS IS ATOMIC WITHOUT A LOCK OR A TRANSACTION: drizzle autocommits each statement, so
   * the row is committed before the snapshot query begins. Every snapshot therefore sees its
   * own row plus every row committed before it started, and two racing requests cannot both
   * miss each other — whichever counts last sees both. With limit L and L rows already present,
   * two racers each see at least L+1 and both refuse. The decision can OVER-block under
   * contention and can never UNDER-block, which is the correct direction for a limiter.
   * (Measured before this change: 10 of 10 concurrent requests were admitted against a limit
   * of 3 — the old snapshot-then-record order made the limit entirely inoperative in a burst.)
   *
   * Written as success:TRUE deliberately. `success` is dual-purpose — every row feeds the rate
   * window, but only `false` rows feed the AUT-04 progressive lockout ladder. A `false`
   * reservation would let a stranger lock any account by hammering the endpoint, because a
   * REFUSED request never reaches the code that would settle it.
   */
  async reserve(identifier: string, ip: string | null, kind: string): Promise<string> {
    const [row] = await this.db
      .insert(schema.authAttempts)
      .values({ identifier: identifier.toLowerCase(), ip, kind, success: true })
      .returning({ id: schema.authAttempts.id });
    return row.id;
  }

  /**
   * Record the real outcome of a reserved attempt, at the point the route previously called
   * `record`. A COMPLETED request therefore leaves a row identical to the pre-WP-SU-9 one; only
   * a request refused at the gate differs, and it now consumes rate budget but not lockout
   * budget. Always writes, including `true` — an unconditional statement is cheaper to reason
   * about than a no-op that silently depends on `reserve`'s default staying what it is.
   */
  async settle(id: string, success: boolean): Promise<void> {
    await this.db.update(schema.authAttempts).set({ success }).where(eq(schema.authAttempts.id, id));
  }

  /**
   * Record an attempt whose outcome is known up front and which is NOT part of a throttle
   * decision (the WP-SU-8 notification budgets). Throttled endpoints use reserve/settle —
   * using this one there reintroduces the TOCTOU that WP-SU-9 exists to close.
   */
  async record(identifier: string, ip: string | null, kind: string, success: boolean): Promise<void> {
    await this.db
      .insert(schema.authAttempts)
      .values({ identifier: identifier.toLowerCase(), ip, kind, success });
  }

  /** The timestamp snapshot for a (identifier, ip, kind) at `now`. */
  async snapshot(
    identifier: string,
    ip: string | null,
    kind: string,
    now: number,
    cfg: ThrottleConfig,
  ): Promise<AttemptSnapshot> {
    const id = identifier.toLowerCase();
    const idSince = new Date(now - cfg.perIdentifier.windowMs);
    const ipSince = new Date(now - cfg.perIp.windowMs);
    const failSince = new Date(now - LOCKOUT_WINDOW_MS);
    const A = schema.authAttempts;

    const [attempts, ipAttempts, failures] = await Promise.all([
      this.db.select({ t: A.createdAt }).from(A)
        .where(and(eq(A.identifier, id), eq(A.kind, kind), gt(A.createdAt, idSince))),
      ip
        ? this.db.select({ t: A.createdAt }).from(A)
            .where(and(eq(A.ip, ip), eq(A.kind, kind), gt(A.createdAt, ipSince)))
        : Promise.resolve([] as { t: Date }[]),
      this.db.select({ t: A.createdAt }).from(A)
        .where(and(eq(A.identifier, id), eq(A.kind, kind), eq(A.success, false), gt(A.createdAt, failSince))),
    ]);

    return { attempts: toMs(attempts), ipAttempts: toMs(ipAttempts), failures: toMs(failures) };
  }

  /** Admin unlock (AUT-04): clear the recent failed attempts for an identifier. */
  async clearFailures(identifier: string, kind: string): Promise<void> {
    const A = schema.authAttempts;
    await this.db
      .delete(A)
      .where(and(eq(A.identifier, identifier.toLowerCase()), eq(A.kind, kind), eq(A.success, false)));
  }

  /** Recent failed-attempt count from one IP (anomaly detection, AUT-03). */
  async ipFailureCount(ip: string, kind: string, now: number, windowMs: number): Promise<number> {
    const A = schema.authAttempts;
    const [row] = await this.db
      .select({ c: sql<number>`count(*)::int` })
      .from(A)
      .where(and(eq(A.ip, ip), eq(A.kind, kind), eq(A.success, false), gt(A.createdAt, new Date(now - windowMs))));
    return row?.c ?? 0;
  }

  /**
   * WP-SU-8: attempts for ONE identifier under one kind in a window.
   *
   * Deliberately not `snapshot()`: that always issues three queries, one of which is a
   * `success:false` lockout scan. The notification budgets (notice-budget.ts) only ever write
   * `success:true` rows and never consult an IP, so two of those three are structurally
   * guaranteed to return nothing — and passing a `perIp` rule to satisfy snapshot's config
   * type read as though an IP-scoped cap existed when none can.
   */
  async identifierCount(identifier: string, kind: string, now: number, windowMs: number): Promise<number> {
    const A = schema.authAttempts;
    const [row] = await this.db
      .select({ c: sql<number>`count(*)::int` })
      .from(A)
      .where(
        and(
          eq(A.identifier, identifier.toLowerCase()),
          eq(A.kind, kind),
          gt(A.createdAt, new Date(now - windowMs)),
        ),
      );
    return row?.c ?? 0;
  }

  /**
   * WP-SU-8: total attempts of one kind across ALL identifiers and IPs in a window.
   * The per-identifier and per-IP windows are both keyed on values an attacker picks
   * freely (a fresh email, a rotated IP), so this is the only dimension that bounds a
   * distributed burst. Backed by auth_attempts_kind_created_idx (migration 0027).
   */
  async kindCount(kind: string, now: number, windowMs: number): Promise<number> {
    const A = schema.authAttempts;
    const [row] = await this.db
      .select({ c: sql<number>`count(*)::int` })
      .from(A)
      .where(and(eq(A.kind, kind), gt(A.createdAt, new Date(now - windowMs))));
    return row?.c ?? 0;
  }
}
