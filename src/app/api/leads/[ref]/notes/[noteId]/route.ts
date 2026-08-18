import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { editLeadNote, NoteNotFoundError } from "@/modules/notes/notes";
import { jsonOk, jsonError, jsonServerError, newTraceId } from "@/lib/http";
import { requirePassthroughResponse } from "@/lib/authz";

// PATCH /api/leads/[ref]/notes/[noteId] — edit a note the caller authored (NTS-02,
// audited). Scope + author check inside editLeadNote; CSRF-protected.
const Body = z.object({ body: z.string().trim().min(1).max(5000) });

export async function PATCH(request: Request, { params }: { params: Promise<{ ref: string; noteId: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  const { noteId } = await params;
  if (!z.string().uuid().safeParse(noteId).success) return jsonError("invalid_id", "Invalid note id.", 400);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("invalid_input", "A note body is required.", 400);
  try {
    const scope = await getServerScope();
    // ADR-0047 Phase C: partners pass on scope alone; an ADMIN-STREAM caller reaches
    // tenant-wide data through this partner-shaped code, so it must hold work.write.
    const gate = requirePassthroughResponse(scope, "work.write");
    if (gate) return gate;
    const tos = await requireTosResponse(getDb(), scope); // F-04/LGL-01: partners, and self-serve admins, must have accepted the current ToS
    if (tos) return tos;
    await editLeadNote(scope, noteId, parsed.data.body, newTraceId());
    return jsonOk({ code: "ok", message: "Note updated." });
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    if (e instanceof NoteNotFoundError) return jsonError("not_found", e.message, 404);
    return jsonServerError("note_edit_failed", "Failed to edit note.", { message: e instanceof Error ? e.message : String(e) });
  }
}
