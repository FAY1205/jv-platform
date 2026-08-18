import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { requireCapabilityResponse } from "@/lib/authz";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";
import { notifyTeamInvite } from "@/lib/auth/notify";
import { resendInvite, revokeInvite } from "@/modules/team/team";
import { mapSeatError } from "@/modules/team/http";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";

const IdSchema = z.string().uuid();
const ROLE_LABELS: Record<string, string> = { admin: "an Admin", member: "a Member", viewer: "a Viewer" };

// Phase C TM-03: re-issue the invite link (new token, fresh 7-day window; the old link
// dies with the old hash). Server-throttled to one resend a minute.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return jsonError("invalid_input", "Invalid invite.", 400);
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "team.manage");
    if (gate) return gate;
    const db = getDb();
    const { email, role, token } = await resendInvite(db, scope, id);
    const [tenant] = await db
      .select({ name: schema.tenants.name })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, scope.tenantId));
    const origin = new URL(request.url).origin;
    await notifyTeamInvite(email, tenant?.name ?? "your workspace", ROLE_LABELS[role] ?? role, `${origin}/team-invite/${token}`);
    return jsonOk({ code: "ok" });
  } catch (e) {
    return (
      mapSeatError(e) ??
      authErrorResponse(e) ??
      jsonServerError("resend_failed", "Could not re-send the invite.", { message: e instanceof Error ? e.message : String(e) })
    );
  }
}

// Phase C TM-04: revoke a pending invite — the emailed link stops working immediately.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return jsonError("invalid_input", "Invalid invite.", 400);
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "team.manage");
    if (gate) return gate;
    await revokeInvite(getDb(), scope, id);
    return jsonOk({ code: "ok" });
  } catch (e) {
    return (
      mapSeatError(e) ??
      authErrorResponse(e) ??
      jsonServerError("revoke_failed", "Could not revoke the invite.", { message: e instanceof Error ? e.message : String(e) })
    );
  }
}
