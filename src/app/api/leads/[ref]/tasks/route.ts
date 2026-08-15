import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { listLeadTasks, addLeadTask, LeadNotFoundError, InvalidAssigneeError } from "@/modules/tasks/tasks";
import { CreateTaskSchema } from "@/modules/tasks/schema";
import { jsonOk, jsonError, jsonServerError, newTraceId } from "@/lib/http";

// Shared lead-task API (TSK-01/02, ADR-0044): both admin and partner use it; the scope
// decides the stream, exactly like the notes endpoints. GET returns the caller's own
// stream for the lead; POST adds to it. Scoped + ToS-gated; POST is CSRF-protected.
const RefSchema = z.string().regex(/^LD-\d{2}-\d{5,}$/);

export async function GET(_req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  if (!RefSchema.safeParse(ref).success) return jsonError("invalid_ref", "Invalid lead reference.", 400);
  try {
    const scope = await getServerScope();
    const tos = await requireTosResponse(getDb(), scope); // F-04/LGL-01: partners, and self-serve admins, must have accepted the current ToS
    if (tos) return tos;
    const tasks = await listLeadTasks(scope, ref);
    return jsonOk({ tasks });
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    if (e instanceof LeadNotFoundError) return jsonError("not_found", e.message, 404);
    return jsonServerError("tasks_failed", "Failed to load tasks.", { message: e instanceof Error ? e.message : String(e) });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  const { ref } = await params;
  if (!RefSchema.safeParse(ref).success) return jsonError("invalid_ref", "Invalid lead reference.", 400);
  const parsed = CreateTaskSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("invalid_input", "A task title is required.", 400);
  try {
    const scope = await getServerScope();
    const tos = await requireTosResponse(getDb(), scope); // F-04/LGL-01: partners, and self-serve admins, must have accepted the current ToS
    if (tos) return tos;
    // author_role/author_user_id/tenant_id are derived server-side inside addLeadTask —
    // the body carries only the title, an optional due date, and an assignee HINT.
    const result = await addLeadTask(
      scope,
      ref,
      { title: parsed.data.title, dueOn: parsed.data.dueOn ?? null, assignedToUserId: parsed.data.assignedToUserId },
      newTraceId(),
    );
    return jsonOk(result);
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    if (e instanceof LeadNotFoundError) return jsonError("not_found", e.message, 404);
    if (e instanceof InvalidAssigneeError) return jsonError("invalid_assignee", e.message, 400);
    return jsonServerError("task_add_failed", "Failed to add task.", { message: e instanceof Error ? e.message : String(e) });
  }
}
