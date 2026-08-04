import { and, eq, ne, isNull, isNotNull, lte, inArray, asc, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { retentionCutoff, redactionPatch, REDACTED_NOTE_BODY, RETENTION_GRACE_MS } from "./purge";

// ─────────────────────────────────────────────────────────────────────────────
// Retention sweep adapter (WP-GL-B) — the BACKSTOP. Voiding redacts a run's PII
// immediately (src/modules/run/void.ts); this scheduled sweep catches any lead that
// is soft-deleted but not yet purged (a future soft-delete path, or legacy voided
// leads that predate WP-GL-B). With the default 0 grace it redacts every such lead;
// it also redacts their lead_notes bodies (the likeliest place a human typed PII).
// A job route (retention sweeps are idempotent, retried with backoff — §4). Mirrors
// drainOutbox: tenant-scoped (PRN-08), bounded per run, best-effort at the cron layer.
// ─────────────────────────────────────────────────────────────────────────────

type DB = PostgresJsDatabase<typeof schema>;

/** Max leads a single sweep redacts per tenant per run — bounded so a run stays cheap;
 *  the sweep is idempotent so the next run picks up any remainder. */
export const RETENTION_SWEEP_BATCH = 500;

export interface SweepResult {
  purged: number;
  notesRedacted: number;
}

/**
 * Redact seller PII from leads soft-deleted past the grace window, for ONE tenant.
 * One transaction: select a bounded, oldest-first batch of eligible leads (soft-deleted
 * at/before the cutoff, not yet purged) → write the redaction patch + stamp `pii_purged_at`
 * → redact those leads' note bodies → one append-only audit_log row per lead. Idempotent
 * (only `pii_purged_at IS NULL` rows are touched) and always tenant-scoped (PRN-08).
 * SEC-05: the audit detail carries no PII. PRN-13 is a *visibility* boundary — this is a
 * system anonymization with no viewer, so it redacts both note streams by design.
 */
export async function sweepTenantPii(
  db: DB,
  opts: { tenantId: string; now?: Date; graceMs?: number; limit?: number },
): Promise<SweepResult> {
  const now = opts.now ?? new Date();
  const graceMs = opts.graceMs ?? RETENTION_GRACE_MS;
  const limit = opts.limit ?? RETENTION_SWEEP_BATCH;
  const cutoff = retentionCutoff(now, graceMs);

  return db.transaction(async (tx) => {
    // ING-06: serialize per tenant (mirrors voidUpload/persistRun) so an overlapping sweep
    // invocation (retry, manual re-trigger) can't select the same batch twice and double-write
    // the append-only audit_log. Namespaced (":retention") so the sweep never blocks — or is
    // blocked by — an in-flight import/void, which lock on hashtext(tenantId) alone.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${opts.tenantId + ":retention"})::bigint)`);

    // Inclusive boundary (lte) matches isPastRetention's contract. Oldest-first so an initial
    // backlog (e.g. migration 0018's legacy voided leads) drains in a fair, deterministic order.
    const eligible = await tx
      .select({ id: schema.leads.id, refId: schema.leads.refId })
      .from(schema.leads)
      .where(
        and(
          eq(schema.leads.tenantId, opts.tenantId),
          isNotNull(schema.leads.deletedAt),
          lte(schema.leads.deletedAt, cutoff),
          isNull(schema.leads.piiPurgedAt),
        ),
      )
      .orderBy(asc(schema.leads.deletedAt))
      .limit(limit);

    if (eligible.length === 0) return { purged: 0, notesRedacted: 0 };

    const ids = eligible.map((l) => l.id);
    await tx
      .update(schema.leads)
      .set({ ...redactionPatch(), piiPurgedAt: now })
      .where(and(eq(schema.leads.tenantId, opts.tenantId), inArray(schema.leads.id, ids)));

    // Redact note bodies for the purged leads (SEC-05). Count per lead for the audit trail.
    const redactedNotes = await tx
      .update(schema.leadNotes)
      .set({ body: REDACTED_NOTE_BODY })
      .where(
        and(
          eq(schema.leadNotes.tenantId, opts.tenantId),
          inArray(schema.leadNotes.leadId, ids),
          ne(schema.leadNotes.body, REDACTED_NOTE_BODY),
        ),
      )
      .returning({ leadId: schema.leadNotes.leadId });
    const notesByLead = new Map<string, number>();
    for (const n of redactedNotes) notesByLead.set(n.leadId, (notesByLead.get(n.leadId) ?? 0) + 1);

    // Append-only audit (DM-04), one per lead. actorUserId null = the scheduled system sweep.
    // SEC-05: before/after record only that PII was purged + a note count — never the values.
    await tx.insert(schema.auditLog).values(
      eligible.map((l) => ({
        tenantId: opts.tenantId,
        actorUserId: null,
        action: "lead.pii_purged",
        entityType: "lead",
        entityRef: l.refId,
        before: { piiPurged: false },
        after: { piiPurged: true, notesRedacted: notesByLead.get(l.id) ?? 0 },
        traceId: globalThis.crypto.randomUUID(),
      })),
    );

    return { purged: eligible.length, notesRedacted: redactedNotes.length };
  });
}
