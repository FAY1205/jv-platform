import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { tenantWhere } from "@/lib/scope";
import { jsonOk, jsonError } from "@/lib/http";

// WS-7: the authenticated caller's own identity for client chrome (profile menu +
// Profile settings). Scoped to the verified user within their tenant (PRN-08) — returns
// only the caller's own email/role + their workspace name. No secrets.
export async function GET() {
  try {
    const scope = await getServerScope();
    const db = getDb();
    const [row] = await db
      .select({ email: schema.users.email, name: schema.tenants.name })
      .from(schema.users)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.users.tenantId))
      .where(and(tenantWhere(schema.users, scope), eq(schema.users.id, scope.userId)));
    if (!row) return jsonError("not_found", "Account not found.", 404);
    return jsonOk({ email: row.email, role: scope.role, workspace: { name: row.name } });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("me_failed", "Could not load your account.", 500);
  }
}
