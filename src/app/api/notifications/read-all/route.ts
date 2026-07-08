import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { markAllRead } from "@/modules/notify/notifications";
import { jsonOk, jsonError } from "@/lib/http";

// NTF-04: mark all of the caller's notifications read.
export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  try {
    const scope = await getServerScope();
    await markAllRead(scope);
    return jsonOk({ code: "ok", message: "All marked read." });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("mark_all_failed", "Could not mark all read.", 500);
  }
}
