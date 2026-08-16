import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { LeadNotFoundError } from "@/modules/leads/errors";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { leadWhere, noteWhere, type ScopeContext } from "@/lib/scope";
import { releasedLeads } from "../run/hold-filter";
import { maskAuditValue } from "@/modules/audit/redact";

// WP-J2: a partner can't note/read a recalled (soft-deleted) lead; admin keeps access — voided
// leads stay visible to admin in the import history. Distribution hold: nor a still-held lead.
const partnerLive = (scope: ScopeContext) =>
  scope.role === "partner" ? and(isNull(schema.leads.deletedAt), releasedLeads()) : undefined;

// ─────────────────────────────────────────────────────────────────────────────
// Two-stream lead notes (NTS, PRN-13). Every path filters by author_role AND scope
// via noteWhere: an admin sees ONLY admin notes; a partner sees ONLY their own
// partner notes on their own leads. The two streams are mutually invisible. Edits
// are append-with-edit and audited (NTS-02). TST-08 proves the boundary live.
// ─────────────────────────────────────────────────────────────────────────────

// LeadNotFoundError is shared (C-5) — re-export the one class so every route's instanceof matches.
export { LeadNotFoundError };
export class NoteNotFoundError extends Error {
  constructor(id: string) {
    super(`Note ${id} not found.`);
    this.name = "NoteNotFoundError";
  }
}

export interface LeadNoteView {
  id: string;
  body: string;
  authorRole: string;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
}

/** The caller's own note stream for a lead (admin stream OR partner stream). */
export async function listLeadNotes(scope: ScopeContext, leadRefId: string): Promise<LeadNoteView[]> {
  const db = getDb();
  const [lead] = await db
    .select({ id: schema.leads.id })
    .from(schema.leads)
    .where(and(leadWhere(scope), eq(schema.leads.refId, leadRefId), partnerLive(scope)));
  if (!lead) throw new LeadNotFoundError(leadRefId);

  const rows = await db
    .select({
      id: schema.leadNotes.id,
      body: schema.leadNotes.body,
      authorRole: schema.leadNotes.authorRole,
      createdAt: schema.leadNotes.createdAt,
      updatedAt: schema.leadNotes.updatedAt,
    })
    .from(schema.leadNotes)
    .where(and(noteWhere(scope, db), eq(schema.leadNotes.leadId, lead.id)))
    .orderBy(desc(schema.leadNotes.createdAt));

  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    authorRole: r.authorRole,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    edited: r.updatedAt.getTime() - r.createdAt.getTime() > 1000,
  }));
}

/** Add a note to the caller's stream (author_role = the caller's role). Scoped. */
export async function addLeadNote(scope: ScopeContext, leadRefId: string, body: string): Promise<{ id: string }> {
  const db = getDb();
  const [lead] = await db
    .select({ id: schema.leads.id, tenantId: schema.leads.tenantId })
    .from(schema.leads)
    .where(and(leadWhere(scope), eq(schema.leads.refId, leadRefId), partnerLive(scope)));
  if (!lead) throw new LeadNotFoundError(leadRefId);

  const [note] = await db
    .insert(schema.leadNotes)
    .values({ tenantId: lead.tenantId, leadId: lead.id, authorUserId: scope.userId, authorRole: scope.role, body })
    .returning({ id: schema.leadNotes.id });
  return { id: note.id };
}

/**
 * Edit a note the caller authored, within their own stream (NTS-02). The note must
 * be visible under noteWhere AND authored by the caller — a partner can never touch
 * an admin note even with its id. The change is audited — but the note body is
 * consumer PII, so the append-only trail records only that the body changed, never
 * the text (SEC-05, ADR-0031). The real current body lives on lead_notes.body.
 */
export async function editLeadNote(
  scope: ScopeContext,
  noteId: string,
  body: string,
  traceId?: string,
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [note] = await tx
      .select({
        id: schema.leadNotes.id,
        tenantId: schema.leadNotes.tenantId,
        body: schema.leadNotes.body,
        authorUserId: schema.leadNotes.authorUserId,
      })
      .from(schema.leadNotes)
      .where(and(noteWhere(scope, tx), eq(schema.leadNotes.id, noteId)));
    if (!note || note.authorUserId !== scope.userId) throw new NoteNotFoundError(noteId);

    await tx.update(schema.leadNotes).set({ body, updatedAt: sql`now()` }).where(eq(schema.leadNotes.id, noteId));
    await tx.insert(schema.auditLog).values({
      tenantId: note.tenantId,
      actorUserId: scope.userId,
      action: "note.edited",
      entityType: "lead_note",
      entityRef: noteId,
      before: { body: maskAuditValue(note.body) },
      after: { body: maskAuditValue(body) },
      traceId: traceId ?? null,
    });
  });
}
