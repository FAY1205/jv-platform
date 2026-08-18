import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { requireCapabilityResponse } from "@/lib/authz";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";
import { RoleChangeSchema } from "@/modules/team/schema";
import { changeRole } from "@/modules/team/team";
import { mapSeatError } from "@/modules/team/http";

const IdSchema = z.string().uuid();

// Phase C TM-05..08: change a seat's role. Owner-only when the target IS an admin or the
// new role is admin (OQ-1); the owner's seat is immutable; self-change refused. The DB
// row is authoritative (enforcement binds next request); the auth-metadata sync fails
// LOUDLY so a demotion can never leave a silently stale 'admin' claim (ADR-0049 §3.3).
export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  const { userId } = await params;
  if (!IdSchema.safeParse(userId).success) return jsonError("invalid_input", "Invalid member.", 400);
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "team.manage");
    if (gate) return gate;
    const parsed = RoleChangeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("invalid_input", "A valid role is required.", 400);
    await changeRole(getSupabaseAdmin(), getDb(), scope, userId, parsed.data.role, globalThis.crypto.randomUUID());
    return jsonOk({ code: "ok" });
  } catch (e) {
    return (
      mapSeatError(e) ??
      authErrorResponse(e) ??
      jsonServerError("role_change_failed", "Could not change the role.", { message: e instanceof Error ? e.message : String(e) })
    );
  }
}
