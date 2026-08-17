import { and, inArray, ne, sql } from "drizzle-orm";
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

export interface RedactedCommsResult {
  notificationsRedacted: number;
  outboxRedacted: number;
}

/** Redact (title/subject/body → sentinel, nullable bodies → null) the notifications and outbox rows
 *  that reference any of `leadRefs`, for ONE tenant. Returns per-artifact counts. No-op on empty. */
export async function redactLeadCommunications(
  tx: DB,
  tenantId: string,
  leadRefs: string[],
): Promise<RedactedCommsResult> {
  if (leadRefs.length === 0) return { notificationsRedacted: 0, outboxRedacted: 0 };

  const redactedNotifications = await tx
    .update(schema.notifications)
    .set({ title: REDACTED_NOTIFICATION_TITLE, body: null })
    .where(
      and(
        tenantIdWhere(schema.notifications, tenantId),
        inArray(schema.notifications.leadRef, leadRefs),
        ne(schema.notifications.title, REDACTED_NOTIFICATION_TITLE),
      ),
    )
    .returning({ id: schema.notifications.id });

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
    .returning({ id: schema.emailOutbox.id });

  return { notificationsRedacted: redactedNotifications.length, outboxRedacted: redactedOutbox.length };
}
