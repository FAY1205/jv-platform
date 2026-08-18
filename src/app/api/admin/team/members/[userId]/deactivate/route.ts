import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { requireCapabilityResponse } from "@/lib/authz";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { TrustedDeviceService } from "@/lib/auth/trusted-device";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";
import { deactivateMember } from "@/modules/team/team";
import { mapSeatError } from "@/modules/team/http";

const IdSchema = z.string().uuid();

// Phase C TM-09..11: deactivate a seat — access ends immediately (resolveScope refuses
// the row per request), sessions/devices are torn down, and EVERYTHING they authored
// stays in place and attributed (never delete a member). Reactivation restores the seat.
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
    const db = getDb();
    const devices = new TrustedDeviceService(db);
    await deactivateMember(getSupabaseAdmin(), db, scope, userId, {
      revokeAllForUser: (uid, now) => devices.revokeAllForUser(uid, now),
    }, globalThis.crypto.randomUUID());
    return jsonOk({ code: "ok" });
  } catch (e) {
    return (
      mapSeatError(e) ??
      authErrorResponse(e) ??
      jsonServerError("deactivate_failed", "Could not deactivate the member.", { message: e instanceof Error ? e.message : String(e) })
    );
  }
}
