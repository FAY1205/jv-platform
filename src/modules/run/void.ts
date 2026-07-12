import { and, eq, isNull, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import { isWithinVoidWindow } from "./void-window";
import { loadVoidNotifiesPartners } from "../settings/export-settings";
import { createNotification } from "../notify/notifications";
import { redactionPatch, REDACTED_NOTE_BODY } from "../retention/purge";

// ─────────────────────────────────────────────────────────────────────────────
// Void a run (ING-09). Soft-void with a required reason: the upload is marked voided
// and audited (DM-04), and the run's leads are SOFT-DELETED (deleted_at = voidedAt) —
// which excludes them from dedupe, analytics, and exports EVERYWHERE (every lead read
// filters deleted_at) while they stay visible on the import page (getRunDetail is the one
// read that does not filter deleted_at). PRN-05: assignment columns are never rewritten.
// WP-GL-B: the recalled leads' seller PII (name/contact/address/raw row + notes) is redacted
// in the SAME transaction — a void is a "wrong file" undo, so the personal info goes at once
// (DM-09/LGL-02/SEC-05); pii_purged_at is stamped so the backstop sweep skips them.
// Affected partners get an in-app recall notice (WP-J2), gated by the void_notifies_partners
// setting (PRN-11 default ON). The window guard (WP-J1) bounds all of this to 10 min post-import.
// ─────────────────────────────────────────────────────────────────────────────

export class UploadNotFoundError extends Error {
  constructor(ref: string) {
    super(`Run ${ref} not found.`);
    this.name = "UploadNotFoundError";
  }
}

export class AlreadyVoidedError extends Error {
  constructor(ref: string) {
    super(`Run ${ref} is already voided.`);
    this.name = "AlreadyVoidedError";
  }
}

export class VoidWindowClosedError extends Error {
  constructor(ref: string) {
    super(`Run ${ref} can no longer be voided — voiding is only available for 10 minutes after an import.`);
    this.name = "VoidWindowClosedError";
  }
}

export interface VoidResult {
  uploadRef: string;
  voidedAt: string;
  /** Total leads soft-deleted (recalled) — includes removed/unmatched, not just delivered. */
  recalledLeadCount: number;
  /** Distinct partners who had delivered leads recalled (and were notified, if enabled). */
  affectedPartnerCount: number;
}

export async function voidUpload(scope: ScopeContext, ref: string, reason: string): Promise<VoidResult> {
  const db = getDb();
  const notifyPartners = await loadVoidNotifiesPartners(scope);
  return db.transaction(async (tx) => {
    // ING-06 / concurrency: serialize per tenant (mirrors persistRun) so two overlapping voids
    // can't double-recall or double-notify, and a void can't race a concurrent import's dedupe.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${scope.tenantId})::bigint)`);
    const [upload] = await tx
      .select()
      .from(schema.uploads)
      .where(and(tenantWhere(schema.uploads, scope), eq(schema.uploads.refId, ref)));
    if (!upload) throw new UploadNotFoundError(ref);
    if (upload.status === "voided") throw new AlreadyVoidedError(ref);
    // WP-J1 (ING-09): void is a bounded undo — only within 10 min of import. Order matters:
    // not-found and already-voided are more specific and must win over the window check.
    if (!isWithinVoidWindow(upload.createdAt, new Date())) throw new VoidWindowClosedError(ref);

    const voidedAt = new Date();

    // Affected partners = effective owners (coalesce(manual, pipeline)) of this run's DELIVERED
    // (kept + assigned) leads, with per-partner counts. Captured BEFORE the soft-delete so the
    // recall notice can name each partner's count. Tenant-scoped (PRN-08).
    const affected = (await tx.execute(sql`
      select coalesce(manual_partner_id, partner_id) as partner_id, count(*)::int as n
      from leads
      where ${tenantWhere(schema.leads, scope)} and upload_id = ${upload.id}
        and deleted_at is null and mls_status = 'kept'
        and coalesce(manual_partner_id, partner_id) is not null
      group by coalesce(manual_partner_id, partner_id)
    `)) as unknown as { partner_id: string; n: number }[];

    await tx
      .update(schema.uploads)
      .set({ status: "voided", voidReason: reason, voidedAt })
      .where(eq(schema.uploads.id, upload.id));

    // ING-09 recall + WP-GL-B purge: soft-delete ALL of the run's live leads AND redact their
    // seller PII in the same statement — a void is a "wrong file, re-import" undo, so the personal
    // info goes at once (owner decision 2026-07-13). Every lead read filters deleted_at, so they
    // drop from dedupe/analytics/exports and both partner + admin lists globally; the import page
    // still shows them (redacted) since getRunDetail doesn't filter deleted_at. PRN-05: assignment
    // untouched. dedupe_key is sentineled too, but the partial unique index (WHERE deleted_at IS
    // NULL) already excludes soft-deleted rows, so a corrected re-upload still re-inserts freely.
    const recalled = await tx
      .update(schema.leads)
      .set({ deletedAt: voidedAt, ...redactionPatch(), piiPurgedAt: voidedAt })
      .where(
        and(
          tenantWhere(schema.leads, scope),
          eq(schema.leads.uploadId, upload.id),
          isNull(schema.leads.deletedAt),
        ),
      )
      .returning({ id: schema.leads.id });

    // Redact the recalled leads' free-text notes too (the likeliest place a human typed seller PII).
    const recalledIds = recalled.map((r) => r.id);
    if (recalledIds.length > 0) {
      await tx
        .update(schema.leadNotes)
        .set({ body: REDACTED_NOTE_BODY })
        .where(
          and(
            tenantWhere(schema.leadNotes, scope),
            inArray(schema.leadNotes.leadId, recalledIds),
            ne(schema.leadNotes.body, REDACTED_NOTE_BODY),
          ),
        );
    }

    // Append-only audit of the mutation (DM-04).
    await tx.insert(schema.auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: scope.userId,
      action: "upload.voided",
      entityType: "upload",
      entityRef: upload.refId,
      before: { status: upload.status },
      after: { status: "voided", voidReason: reason, recalledLeads: recalled.length, piiPurged: recalled.length },
      traceId: globalThis.crypto.randomUUID(),
    });

    // In-app recall notice to each affected partner's user(s) (NTF-04 shape; inlined so it commits
    // atomically inside this transaction). SEC-05: import ref + count only, never seller PII.
    // Gated by void_notifies_partners (PRN-11 default ON).
    if (notifyPartners && affected.length > 0) {
      const partnerIds = affected.map((a) => a.partner_id);
      const countByPartner = new Map(affected.map((a) => [a.partner_id, a.n]));
      const recipients = await tx
        .select({ userId: schema.users.id, partnerId: schema.users.partnerId })
        .from(schema.users)
        .where(and(tenantWhere(schema.users, scope), inArray(schema.users.partnerId, partnerIds)));
      for (const r of recipients) {
        const n = countByPartner.get(r.partnerId!) ?? 0;
        await createNotification(tx, {
          tenantId: scope.tenantId,
          userId: r.userId,
          type: "run_voided",
          title: `${n} lead${n === 1 ? "" : "s"} withdrawn`,
          body: `Import ${upload.refId} was voided by your admin — ${n} lead${n === 1 ? "" : "s"} ${n === 1 ? "was" : "were"} removed from your list.`,
          deepLink: "/portal/leads",
        });
      }
    }

    return {
      uploadRef: upload.refId,
      voidedAt: voidedAt.toISOString(),
      recalledLeadCount: recalled.length,
      affectedPartnerCount: affected.length,
    };
  });
}
