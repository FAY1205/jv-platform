import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { listMyTasks } from "@/modules/tasks/tasks";
import { MyTasksQuerySchema } from "@/modules/tasks/schema";
import { jsonOk, jsonServerError } from "@/lib/http";

// GET /api/tasks — My Tasks (TSK-07), for BOTH roles: the caller's own open (or done)
// tasks across every lead their stream can see, server-paginated. No role gate — the scope
// guard inside listMyTasks is what separates the streams (PRN-08), same as the notes API.
export async function GET(request: Request) {
  try {
    const scope = await getServerScope();
    const tos = await requireTosResponse(getDb(), scope); // F-04/LGL-01: partners, and self-serve admins, must have accepted the current ToS
    if (tos) return tos;
    const query = MyTasksQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return jsonOk(await listMyTasks(scope, query));
  } catch (e) {
    return (
      authErrorResponse(e) ??
      jsonServerError("my_tasks_failed", "Could not load your tasks.", { message: e instanceof Error ? e.message : String(e) })
    );
  }
}
