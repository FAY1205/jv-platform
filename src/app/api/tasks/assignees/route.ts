import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { listStreamAssignees } from "@/modules/tasks/tasks";
import { jsonOk, jsonServerError } from "@/lib/http";
import { requirePassthroughResponse } from "@/lib/authz";

// GET /api/tasks/assignees — TSK-13 (C-46): the caller's OWN-stream, ACTIVE roster for the
// task assignee picker, for BOTH roles. The scope decides the stream, exactly like its
// /api/tasks siblings: an admin-stream caller gets staff seats, a partner gets their own
// org's seats and never another org's or an admin's (PRN-13). No CSRF — this is a GET.
//
// Gated on `work.write`, not `leads.read`: the roster exists only to author work, so a seat
// that cannot create or edit a task has no reason to enumerate its colleagues' emails.
// ADR-0047 Phase C: a PARTNER passes on scope alone (partners hold no capability by
// construction); an admin-stream caller reaching this partner-shaped code must hold it.
//
// Static segment, so it never collides with /api/tasks/[id] (which serves PATCH/DELETE only).
export async function GET() {
  try {
    const scope = await getServerScope();
    const gate = requirePassthroughResponse(scope, "work.write");
    if (gate) return gate;
    const tos = await requireTosResponse(getDb(), scope); // F-04/LGL-01: partners, and self-serve admins, must have accepted the current ToS
    if (tos) return tos;
    return jsonOk({ assignees: await listStreamAssignees(scope) });
  } catch (e) {
    return (
      authErrorResponse(e) ??
      jsonServerError("assignees_failed", "Could not load your team.", {
        message: e instanceof Error ? e.message : String(e),
      })
    );
  }
}
