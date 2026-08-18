import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { requireCapabilityResponse } from "@/lib/authz";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";
import { reactivateMember } from "@/modules/team/team";
import { mapSeatError } from "@/modules/team/http";

const IdSchema = z.string().uuid();

// Phase C: reactivate a deactivated seat — they return with their previous role and
// their existing password (TM: the roster's Reactivate affordance).
export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  const { userId } = await params;
  if (!IdSchema.safeParse(userId).success) return jsonError("invalid_input", "Invalid member.", 400);
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "team.manage");
    if (gate) return gate;
    await reactivateMember(getSupabaseAdmin(), getDb(), scope, userId, globalThis.crypto.randomUUID());
    return jsonOk({ code: "ok" });
  } catch (e) {
    return (
      mapSeatError(e) ??
      authErrorResponse(e) ??
      jsonServerError("reactivate_failed", "Could not reactivate the member.", { message: e instanceof Error ? e.message : String(e) })
    );
  }
}
