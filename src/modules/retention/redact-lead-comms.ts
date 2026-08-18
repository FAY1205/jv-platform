import { and, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { tenantIdWhere } from "@/lib/scope";
import { REDACTED_NOTIFICATION_TITLE, REDACTED_OUTBOX_SUBJECT, REDACTED_OUTBOX_BODY } from "./purge";

// ─────────────────────────────────────────────────────────────────────────────
// C-13 / WP-RET-3a: redact a soft-deleted lead's COMMUNICATIONS — in-app notifications and
// email_outbox rows — alongside the lead's own columns/notes/tasks. A task_due notification and
// its email embed the task's free text (seller PII) verbatim; both purge paths correlate them to
// the lead by ref: notifications carry lead_ref (migration 0049), email_outbox carries meta.leadRef.
// Shared by the immediate void purge (run/void.ts) and the backstop sweep (retention/sweep.ts) so
// the two never diverge. Tenant-scoped (PRN-08). Idempotent (skips already-sentineled rows). The
// email_outbox age sweep (operational.ts, 30d) still prunes terminal rows generally; this removes a
// voided lead's PII AT ONCE rather than waiting for it.
// ─────────────────────────────────────────────────────────────────────────────

type DB = PostgresJsDatabase<typeof schema>;

/** Per-lead redaction counts, keyed by the lead's refId. */
export interface CommsByRef {
  notifications: number;
  outbox: number;
}

export interface RedactedCommsResult {
  notificationsRedacted: number;
  outboxRedacted: number;
  /** C-37: per-refId breakdown so a caller writing a PER-LEAD audit row (the retention sweep's
   *  `lead.pii_purged`) can record comms counts for that lead, not just the tenant aggregate.
   *  Assumes refId identifies one lead within a tenant (DM-07: tenant-scoped + immutable; refIds are
   *  generated sequentially, so no live path produces a collision). `leads.ref_id` carries no DB
   *  unique constraint, so if refId generation ever changed to allow per-tenant duplicates, two
   *  leads' counts would pool under one key — revisit this keying then (candidate: leads refId
   *  uniqueness). */
  byRef: Map<string, CommsByRef>;
}

/** Redact (title/subject/body → sentinel, nullable bodies → null) the notifications and outbox rows
 *  that reference any of `leadRefs`, for ONE tenant. Returns per-artifact totals AND a per-refId
 *  breakdown (C-37). No-op on empty. */
export async function redactLeadCommunications(
  tx: DB,
  tenantId: string,
  leadRefs: string[],
): Promise<RedactedCommsResult> {
  if (leadRefs.length === 0) return { notificationsRedacted: 0, outboxRedacted: 0, byRef: new Map() };

  const redactedNotifications = await tx
    .update(schema.notifications)
    // WP-NF1 D8: deep_link joins the sentinel. It embeds the lead ref, so a redacted row kept
    // pointing at the purged lead — clicking a "Removed" notification landed on a 404 (portal)
    // or an empty dialog (admin). Nulling it leaves the row inert, which is what redaction means.
    .set({ title: REDACTED_NOTIFICATION_TITLE, body: null, deepLink: null })
    .where(
      and(
        tenantIdWhere(schema.notifications, tenantId),
        inArray(schema.notifications.leadRef, leadRefs),
        // Idempotency, widened for the D8 deep_link backfill (audit F-8): a row sentineled
        // BEFORE deep_link joined the redaction set still carries its link — re-touch those
        // once too, instead of letting the title guard strand them.
        or(
          ne(schema.notifications.title, REDACTED_NOTIFICATION_TITLE),
          isNotNull(schema.notifications.deepLink),
        ),
      ),
    )
    .returning({ leadRef: schema.notifications.leadRef });

  // email_outbox correlates by meta.leadRef (a jsonb text field). `->>` extracts it as text; the
  // SQL expression is the inArray target. `html` is nullable → nulled; subject/body are NOT NULL.
  const redactedOutbox = await tx
    .update(schema.emailOutbox)
    .set({ subject: REDACTED_OUTBOX_SUBJECT, body: REDACTED_OUTBOX_BODY, html: null })
    .where(
      and(
        tenantIdWhere(schema.emailOutbox, tenantId),
        inArray(sql`${schema.emailOutbox.meta} ->> 'leadRef'`, leadRefs),
        ne(schema.emailOutbox.subject, REDACTED_OUTBOX_SUBJECT),
      ),
    )
    .returning({ leadRef: sql<string>`${schema.emailOutbox.meta} ->> 'leadRef'` });

  // Tally per refId. A notification carries lead_ref directly; an outbox row carries it via
  // meta.leadRef, both re-projected above. Only rows matching one of `leadRefs` were touched, so a
  // null ref cannot appear here.
  const byRef = new Map<string, CommsByRef>();
  const bump = (ref: string | null, key: keyof CommsByRef) => {
    if (!ref) return;
    const entry = byRef.get(ref) ?? { notifications: 0, outbox: 0 };
    entry[key] += 1;
    byRef.set(ref, entry);
  };
  for (const n of redactedNotifications) bump(n.leadRef, "notifications");
  for (const o of redactedOutbox) bump(o.leadRef, "outbox");

  return { notificationsRedacted: redactedNotifications.length, outboxRedacted: redactedOutbox.length, byRef };
}
