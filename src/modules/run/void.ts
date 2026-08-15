import { and, eq, isNull, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import { isWithinVoidWindow } from "./void-window";
import { redactionPatch, REDACTED_NOTE_BODY, REDACTED_TASK_TITLE } from "../retention/purge";

// ─────────────────────────────────────────────────────────────────────────────
// Void a run (ING-09). Soft-void with a required reason: the upload is marked voided
// and audited (DM-04), and the run's leads are SOFT-DELETED (deleted_at = voidedAt) —
// which excludes them from dedupe, analytics, and exports EVERYWHERE (every lead read
// filters deleted_at) while they stay visible on the import page (getRunDetail is the one
// read that does not filter deleted_at). PRN-05: assignment columns are never rewritten.
// WP-GL-B: the recalled leads' seller PII (name/contact/address/raw row + notes) is redacted
// in the SAME transaction — a void is a "wrong file" undo, so the personal info goes at once
// (DM-09/LGL-02/SEC-05); pii_purged_at is stamped so the backstop sweep skips them.
// The window guard (WP-J1) bounds voiding to 5 min post-import, and only the LATEST non-voided
// import may be voided. Partners are never notified — with the distribution hold a void always
// happens while the leads are still held (never reached partners), so there is nothing to recall.
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
    super(`Run ${ref} can no longer be voided — voiding is only available for 5 minutes after an import.`);
    this.name = "VoidWindowClosedError";
  }
}

export class NotLatestImportError extends Error {
  constructor(ref: string) {
    super(`Run ${ref} can no longer be voided — only the most recent import can be voided.`);
    this.name = "NotLatestImportError";
  }
}

export class AlreadyDistributedError extends Error {
  constructor(ref: string) {
    super(`Run ${ref} can no longer be voided — it has already been released to partners.`);
    this.name = "AlreadyDistributedError";
  }
}

export interface VoidResult {
  uploadRef: string;
  voidedAt: string;
  /** Total leads soft-deleted by the void — includes removed/unmatched, not just kept. */
  recalledLeadCount: number;
}

export async function voidUpload(scope: ScopeContext, ref: string, reason: string): Promise<VoidResult> {
  const db = getDb();
  return db.transaction(async (tx) => {
    // ING-06 / concurrency: serialize per tenant (mirrors persistRun) so two overlapping voids
    // can't double-recall, and a void can't race a concurrent import's inserts.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${scope.tenantId})::bigint)`);
    const [upload] = await tx
      .select()
      .from(schema.uploads)
      .where(and(tenantWhere(schema.uploads, scope), eq(schema.uploads.refId, ref)));
    if (!upload) throw new UploadNotFoundError(ref);
    if (upload.status === "voided") throw new AlreadyVoidedError(ref);
    // WP-J1 (ING-09): void is a bounded undo — only within 5 min of import. Order matters:
    // not-found and already-voided are more specific and must win over the window check.
    if (!isWithinVoidWindow(upload.createdAt, new Date())) throw new VoidWindowClosedError(ref);
    // Defense-in-depth vs a release/void boundary race (F-1): refuse once the run has been released
    // to partners. The shared per-tenant advisory lock (above) makes this see the release's committed
    // state. Normally redundant with the window check (release only fires after the window closes).
    if (upload.distributedAt !== null) throw new AlreadyDistributedError(ref);
    // Distribution-hold rule: only the LATEST (most recent) non-voided import may be voided — undo
    // is always "the last thing you did." If any newer non-voided import exists, refuse. Compare via
    // a subquery on the STORED created_at (µs precision) rather than the fetched JS Date, which
    // postgres.js truncates to ms — a truncated value would make a row match itself as "newer".
    const newer = await tx
      .select({ id: schema.uploads.id })
      .from(schema.uploads)
      .where(
        and(
          tenantWhere(schema.uploads, scope),
          isNull(schema.uploads.voidedAt),
          sql`${schema.uploads.createdAt} > (select created_at from uploads u where u.id = ${upload.id})`,
        ),
      )
      .limit(1);
    if (newer.length > 0) throw new NotLatestImportError(ref);

    const voidedAt = new Date();

    await tx
      .update(schema.uploads)
      .set({ status: "voided", voidReason: reason, voidedAt })
      .where(eq(schema.uploads.id, upload.id));

    // ING-09 recall + WP-GL-B purge: soft-delete ALL of the run's live leads AND redact their
    // seller PII in the same statement — a void is a "wrong file, re-import" undo, so the personal
    // info goes at once (owner decision 2026-07-13). Every lead read filters deleted_at, so they
    // drop from dedupe/analytics/exports and both partner + admin lists globally; the import page
    // still shows them (redacted) since getRunDetail doesn't filter deleted_at. PRN-05: assignment
    // untouched. dedupe_key is sentineled too; ADR-0038 retired the dedup collapse, so dedupe_key
    // is a plain (non-unique) index — a corrected re-upload re-inserts freely (no key collision).
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
      // …and their task titles, which are the same kind of human-typed free text on the same
      // lead (TSK-01, audit-tenancy F-5). PRN-13 is a VISIBILITY boundary — this is a system
      // anonymization with no viewer, so both streams' tasks are redacted by design.
      await tx
        .update(schema.leadTasks)
        .set({ title: REDACTED_TASK_TITLE })
        .where(
          and(
            tenantWhere(schema.leadTasks, scope),
            inArray(schema.leadTasks.leadId, recalledIds),
            ne(schema.leadTasks.title, REDACTED_TASK_TITLE),
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

    return {
      uploadRef: upload.refId,
      voidedAt: voidedAt.toISOString(),
      recalledLeadCount: recalled.length,
    };
  });
}
