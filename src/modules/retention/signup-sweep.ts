import { and, asc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as schema from "@/db/schema";
import { SIGNUP_TTL_MS } from "@/lib/auth/signup-token";
import { logError } from "@/lib/observability";

// ─────────────────────────────────────────────────────────────────────────────
// Signup-sweep adapter (WP-SU-2, ADR-0033's WP-SU-1 note). WP-SU-1 moved signup
// provisioning into `after()` so the response can't be timed to distinguish a new
// email from a taken one (AUT-05). The trade-off: provisioning now runs AFTER the
// 200 and in two persisted steps (provisionSignup's tx, THEN the separate
// signup_verifications row), so THREE failure shapes accumulate with nothing
// watching them —
//   1. a genuinely abandoned signup: tenant+user+audit+signup_verifications rows
//      all exist, but the user never clicked the verification link
//      (sweepAbandonedSignups — per-tenant, starts FROM signup_verifications).
//   2. an after()-dropped orphan: the platform killed the function before any DB
//      write, so an unconfirmed Supabase auth user exists with NO app-side rows at all.
//   3. a partial provision: provisionSignup's tx landed (tenant+user+audit+tos
//      rows) but the SEPARATE signup_verifications persist died in `after()`, so a
//      tenant+user exist with an unconfirmed auth user but NO verification row.
// Shapes 2 and 3 are BOTH detected from the unconfirmed-auth-user population by ONE
// listUsers collect pass (reconcileDroppedSignups): an unconfirmed, past-grace,
// signup-marked auth user with no `users` row is an orphan; with a `users` row but no
// signup_verifications row is a partial. Detecting off the auth population — NOT a
// `users` LEFT JOIN — is load-bearing (fix round 2 item 1): confirmed admins/partners
// also carry no verification row and would permanently saturate an oldest-first LIMITed
// users-table query, starving detection of a genuine recent partial; here they never
// enter the candidate set because email_confirmed_at filters them out, so the population
// is only ever dropped signups and drains naturally. ADR-0033: "a 200 with no
// verification row MUST alert" — shapes 2 and 3 are exactly that, each firing its own
// logError signal.
// Mirrors sweep.ts: bounded, idempotent, tenant-scoped per-tenant sweep for (1); the
// merged pass for (2)+(3) has no single tenant to scope by and must scan the auth-user
// population plus users/signup_verifications across tenants, so it is a documented
// cross-tenant system op (PRN-08, same exemption class as emailExistsGlobally / the
// cron tenant list).
// ─────────────────────────────────────────────────────────────────────────────

type DB = PostgresJsDatabase<typeof schema>;

/** Matches SIGNUP_TTL_MS (signup-token.ts) — a verification token IS the grace window:
 *  once it expires, the signup is eligible for cleanup. Used directly by
 *  reconcileDroppedSignups, which has no expiresAt to check
 *  (no verification row exists) and gates on the auth user's created_at. */
export const SIGNUP_ABANDON_GRACE_MS = SIGNUP_TTL_MS;

/** Max rows swept per tenant/pass per run. In practice a tenant has at most one signup — bounded
 *  anyway so a pathological input can't make one run expensive; the sweep is idempotent so a
 *  remainder is picked up next run. */
export const SIGNUP_SWEEP_BATCH = 200;

/** The app_metadata marker provisionSignup stamps on the auth user at creation
 *  ({ tenant_id, role:"admin" }). Every OTHER createUser path (provisionAdmin,
 *  provisionPartnerUser) sets email_confirm:true, so an UNCONFIRMED auth user that
 *  still carries this marker is provably signup-originated — the discriminator the
 *  destructive passes gate on so they never delete a legitimate admin/partner account. */
function isSignupOriginated(authUser: { app_metadata?: unknown }): boolean {
  const meta = authUser.app_metadata as { role?: string; tenant_id?: string } | undefined;
  return meta?.role === "admin" && Boolean(meta?.tenant_id);
}

export interface SignupSweepResult {
  purged: number;
  /** Candidates skipped conservatively because their Supabase auth user could not be read
   *  (getUserById errored/missing) — an unknown state we never guess-delete. Surfaced so the
   *  cron can report it: a persistently non-zero skipped count is itself a signal. */
  skipped: number;
}

/**
 * Hard-delete every app-side row for one provably-abandoned signup, then its auth user.
 * Shared by BOTH destructive passes (sweepAbandonedSignups and reconcileDroppedSignups)
 * so the delete order lives in exactly one place.
 *
 * INVARIANT (load-bearing — keep this list in sync with provisionSignup): the only rows an
 * unconfirmed, never-verified signup can own are its audit_log `tenant.signup_provisioned`
 * row, its tos_acceptances row, its users row, its (optional) signup_verifications row, and
 * its tenants row. Any NEW tenant-scoped write reachable before verification MUST be added to
 * this delete order, or the tenants delete will FK-fail (surfacing as item G's per-tenant log).
 *
 * TOCTOU (WP-B, resend now EXISTS): a signup can become non-abandoned between the caller's
 * candidate scan and this delete, two ways — the user clicks verify (auth user flips to
 * confirmed), or the user hits resend (a fresh, unexpired verification row is rotated in). Either
 * would make purging here destroy a live signup. So this re-checks BOTH conditions immediately
 * before the destructive tx and returns false (purged nothing) if the signup is no longer provably
 * abandoned. Returns true only when it actually purged, so callers count accurately.
 */
async function purgeAbandonedSignup(
  db: DB,
  admin: SupabaseClient,
  opts: { tenantId: string; userId: string; now: Date },
): Promise<boolean> {
  const { tenantId, userId, now } = opts;

  // Guard 1 — verify-during-sweep: re-read confirmation right before deleting. A user who clicked
  // the link after the caller's scan is now a real, active tenant; never delete it.
  const recheck = await admin.auth.admin.getUserById(userId);
  if (recheck.error || !recheck.data.user) {
    logError("signup_sweep_recheck_missing_auth_user", { tenantId });
    return false;
  }
  if (recheck.data.user.email_confirmed_at) return false;

  // Guard 2 — resend-during-sweep: if a live (unexpired, unused) verification token now exists, the
  // user asked for a new link and may still verify. A verified token has used_at set, so this
  // deliberately does NOT catch that case — guard 1 does, via the confirmed re-check above.
  const live = await db
    .select({ id: schema.signupVerifications.id })
    .from(schema.signupVerifications)
    .where(
      and(
        eq(schema.signupVerifications.userId, userId),
        isNull(schema.signupVerifications.usedAt),
        gt(schema.signupVerifications.expiresAt, now),
      ),
    )
    .limit(1);
  if (live.length) return false;

  await db.transaction(async (tx) => {
    // DM-08/ADR-0031 escape hatch: audit_log is append-only (migration 0014's trigger) and
    // audit_log.tenant_id is a hard FK (ON DELETE no action), so the tenant row can never be
    // dropped while its audit_log row survives. Owner-approved (plan WP-SU-2): an abandoned,
    // never-verified tenant is the one sanctioned hard-delete of audit_log — the same
    // production-side mechanism tests/helpers/audit.ts's purgeAuditLog uses for teardown,
    // scoped here to exactly this tenantId AND exactly the `tenant.signup_provisioned` row the
    // brief authorized (item F): if any OTHER audit row ever exists for this tenant it is left
    // in place, the tenants delete FK-fails, and item G logs it — the intended conservative stop.
    await tx.execute(sql`set local app.audit_log_purge = 'on'`);
    await tx
      .delete(schema.auditLog)
      .where(and(eq(schema.auditLog.tenantId, tenantId), eq(schema.auditLog.action, "tenant.signup_provisioned")));
    await tx.delete(schema.tosAcceptances).where(eq(schema.tosAcceptances.userId, userId));
    await tx.delete(schema.users).where(eq(schema.users.id, userId));
    // By userId (not a single verificationId) so a resend path's sibling rows leave no residue (item I).
    await tx.delete(schema.signupVerifications).where(eq(schema.signupVerifications.userId, userId));
    // WP-B: release the invitation code this tenant burned at provisioning (used_by_tenant_id was
    // stamped in provisionSignup). Without this, an abandoned signup permanently spends the
    // prospect's single-use code — they cannot retry until the owner mints a new one. Set it back
    // to unused; if it hasn't yet hit its own 48h TTL, the same code redeems again. No FK on
    // used_by_tenant_id, so this is safe in any order relative to the tenants delete.
    await tx
      .update(schema.signupCodes)
      .set({ usedAt: null, usedByTenantId: null })
      .where(eq(schema.signupCodes.usedByTenantId, tenantId));
    await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
  });

  // Delete the auth user AFTER the DB rows are gone. If this call fails, the leftover
  // unconfirmed auth user (now with no users row) is exactly what reconcileDroppedSignups
  // detects and cleans up on the next run — self-healing, no special-case retry needed.
  const del = await admin.auth.admin.deleteUser(userId);
  if (del.error) {
    logError("signup_sweep_delete_auth_user_failed", { tenantId, message: del.error.message });
  }
  return true;
}

/**
 * Purge provably-abandoned signups for ONE tenant: signup_verifications rows past grace
 * (expired) and unconsumed (never used), joined through users.id → users.tenantId (the
 * ADR-0033 tenant-less auth-table exception — signup_verifications carries no tenant_id).
 *
 * For each candidate, the Supabase auth user is the source of truth on whether it's
 * genuinely abandoned:
 *  - still unconfirmed (email_confirmed_at unset) → provably abandoned. Hard-delete via
 *    purgeAbandonedSignup. PRN-05 does not apply: this is not a historical assignment, it's
 *    a tenant that never went live.
 *  - confirmed → NOT abandoned; a confirmed user's expired token is normal residue (e.g. they
 *    verified through a different/retried link). Only the stale verification row is cleared —
 *    the tenant/user are never touched.
 *  - auth user missing (getUserById errors) → unknown state. Treat conservatively: skip this
 *    candidate entirely rather than guess, count it as `skipped`, and log without any PII.
 *
 * Idempotent: an already-purged tenant has no remaining candidates, so a re-run is a
 * no-op. Bounded to SIGNUP_SWEEP_BATCH candidates per call.
 */
export async function sweepAbandonedSignups(
  db: DB,
  admin: SupabaseClient,
  opts: { tenantId: string; now?: Date; limit?: number },
): Promise<SignupSweepResult> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? SIGNUP_SWEEP_BATCH;

  const candidates = await db
    .select({ verificationId: schema.signupVerifications.id, userId: schema.signupVerifications.userId })
    .from(schema.signupVerifications)
    .innerJoin(schema.users, eq(schema.users.id, schema.signupVerifications.userId))
    .where(
      and(
        eq(schema.users.tenantId, opts.tenantId),
        isNull(schema.signupVerifications.usedAt),
        lte(schema.signupVerifications.expiresAt, now),
      ),
    )
    // Oldest-first (mirrors sweep.ts): fair, deterministic draining if a tenant ever has
    // more than SIGNUP_SWEEP_BATCH candidates (not the common case — one signup per tenant).
    .orderBy(asc(schema.signupVerifications.expiresAt))
    .limit(limit);

  let purged = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    const { data, error } = await admin.auth.admin.getUserById(candidate.userId);
    const authUser = error ? null : data.user;

    if (!authUser) {
      // Missing auth user + still-unconfirmed-unknown (plan WP-SU-2 controller resolution):
      // treat conservatively — skip tenant deletion rather than guess. SEC-05: tenantId only.
      logError("signup_sweep_missing_auth_user", { tenantId: opts.tenantId });
      skipped += 1;
      continue;
    }

    if (authUser.email_confirmed_at) {
      // Confirmed: never delete a verified tenant. Just clear the stale residue row.
      await db.delete(schema.signupVerifications).where(eq(schema.signupVerifications.id, candidate.verificationId));
      continue;
    }

    // Provably abandoned: expired + unconsumed + still-unconfirmed. purge re-checks both race
    // conditions (verify/resend) at delete time and returns false if it declined — count only real purges.
    if (await purgeAbandonedSignup(db, admin, { tenantId: opts.tenantId, userId: candidate.userId, now })) {
      purged += 1;
    }
  }

  return { purged, skipped };
}

export interface DroppedSignupReconcileResult {
  /** after()-dropped orphans deleted: unconfirmed + marked + past grace + NO `users` row. */
  orphans: number;
  /** partial provisions purged: unconfirmed + marked + past grace + `users` row but NO
   *  signup_verifications row. */
  partials: number;
}

/**
 * Reconcile BOTH dropped-signup shapes — after()-dropped orphans (shape 2) and partial
 * provisions (shape 3) — from a SINGLE listUsers collect pass over the Supabase auth-user
 * population. Neither shape is reachable by the per-tenant abandoned sweep (it starts FROM
 * signup_verifications), and neither is a legitimate confirmed account.
 *
 * For each auth user that is unconfirmed (email_confirmed_at unset), older than
 * SIGNUP_ABANDON_GRACE_MS, AND still carries the signup marker (isSignupOriginated):
 *  - NO matching `users` row → after()-dropped ORPHAN: delete the auth user; alert
 *    `signup_orphan_reconciled`.
 *  - HAS a `users` row but NO `signup_verifications` row → PARTIAL provision: purge every
 *    app-side row via the SHARED purgeAbandonedSignup tx (+ delete the auth user); alert
 *    `signup_partial_provision_reconciled`.
 *  - HAS a `users` row AND a `signup_verifications` row → NOT ours: the per-tenant abandoned
 *    sweep owns that shape. Left untouched.
 *
 * Detecting off the auth population (not a `users` LEFT JOIN `signup_verifications` query) is
 * load-bearing (fix round 2 item 1): legitimate confirmed admins/partners provisioned by
 * provisionAdmin / provisionPartnerUser also have no verification row and would permanently
 * saturate an oldest-first LIMITed users-table query, starving detection of a genuine recent
 * partial. Here they never enter the candidate set — email_confirmed_at filters them out — so
 * the population is only ever dropped signups and drains naturally; no getUserById calls and no
 * per-run LIMIT are needed. Every conservative guard is preserved: unconfirmed + past grace +
 * marker, collect-then-act, and the shared purge tx.
 *
 * Collect-then-act (item J): classify across ALL pages FIRST, act after paging completes —
 * deleting mid-page shifts Supabase's offset-based pagination and can skip candidates. Bounded
 * to 20 pages (mirrors findAuthUserByEmail); hitting the bound with a still-full last page fires
 * `signup_orphan_reconcile_paging_truncated`, which now bounds detection of BOTH shapes.
 *
 * Cross-tenant by construction (PRN-08 documented exemption, same class as emailExistsGlobally):
 * a dropped signup has no single tenant to scope by. Reads only ids, never PII.
 */
export async function reconcileDroppedSignups(
  db: DB,
  admin: SupabaseClient,
  opts: { now?: Date },
): Promise<DroppedSignupReconcileResult> {
  const now = opts.now ?? new Date();
  const cutoff = now.getTime() - SIGNUP_ABANDON_GRACE_MS;

  // users.id → tenantId for every app user: presence distinguishes an orphan (absent) from a
  // partial (present), and the tenantId feeds the partial's purgeAbandonedSignup tx.
  const tenantByUserId = new Map(
    (await db.select({ id: schema.users.id, tenantId: schema.users.tenantId }).from(schema.users)).map((u) => [
      u.id,
      u.tenantId,
    ]),
  );

  // Collect eligible candidates across ALL pages FIRST, then act after paging (item J).
  const orphanIds: string[] = [];
  const partialCandidates: { userId: string; tenantId: string }[] = [];
  let truncated = false;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;

    for (const authUser of data.users) {
      if (authUser.email_confirmed_at) continue; // confirmed — a real account, never touched
      if (new Date(authUser.created_at).getTime() > cutoff) continue; // still inside grace
      if (!isSignupOriginated(authUser)) continue; // no signup marker — not ours to delete (item C)

      const tenantId = tenantByUserId.get(authUser.id);
      if (tenantId === undefined) {
        orphanIds.push(authUser.id); // no `users` row → orphan
      } else {
        partialCandidates.push({ userId: authUser.id, tenantId }); // has a `users` row → maybe partial
      }
    }

    if (data.users.length < 200) break;
    // 20 full pages (>= 4000 users) and the last one still full: we hit the bound and more users
    // may exist beyond it — dropped signups (BOTH orphans and partials) past page 20 go
    // undetected this run (item E).
    if (page === 20) truncated = true;
  }

  // A partial candidate is a genuine partial only if it has NO signup_verifications row; one
  // WITH a verification row belongs to the per-tenant abandoned sweep. Batch the lookup so the
  // pass stays a fixed number of queries regardless of candidate count.
  let partialTargets = partialCandidates;
  if (partialCandidates.length) {
    const ids = partialCandidates.map((c) => c.userId);
    const hasVerification = new Set(
      (
        await db
          .select({ userId: schema.signupVerifications.userId })
          .from(schema.signupVerifications)
          .where(inArray(schema.signupVerifications.userId, ids))
      ).map((r) => r.userId),
    );
    partialTargets = partialCandidates.filter((c) => !hasVerification.has(c.userId));
  }

  if (truncated) {
    logError("signup_orphan_reconcile_paging_truncated", { page: 20 });
  }

  let orphans = 0;
  for (const id of orphanIds) {
    const del = await admin.auth.admin.deleteUser(id);
    if (del.error) {
      logError("signup_orphan_delete_failed", { message: del.error.message });
      continue;
    }
    orphans += 1;
  }

  let partials = 0;
  for (const { userId, tenantId } of partialTargets) {
    // Same shared purge tx (+ auth-user delete) the abandoned sweep uses — one delete order.
    // purge re-checks the verify/resend races at delete time; count only real purges.
    if (await purgeAbandonedSignup(db, admin, { tenantId, userId, now })) {
      partials += 1;
    }
  }

  if (orphans > 0) {
    logError("signup_orphan_reconciled", { count: orphans });
  }
  if (partials > 0) {
    logError("signup_partial_provision_reconciled", { count: partials });
  }

  return { orphans, partials };
}
