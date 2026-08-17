import { and, inArray, lte } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { batchedDeleteByAge } from "./batched-delete";

// ─────────────────────────────────────────────────────────────────────────────
// WP-RET-2 (audit R-42/R-43/R-91): retention for the three TENANT-scoped operational
// tables that grew without bound — the last of SET-07's "unbounded growth" list. All
// three are delete-only age sweeps hung off the daily retention cron, exactly like the
// auth siblings (auth-tables.ts): oldest-first, batched, idempotent, best-effort behind
// their own alert code. Age-only, NOT per-tenant: a row past the cutoff is dead weight
// regardless of which tenant owns it, so a single age predicate prunes across all tenants.
//
// ACCEPTED COST (mirrors auth-tables.ts): none of the three leads its index with createdAt
// (idempotency_keys is (tenant, key); email_outbox is (tenant, createdAt) and (status,
// nextAttemptAt); ai_feedback is (tenant)), so each pass plans as a seq-scan + top-N sort.
// Once a day, at these tables' volume, that beats the write-path cost of a covering index.
// ─────────────────────────────────────────────────────────────────────────────

type DB = PostgresJsDatabase<typeof schema>;

/** One pass's row cap — mirrors AUTH_TABLE_SWEEP_BATCH; the remainder drains next daily run. */
export const OPERATIONAL_SWEEP_BATCH = 5_000;

// ── idempotency_keys (API-03): the (tenant, key) dedup guard for retried upload/job requests.
// A key is consulted by exact (tenant_id, key) match within a client's retry window (minutes);
// nothing replays one days later, and an old in_progress row is an abandoned request, not a live
// one. 7 days is a wide margin past any realistic retry window.
export const IDEMPOTENCY_KEYS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function idempotencyKeysCutoff(now: Date): Date {
  return new Date(now.getTime() - IDEMPOTENCY_KEYS_RETENTION_MS);
}

export async function sweepIdempotencyKeys(db: DB, opts: { now?: Date; limit?: number } = {}): Promise<{ deleted: number }> {
  const now = opts.now ?? new Date();
  const I = schema.idempotencyKeys;
  return batchedDeleteByAge(db, {
    table: I,
    id: I.id,
    orderBy: I.createdAt,
    where: lte(I.createdAt, idempotencyKeysCutoff(now)),
    limit: opts.limit ?? OPERATIONAL_SWEEP_BATCH,
  });
}

// ── email_outbox (NTF-03): holds the real recipient address + full subject/body/html (PII) for
// every notification. TERMINAL rows (sent | failed) are kept 30 days for delivery-assurance and
// troubleshooting (privacy policy §7), then pruned. PENDING rows are NEVER swept — they are still
// awaiting delivery; only the drain/void path moves them out of that state.
export const EMAIL_OUTBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function emailOutboxCutoff(now: Date): Date {
  return new Date(now.getTime() - EMAIL_OUTBOX_RETENTION_MS);
}

export async function sweepEmailOutbox(db: DB, opts: { now?: Date; limit?: number } = {}): Promise<{ deleted: number }> {
  const now = opts.now ?? new Date();
  const O = schema.emailOutbox;
  return batchedDeleteByAge(db, {
    table: O,
    id: O.id,
    orderBy: O.createdAt,
    // Terminal rows only — a pending email is still to be delivered and must survive.
    where: and(inArray(O.status, ["sent", "failed"]), lte(O.createdAt, emailOutboxCutoff(now)))!,
    limit: opts.limit ?? OPERATIONAL_SWEEP_BATCH,
  });
}

// ── ai_feedback (AIA-04): thumbs up/down (+ an optional free-text note) on assistant answers.
// Kept 90 days for product analysis, then pruned — the note can carry user-authored text.
export const AI_FEEDBACK_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export function aiFeedbackCutoff(now: Date): Date {
  return new Date(now.getTime() - AI_FEEDBACK_RETENTION_MS);
}

export async function sweepAiFeedback(db: DB, opts: { now?: Date; limit?: number } = {}): Promise<{ deleted: number }> {
  const now = opts.now ?? new Date();
  const F = schema.aiFeedback;
  return batchedDeleteByAge(db, {
    table: F,
    id: F.id,
    orderBy: F.createdAt,
    where: lte(F.createdAt, aiFeedbackCutoff(now)),
    limit: opts.limit ?? OPERATIONAL_SWEEP_BATCH,
  });
}

// ── notifications (C-13 / WP-RET-3a, NTF-04): the in-app notification center. A task_due
// notification's TITLE embeds the task's free text (seller PII) verbatim, and — unlike the other
// operational tables — notifications had NO retention at all, so they accumulated that PII forever.
// The void/purge paths redact a soft-deleted lead's notifications at once (redact-lead-comms.ts);
// this age sweep is the general bound, deleting read-or-not notifications past the window. 90 days
// mirrors ai_feedback's user-text window — a notification is an ephemeral nudge, not a record.
export const NOTIFICATIONS_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export function notificationsCutoff(now: Date): Date {
  return new Date(now.getTime() - NOTIFICATIONS_RETENTION_MS);
}

export async function sweepNotifications(db: DB, opts: { now?: Date; limit?: number } = {}): Promise<{ deleted: number }> {
  const now = opts.now ?? new Date();
  const N = schema.notifications;
  return batchedDeleteByAge(db, {
    table: N,
    id: N.id,
    orderBy: N.createdAt,
    where: lte(N.createdAt, notificationsCutoff(now)),
    limit: opts.limit ?? OPERATIONAL_SWEEP_BATCH,
  });
}
