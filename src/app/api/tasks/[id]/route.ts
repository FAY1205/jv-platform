import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import {
  editLeadTask,
  completeLeadTask,
  reopenLeadTask,
  deleteLeadTask,
  TaskNotFoundError,
  TaskClosedError,
  InvalidAssigneeError,
} from "@/modules/tasks/tasks";
import { EditTaskSchema, TaskActionSchema } from "@/modules/tasks/schema";
import { jsonOk, jsonError, jsonServerError, newTraceId } from "@/lib/http";
import { requirePassthroughResponse } from "@/lib/authz";

// PATCH/DELETE /api/tasks/[id] — mutate ONE task by id (TSK-04/05). Shared by both roles;
// the scope guard decides which tasks exist for the caller, so a task id from another
// tenant, org, or stream 404s identically to a deleted one. CSRF-protected.
//
// PATCH is two shapes on one endpoint: `{action:"complete"|"reopen"}` toggles done state
// (idempotent, TSK-04), anything else is a field edit. `action` is what selects the branch,
// so an edit body may not carry it — the two are never mixed and never ambiguous.

/** Map a task command's domain errors to the uniform envelope. Shared by both verbs. */
function taskErrorResponse(e: unknown) {
  const authResp = authErrorResponse(e);
  if (authResp) return authResp;
  if (e instanceof TaskNotFoundError) return jsonError("not_found", e.message, 404);
  if (e instanceof TaskClosedError) return jsonError("task_closed", e.message, 409);
  if (e instanceof InvalidAssigneeError) return jsonError("invalid_assignee", e.message, 400);
  return null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return jsonError("invalid_id", "Invalid task id.", 400);

  const raw: unknown = await request.json().catch(() => null);
  const isAction = typeof raw === "object" && raw !== null && "action" in raw;
  const parsed = isAction ? TaskActionSchema.safeParse(raw) : EditTaskSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError("invalid_input", isAction ? "Unknown task action." : "Nothing to change.", 400);
  }

  try {
    const scope = await getServerScope();
    // ADR-0047 Phase C: partners pass on scope alone; an ADMIN-STREAM caller reaches
    // tenant-wide data through this partner-shaped code, so it must hold work.write.
    const gate = requirePassthroughResponse(scope, "work.write");
    if (gate) return gate;
    const tos = await requireTosResponse(getDb(), scope); // F-04/LGL-01: partners, and self-serve admins, must have accepted the current ToS
    if (tos) return tos;
    const traceId = newTraceId();
    if ("action" in parsed.data) {
      if (parsed.data.action === "complete") await completeLeadTask(scope, id, traceId);
      else await reopenLeadTask(scope, id, traceId);
      return jsonOk({ code: "ok", message: parsed.data.action === "complete" ? "Task completed." : "Task reopened." });
    }
    await editLeadTask(scope, id, parsed.data, traceId);
    return jsonOk({ code: "ok", message: "Task updated." });
  } catch (e) {
    return (
      taskErrorResponse(e) ??
      jsonServerError("task_update_failed", "Failed to update task.", { message: e instanceof Error ? e.message : String(e) })
    );
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return jsonError("invalid_id", "Invalid task id.", 400);
  try {
    const scope = await getServerScope();
    // ADR-0047 Phase C: partners pass on scope alone; an ADMIN-STREAM caller reaches
    // tenant-wide data through this partner-shaped code, so it must hold work.write.
    const gate = requirePassthroughResponse(scope, "work.write");
    if (gate) return gate;
    const tos = await requireTosResponse(getDb(), scope); // F-04/LGL-01: partners, and self-serve admins, must have accepted the current ToS
    if (tos) return tos;
    // Author-only + open-only live in deleteLeadTask (TSK-05); a non-author sees the 404.
    await deleteLeadTask(scope, id, newTraceId());
    return jsonOk({ code: "ok", message: "Task deleted." });
  } catch (e) {
    return (
      taskErrorResponse(e) ??
      jsonServerError("task_delete_failed", "Failed to delete task.", { message: e instanceof Error ? e.message : String(e) })
    );
  }
}
