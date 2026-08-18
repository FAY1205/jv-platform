import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { listLeadNotes, addLeadNote, LeadNotFoundError } from "@/modules/notes/notes";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";
import { requirePassthroughResponse } from "@/lib/authz";

// Shared note API (NTS/PRN-13): both admin and partner use it; scope decides the
// stream. GET returns the caller's own stream; POST adds to it. Scoped + CSRF.
const RefSchema = z.string().regex(/^LD-\d{2}-\d{5,}$/);
const Body = z.object({ body: z.string().trim().min(1).max(5000) });

export async function GET(_req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  if (!RefSchema.safeParse(ref).success) return jsonError("invalid_ref", "Invalid lead reference.", 400);
  try {
    const scope = await getServerScope();
    // ADR-0047 Phase C: partners pass on scope alone; an ADMIN-STREAM caller reaches
    // tenant-wide data through this partner-shaped code, so it must hold leads.read.
    const gate = requirePassthroughResponse(scope, "leads.read");
    if (gate) return gate;
    const tos = await requireTosResponse(getDb(), scope); // F-04/LGL-01: partners, and self-serve admins, must have accepted the current ToS
    if (tos) return tos;
    const notes = await listLeadNotes(scope, ref);
    return jsonOk({ notes });
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    if (e instanceof LeadNotFoundError) return jsonError("not_found", e.message, 404);
    return jsonServerError("notes_failed", "Failed to load notes.", { message: e instanceof Error ? e.message : String(e) });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  const { ref } = await params;
  if (!RefSchema.safeParse(ref).success) return jsonError("invalid_ref", "Invalid lead reference.", 400);
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
    const result = await addLeadNote(scope, ref, parsed.data.body);
    return jsonOk(result);
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    if (e instanceof LeadNotFoundError) return jsonError("not_found", e.message, 404);
    return jsonServerError("note_add_failed", "Failed to add note.", { message: e instanceof Error ? e.message : String(e) });
  }
}
