import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { env } from "@/lib/env";
import { isAuthorizedCron } from "@/lib/auth/cron-auth";
import { sweepTenantPii } from "@/modules/retention/sweep";
import { sweepVoidedExports } from "@/modules/retention/export-sweep";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sweepAuthAttempts } from "@/modules/retention/auth-attempts";
import {
  sweepOtpChallenges,
  sweepResetTokens,
  sweepSignupVerifications,
  sweepSignupCodes,
  sweepTrustedDevices,
  sweepNoticeClaims,
} from "@/modules/retention/auth-tables";
import { sweepIdempotencyKeys, sweepEmailOutbox, sweepAiFeedback, sweepNotifications, sweepSavedViewsPii } from "@/modules/retention/operational";
import { logError } from "@/lib/observability";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";
import { CRON_MONITORS, withCronMonitor } from "@/lib/cron-monitors";

// WP-GL-B: bound the scheduled function's runtime.
export const maxDuration = 60;

// ACT-05 (ADR-0032): this job's Sentry check-in identity + schedule. This is the sweep
// that discharges the LGL-02 deletion promise — its silent death is the one that matters.
const MONITOR = CRON_MONITORS["/api/cron/retention-sweep"];

// GET /api/cron/retention-sweep — scheduled PII purge of soft-deleted leads past the grace
// window (DM-09 / LGL-02). Authorized by the CRON_SECRET bearer, NOT a session/CSRF. Each
// sweepTenantPii call is tenant-scoped (PRN-08); the only cross-tenant read is the tenant-id
// list — a system operation, exactly like the outbox drain.
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), env.CRON_SECRET)) {
    return jsonError("unauthorized", "Authentication required.", 401);
  }
  // ACT-05: check in with Sentry around the real work, so a run that never happens is
  // itself an alert. Wrapped AFTER the auth gate — a rejected caller is not a job run.
  //
  // The tenant-list failure deliberately THROWS out of this callback rather than
  // returning an error response: withMonitor finishes the check-in "ok" whenever the
  // callback RESOLVES and never inspects the resolved value, so returning a 500 from in
  // here would report a sweep that purged NOTHING as healthy — a green dashboard over an
  // undischarged LGL-02 deletion promise. The rejection handler below restores the envelope.
  return withCronMonitor(
    MONITOR,
    async () => {
      const db = getDb();
      const tenants: { id: string }[] = await db.select({ id: schema.tenants.id }).from(schema.tenants);
      let purged = 0;
      let notesRedacted = 0;
      let tasksRedacted = 0;
      let notificationsRedacted = 0;
      let outboxRedacted = 0;
      let exportsRemoved = 0;
      let swept = 0;
      // C-40 / WP-RET-4: one admin client for the Storage backstop below (voided-export removal).
      const admin = getSupabaseAdmin();
      for (const t of tenants) {
        try {
          // C-7 + C-13: sweepTenantPii returns per-artifact redaction counts (leads purged, note
          // bodies + task titles + notifications + outbox rows redacted) and audits them per lead.
          // Surface the totals in the cron response too, so LGL-02 evidence has per-artifact figures
          // without reading the audit_log (the response previously reported only `purged`).
          const r = await sweepTenantPii(db, { tenantId: t.id });
          purged += r.purged;
          notesRedacted += r.notesRedacted;
          tasksRedacted += r.tasksRedacted;
          notificationsRedacted += r.notificationsRedacted;
          outboxRedacted += r.outboxRedacted;
          // C-40 / WP-RET-4: backstop — remove the rendered export .xlsx (Storage) for voided uploads
          // whose blob survived (a failed immediate delete on void, or a pre-fix legacy void).
          const ex = await sweepVoidedExports(db, admin, t.id);
          exportsRemoved += ex.exportsRemoved;
          swept += 1;
        } catch (e) {
          // Best-effort per tenant: one tenant's failure must not stop the others.
          logError("cron_retention_tenant_failed", { tenantId: t.id, message: e instanceof Error ? e.message : String(e) });
        }
      }

      // WP-SU-11 + WP-SU-13 (ADR-0010): prune the pre-tenant auth tables — auth_attempts and the
      // three sibling token tables (otp_challenges, reset_tokens, signup_verifications). None carries
      // a tenant_id (auth runs before a tenant is known), so each is a single age-predicate delete
      // with nothing to loop over, hung off this daily job rather than given a cron of its own.
      //
      // Each pass is BEST-EFFORT behind its OWN alert code, deliberately — NOT the treatment
      // signup-sweep's reconcile pass gets. This monitor answers one question: did the LGL-02
      // consumer-PII purge run. Letting a data-minimisation hygiene pass fail its check-in would
      // raise a legal-grade alarm for a hygiene problem AND report a purge that DID run as failed
      // (ADR-0032). The dedicated codes are the alert instead; unbounded growth returning silently is
      // exactly what they prevent.
      //
      // CONCURRENT (audit-devops, WP-SU-13 review): these passes share no state and no transaction,
      // and each is an unindexed seq-scan (see auth-tables.ts "ACCEPTED COST"). Run sequentially,
      // their scan times stacked additively against this function's 60s maxDuration, behind the
      // tenant PII loop above — so the newest pass was the first to be starved on a tight run.
      // Promise.all makes wall-clock the SLOWEST pass, not their sum. Each still catches its own
      // failure, so one pass's throw cannot reject the others. The tenant PII purge stays sequential
      // and FIRST: it is the legal promise this monitor exists for, and must not contend for the pool
      // with hygiene work. trusted_devices is now swept here too (WP-SU-14) — but CANARY-SAFE: it
      // prunes a row only when its family has no live head, so an active family's reuse canaries
      // survive (AUT-10 preserved).
      const [authAttempts, otpChallenges, resetTokens, signupVerifications, signupCodes, trustedDevices, noticeClaims, idempotencyKeys, emailOutbox, aiFeedback, notifications, savedViewsCleared] = await Promise.all([
        sweepAuthAttempts(db)
          .then((r) => r.deleted)
          .catch((e) => {
            logError("cron_auth_attempts_sweep_failed", { message: e instanceof Error ? e.message : String(e) });
            return 0;
          }),
        sweepOtpChallenges(db)
          .then((r) => r.deleted)
          .catch((e) => {
            logError("cron_otp_challenges_sweep_failed", { message: e instanceof Error ? e.message : String(e) });
            return 0;
          }),
        sweepResetTokens(db)
          .then((r) => r.deleted)
          .catch((e) => {
            logError("cron_reset_tokens_sweep_failed", { message: e instanceof Error ? e.message : String(e) });
            return 0;
          }),
        sweepSignupVerifications(db)
          .then((r) => r.deleted)
          .catch((e) => {
            logError("cron_signup_verifications_sweep_failed", { message: e instanceof Error ? e.message : String(e) });
            return 0;
          }),
        sweepSignupCodes(db)
          .then((r) => r.deleted)
          .catch((e) => {
            logError("cron_signup_codes_sweep_failed", { message: e instanceof Error ? e.message : String(e) });
            return 0;
          }),
        sweepTrustedDevices(db)
          .then((r) => r.deleted)
          .catch((e) => {
            logError("cron_trusted_devices_sweep_failed", { message: e instanceof Error ? e.message : String(e) });
            return 0;
          }),
        // WP-SU-18: prune aged notice_claims (raw login/OTP email past the claim window + margin).
        // Same best-effort-behind-its-own-alert shape as the siblings — a hygiene pass must not fail
        // this monitor's LGL-02 check-in (ADR-0032).
        sweepNoticeClaims(db)
          .then((r) => r.deleted)
          .catch((e) => {
            logError("cron_notice_claims_sweep_failed", { message: e instanceof Error ? e.message : String(e) });
            return 0;
          }),
        // WP-RET-2: the three tenant-scoped operational tables (idempotency_keys, email_outbox
        // terminal rows, ai_feedback) — SET-07's remaining unbounded-growth list. Same best-effort-
        // behind-its-own-alert shape; a hygiene pass must not fail this monitor's LGL-02 check-in.
        sweepIdempotencyKeys(db)
          .then((r) => r.deleted)
          .catch((e) => {
            logError("cron_idempotency_keys_sweep_failed", { message: e instanceof Error ? e.message : String(e) });
            return 0;
          }),
        sweepEmailOutbox(db)
          .then((r) => r.deleted)
          .catch((e) => {
            logError("cron_email_outbox_sweep_failed", { message: e instanceof Error ? e.message : String(e) });
            return 0;
          }),
        sweepAiFeedback(db)
          .then((r) => r.deleted)
          .catch((e) => {
            logError("cron_ai_feedback_sweep_failed", { message: e instanceof Error ? e.message : String(e) });
            return 0;
          }),
        // C-13 / WP-RET-3a: age out old in-app notifications (90d) — the last operational table that
        // had no retention, and one whose task_due titles carry seller PII. Same best-effort shape.
        sweepNotifications(db)
          .then((r) => r.deleted)
          .catch((e) => {
            logError("cron_notifications_sweep_failed", { message: e instanceof Error ? e.message : String(e) });
            return 0;
          }),
        // C-13 / WP-RET-3b: clear the seller-PII search string (q) on saved_views untouched > 12mo —
        // a per-user PII sink the lead purge can't correlate (it holds a search string, not a lead id).
        sweepSavedViewsPii(db)
          .then((r) => r.cleared)
          .catch((e) => {
            logError("cron_saved_views_pii_sweep_failed", { message: e instanceof Error ? e.message : String(e) });
            return 0;
          }),
      ]);

      return { tenants: swept, purged, notesRedacted, tasksRedacted, notificationsRedacted, outboxRedacted, exportsRemoved, authAttempts, otpChallenges, resetTokens, signupVerifications, signupCodes, trustedDevices, noticeClaims, idempotencyKeys, emailOutbox, aiFeedback, notifications, savedViewsCleared };
    },
  ).then(
    (r) => jsonOk({ code: "ok", ...r }),
    (e) =>
      jsonServerError("cron_retention_failed", "Retention sweep failed.", {
        message: e instanceof Error ? e.message : String(e),
      }),
  );
}
