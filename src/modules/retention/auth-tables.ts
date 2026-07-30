import { and, eq, gt, isNotNull, isNull, lte, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { OTP_TTL_MS } from "@/lib/auth/otp";
import { RESET_TTL_MS } from "@/lib/auth/reset-token";
import { SIGNUP_TTL_MS } from "@/lib/auth/signup-token";
import { batchedDeleteByAge } from "./batched-delete";

// ─────────────────────────────────────────────────────────────────────────────
// WP-SU-13: retention for three pre-tenant auth SIBLING tables of auth_attempts —
// otp_challenges, reset_tokens, signup_verifications. Same data-minimisation gap ADR-0010
// named and WP-SU-11 closed for auth_attempts — these tables hold raw third-party emails
// (otp_challenges.identifier) and token hashes on dead rows that nothing prunes. Each cutoff
// is DERIVED from that table's own live read window; a restated literal is a bug (ADR-0010).
// (trusted_devices is ALSO swept here — WP-SU-14, at the bottom of this file. It differs: it HAS a
// tenant_id and needs family-liveness-aware pruning to preserve AUT-10 reuse detection.)
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

// ACCEPTED COST (mirrors auth-attempts.ts / ADR-0010): none of these three tables has an index that
// LEADS with the sweep's age column — otp_challenges is (identifier, createdAt); reset_tokens and
// signup_verifications index only tokenHash + userId. So each sweep plans as a sequential scan +
// top-N sort. Once a day, at the volume these pre-tenant tables carry, that is cheaper than the
// write-path index maintenance a covering index would add. Revisit together with ADR-0010's
// Redis-swap trigger; if closed for real the indexes are createdAt (otp/reset) and a partial
// createdAt WHERE usedAt IS NOT NULL (signup_verifications) — a migration, deliberately out of this
// delete-only WP's scope.

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

// ── reset_tokens (AUT-06) — createdAt-anchored. ResetStore.findByHash looks a token up; verifyResetToken
// then rejects it once past expiresAt (RESET_TTL_MS, 30m). A row older than the TTL is unusable; used
// rows are single-use.
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

// ── signup_verifications (SCP-02/AUT-06) — createdAt-anchored, USED ROWS ONLY. signup-sweep.ts
// already sweeps expired + UNCONSUMED rows and uses them as its abandoned-tenant detection signal;
// the isNotNull(usedAt) guard here means this pass never removes an unconsumed row, so that signal
// is untouched. It closes only the residue signup-sweep leaves: happy-path used rows. (verifySignupToken
// rejects a token past SIGNUP_TTL_MS/24h; a used row is single-use — neither is readable once swept.)
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

// ── trusted_devices (AUT-10 / ACC-02) — CANARY-SAFE, family-liveness-aware (WP-SU-14). Unlike the
// three siblings above, this table HAS a tenant_id; the age-predicate delete is nonetheless
// tenant-agnostic SYSTEM MAINTENANCE — a documented PRN-08 exception, same class as the cron
// tenant-list read — NOT a pre-tenant table. Anchored on the STORED expiresAt (the 30d
// REFRESH_ABSOLUTE_MS is already baked in at issue/rotate time), so no lifetime literal is restated
// (ADR-0010).
//
// A row is pruned ONLY when its family has NO LIVE HEAD — no row with rotatedTo IS NULL AND revokedAt
// IS NULL AND expiresAt > now (the exact live-head definition in TrustedDeviceService.listForUser). This is
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
