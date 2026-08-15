import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { pgErrorCode } from "@/lib/db/pg-error";

type DB = PostgresJsDatabase<typeof schema>;

// ─────────────────────────────────────────────────────────────────────────────
// RLS behaviour oracle (WP-SEC-1 / RLSB-01, ADR-0046). The app connects to Postgres
// as the table OWNER and bypasses RLS by design (ADR-0013); lib/scope.ts is the
// app-layer boundary. These policies exist for the OTHER surface — the non-owner
// `authenticated`/PostgREST connection Supabase exposes, where table CRUD grants exist
// (verified live). A test that reads pg_policies.qual/with_check proves a policy SAYS
// the right thing; only running a query AS that non-owner role, under bound JWT claims,
// proves Postgres ENFORCES it. This helper is that path: it opens a transaction,
// `set local`s the role to `authenticated` and the JWT claims, runs the caller's
// read/write, then ALWAYS rolls back (writes never persist). `set local` scopes both to
// the transaction, so nothing leaks to the owner-connection setup/teardown around it.
// ─────────────────────────────────────────────────────────────────────────────

export interface RlsClaims {
  /** JWT `sub` → app_current_user(). */
  sub: string;
  /** app_metadata.tenant_id → app_current_tenant(). */
  tenantId: string;
  /** app_metadata.role → app_current_role(). */
  role: "admin" | "partner";
  /** app_metadata.partner_id → app_current_partner(). Omit for admin. */
  partnerId?: string;
}

/** SQLSTATE Postgres raises when a WITH CHECK clause rejects a new/updated row. */
export const POLICY_VIOLATION = "42501";

/** Internal sentinel: thrown to force the always-rollback, distinguished from real errors. */
class Rollback extends Error {}

function claimsJson(c: RlsClaims): string {
  const appMetadata: Record<string, string> = { tenant_id: c.tenantId, role: c.role };
  if (c.partnerId) appMetadata.partner_id = c.partnerId;
  return JSON.stringify({ sub: c.sub, app_metadata: appMetadata });
}

/**
 * Run `fn` as the non-owner `authenticated` role with `claims` bound, in a transaction
 * that ALWAYS rolls back. Returns whatever `fn` returns (typically read rows). Claims are
 * set BEFORE the role switch so the privileged GUC write happens as the owner.
 *
 * NOT concurrency-safe: it `set local`s role + claims on one `max:1` connection, so two
 * overlapping calls (e.g. `Promise.all([asRole(a), asRole(b)])`) would interleave different
 * identities on the same physical connection. Always `await` one before the next.
 */
export async function asRole<T>(db: DB, claims: RlsClaims, fn: (tx: DB) => Promise<T>): Promise<T> {
  let captured!: T;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('request.jwt.claims', ${claimsJson(claims)}, true)`);
      await tx.execute(sql`set local role authenticated`);
      captured = await fn(tx as unknown as DB);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return captured;
}

export interface WriteProbe {
  /** True when the write did NOT take effect: it was blocked (42501) OR nothing persisted. */
  denied: boolean;
  /** The write raised SQLSTATE 42501 — a WITH CHECK clause rejected the row. */
  blocked: boolean;
  /** Owner-observed count of the write's intended effect after it ran (0 = nothing landed). */
  effected: number;
}

/**
 * Attempt a write as `claims` and measure whether it ACTUALLY took effect, always rolling back.
 *
 * `write` performs the INSERT/UPDATE/DELETE and MUST NOT use RETURNING: a RETURNING clause
 * re-applies the SELECT/USING policy to the new row, so a write that a weak WITH CHECK ALLOWS
 * to persist still raises 42501 on RETURNING and would be misread as "denied" (the WP-SEC-1
 * soundness bug — a returning-based check reports false denials for exactly the tenant-only
 * WITH CHECK policies WP-SEC-2 fixes). `effect` runs AFTER the write with RLS reset to the
 * table owner and returns the count of rows proving the write landed (the inserted row, or the
 * updated row in its new shape). Denial = the write was blocked (42501) OR nothing was effected.
 *
 * A blocked write aborts the transaction, so `effect` is skipped in that case (a blocked write
 * cannot have persisted anything). Everything rolls back regardless of outcome.
 */
export async function probeWrite(
  db: DB,
  claims: RlsClaims,
  write: (tx: DB) => Promise<void>,
  effect: (tx: DB) => Promise<number>,
): Promise<WriteProbe> {
  let blocked = false;
  let effected = 0;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('request.jwt.claims', ${claimsJson(claims)}, true)`);
      await tx.execute(sql`set local role authenticated`);
      try {
        await write(tx as unknown as DB);
      } catch (e) {
        if (pgErrorCode(e) === POLICY_VIOLATION) blocked = true;
        else throw e;
      }
      if (!blocked) {
        // Back to the table owner (RLS bypassed) to observe TRUE persistence, not a
        // RETURNING/USING-filtered view. `set local role` reverts on rollback regardless.
        await tx.execute(sql`reset role`);
        effected = await effect(tx as unknown as DB);
      }
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return { denied: blocked || effected === 0, blocked, effected };
}
