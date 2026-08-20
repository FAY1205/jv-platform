import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { requireCapabilityResponse } from "@/lib/authz";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";
import { notifyTeamInvite } from "@/lib/auth/notify";
import { env } from "@/lib/env";
import { InviteInputSchema } from "@/modules/team/schema";
import { createInvite, DuplicateSeatError, OwnerOnlyError } from "@/modules/team/team";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";

const ROLE_LABELS: Record<string, string> = { admin: "an Admin", member: "a Member", viewer: "a Viewer" };

// Phase C TM-03: invite a teammate by email + role. The one-time token exists only in
// the emailed link (SEC-05: never logged, never in the response). team.manage gates the
// surface; granting the ADMIN role additionally requires the workspace owner (OQ-1).
export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "team.manage");
    if (gate) return gate;
    const parsed = InviteInputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("invalid_input", "A valid email and role are required.", 400);

    const db = getDb();
    const { inviteId, token } = await createInvite(db, scope, parsed.data);
    const [tenant] = await db
      .select({ name: schema.tenants.name })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, scope.tenantId));
    // Best-effort delivery (SEC-07 sink in non-prod); the invite row is the source of
    // truth and Resend can be retried from the roster.
    // C-101 (CWE-644): links that leave the system travel on env.APP_URL (the canonical origin,
    // prod-guarded in lib/env), never the request Host — the one-time seat token lives ONLY in
    // this link, so a forged Host would hand it to an attacker origin along with the seat.
    await notifyTeamInvite(
      parsed.data.email,
      tenant?.name ?? "your workspace",
      ROLE_LABELS[parsed.data.role] ?? parsed.data.role,
      `${env.APP_URL}/team-invite/${token}`,
    );
    return jsonOk({ inviteId });
  } catch (e) {
    if (e instanceof DuplicateSeatError) return jsonError("duplicate_seat", e.message, 409);
    if (e instanceof OwnerOnlyError) return jsonError("forbidden", e.message, 403);
    return (
      authErrorResponse(e) ??
      jsonServerError("invite_failed", "Could not send the invite.", { message: e instanceof Error ? e.message : String(e) })
    );
  }
}
