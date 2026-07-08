import { z } from "zod";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { listLeadNotes, addLeadNote, LeadNotFoundError } from "@/modules/notes/notes";
import { jsonOk, jsonError } from "@/lib/http";

// Shared note API (NTS/PRN-13): both admin and partner use it; scope decides the
// stream. GET returns the caller's own stream; POST adds to it. Scoped + CSRF.
const RefSchema = z.string().regex(/^LD-\d{4}-\d{3,}$/);
const Body = z.object({ body: z.string().trim().min(1).max(5000) });

export async function GET(_req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  if (!RefSchema.safeParse(ref).success) return jsonError("invalid_ref", "Invalid lead reference.", 400);
  try {
    const notes = await listLeadNotes(await getServerScope(), ref);
    return jsonOk({ notes });
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    if (e instanceof LeadNotFoundError) return jsonError("not_found", e.message, 404);
    return jsonError("notes_failed", e instanceof Error ? e.message : "Failed to load notes.", 500);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  const { ref } = await params;
  if (!RefSchema.safeParse(ref).success) return jsonError("invalid_ref", "Invalid lead reference.", 400);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("invalid_input", "A note body is required.", 400);
  try {
    const result = await addLeadNote(await getServerScope(), ref, parsed.data.body);
    return jsonOk(result);
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    if (e instanceof LeadNotFoundError) return jsonError("not_found", e.message, 404);
    return jsonError("note_add_failed", e instanceof Error ? e.message : "Failed to add note.", 500);
  }
}
