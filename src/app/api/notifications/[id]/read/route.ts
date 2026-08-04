import { z } from "zod";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { markRead } from "@/modules/notify/notifications";
import { jsonOk, jsonError } from "@/lib/http";

const IdSchema = z.string().uuid();

// NTF-04: mark one notification read (only the caller's own — scoped in the module).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  try {
    const scope = await getServerScope();
    const { id } = await params;
    if (!IdSchema.safeParse(id).success) return jsonError("invalid_id", "Invalid id.", 400);
    await markRead(scope, id);
    return jsonOk({ code: "ok", message: "Marked read." });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("mark_read_failed", "Could not mark read.", 500);
  }
}
