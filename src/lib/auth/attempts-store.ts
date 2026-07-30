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
