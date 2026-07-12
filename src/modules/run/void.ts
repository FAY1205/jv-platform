import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import { isWithinVoidWindow } from "./void-window";

// ─────────────────────────────────────────────────────────────────────────────
// Void a run (ING-09). Soft-void with a required reason: the upload is marked voided
// and audited (DM-04); its leads are NOT deleted (PRN-05 — voiding is the sanctioned
// escape hatch, never a history rewrite). Voided leads are automatically excluded from
// future dedupe because DrizzleRunStore.loadHistory filters uploads.status != 'voided'
// (WP-017b), so a bad run can never poison "previously matched" going forward.
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
}

export async function voidUpload(scope: ScopeContext, ref: string, reason: string): Promise<VoidResult> {
  const db = getDb();
  return db.transaction(async (tx) => {
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
    await tx
      .update(schema.uploads)
      .set({ status: "voided", voidReason: reason, voidedAt })
      .where(eq(schema.uploads.id, upload.id));

    // Append-only audit of the mutation (DM-04).
    await tx.insert(schema.auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: scope.userId,
      action: "upload.voided",
      entityType: "upload",
      entityRef: upload.refId,
      before: { status: upload.status },
      after: { status: "voided", voidReason: reason },
      traceId: globalThis.crypto.randomUUID(),
    });

    return { uploadRef: upload.refId, voidedAt: voidedAt.toISOString() };
  });
}
