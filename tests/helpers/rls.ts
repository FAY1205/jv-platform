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
  /** app_metadata.role → app_current_role(). Phase C: the admin-stream tiers take the staff
   *  arm of every policy (the SCP-09 allowlist, migration 0054). OMIT to probe an UNBOUND
   *  claim — RLSB-08 proves every arm denies it. */
  role?: "admin" | "partner" | "member" | "viewer";
  /** app_metadata.partner_id → app_current_partner(). Omit for admin. */
  partnerId?: string;
}

/** SQLSTATE Postgres raises when a WITH CHECK clause rejects a new/updated row — also raised for
 *  a table-privilege (grant) denial, which is why the WP-SEC-3 grant-revoke tests key on it too. */
export const POLICY_VIOLATION = "42501";

/**
 * The RLS ENFORCEMENT suites drive the Supabase `authenticated`/PostgREST role+grant surface
 * (`set role authenticated`, table grants), which a vanilla Postgres does not have out of the
 * box (`role "authenticated" does not exist`, no SELECT grants). Locally this is detected by the
 * Supabase DATABASE_URL. The pg_policies TEXT assertions in the other suites run everywhere.
 */
export const IS_SUPABASE_DB = !!process.env.DATABASE_URL && /supabase\./i.test(process.env.DATABASE_URL);

/**
 * C-30: the enforcement oracle now also runs in CI, not just the local/dev loop. CI's integration
 * job creates the roles (migration 0044) and, after `db:migrate`, provisions the missing SELECT
 * grants (tests/helpers/ci-rls-grants.sql) so a vanilla Postgres presents the same surface a real
 * Supabase DB does post-0045/0046 — then sets RLS_ORACLE=1 to opt these suites in. A regression in
 * ACTUAL RLS enforcement now fails CI, where before only the pg_policies TEXT assertions did.
 *
 * To reproduce a CI-only oracle failure LOCALLY against a plain (non-Supabase) DATABASE_URL, set
 * RLS_ORACLE=1 AND first run the companion grants — otherwise the suites un-skip without the
 * SELECT surface and fail with confusing 42501s:
 *   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/helpers/ci-rls-grants.sql
 */
export const RLS_ORACLE_ENABLED = IS_SUPABASE_DB || process.env.RLS_ORACLE === "1";

/** The lead-family tables whose write DML is revoked from anon/authenticated (WP-SEC-3, migration
 *  0045). Single source of truth shared by the oracle's in-txn grant and the rls-grants tests —
 *  keep in lockstep with 0045's REVOKE list. */
export const LEAD_FAMILY_TABLES = ["leads", "lead_notes", "lead_tasks", "lead_status_history", "listing_checks"] as const;

/** Internal sentinel: thrown to force the always-rollback, distinguished from real errors. */
class Rollback extends Error {}

function claimsJson(c: RlsClaims): string {
  const appMetadata: Record<string, string> = { tenant_id: c.tenantId };
  if (c.role) appMetadata.role = c.role;
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
      // WP-SEC-3: base-state INSERT/UPDATE/DELETE grants are revoked from `authenticated`
      // (migration 0045), so the WITH CHECK layer is only reachable WITH a grant. Grant it back
      // inside this rolled-back transaction (as owner, before the role switch) so probeWrite keeps
      // exercising the RLS policy as defense-in-depth; the rollback reverts the grant, leaving the
      // base state revoked. Idempotent if 0045 has not been applied yet (grant already present).
      // The real revoked write surface is tested separately via asRole (which grants nothing).
      await tx.execute(sql.raw(`grant insert, update, delete on ${LEAD_FAMILY_TABLES.join(", ")} to authenticated`));
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
        // Positive control (audit-security F-3): the persistence count is only truthful if the
        // effect query runs as the RLS-bypassing owner. If a future env connected as a non-owner
        // role, `reset role` would land on a role still under RLS and a persisted write could be
        // miscounted 0 → false "denied". Fail loudly instead of silently masking a real hole.
        const [{ role }] = await tx.execute<{ role: string }>(sql`select current_user as role`);
        if (role === "authenticated") {
          throw new Error("probeWrite: reset role did not restore the owner — persistence count would be RLS-filtered and untrustworthy");
        }
        effected = await effect(tx as unknown as DB);
      }
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return { denied: blocked || effected === 0, blocked, effected };
}
