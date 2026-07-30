import { and, isNotNull, lte } from "drizzle-orm";
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
// (trusted_devices was in scope but was pulled out — see the note at the bottom of this file.)
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

// ── trusted_devices is deliberately NOT swept here (WP-SU-13 review, audit-security F-1 +
// audit-data F-1). Naive expiresAt-based pruning would delete the old, already-rotated rows of a
// STILL-ACTIVE family — but rotate() (refresh.ts) checks token REUSE *before* it checks expiry, so
// deleting those rows silently narrows AUT-10 reuse detection: a leaked old token replayed after
// its expiry + margin returns "invalid" instead of "reuse_revoked", losing the family revoke + owner
// notify. Correct pruning must be family-liveness-aware (keep any rotated row while its family has a
// live head). Separately, its insert path (/api/auth/trust/refresh) is unthrottled, so retention
// alone does not bound its growth. Both belong in a dedicated WP, not this delete-only pass. The
// three tables above are genuinely pre-tenant and safe to prune by age.
