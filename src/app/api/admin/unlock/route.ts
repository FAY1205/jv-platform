import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { getServerScope } from "@/lib/scope-context";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import { assertCsrf, authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";
import { jsonOk, jsonError } from "@/lib/http";

// AUT-04: an admin can clear a locked account's recent failed attempts. Admin-only,
// CSRF-protected. (A button surfaces with the admin activity screens — WP-034.)
// PRN-08: auth_attempts is tenant-less (ADR-0010), so the target email must first
// resolve to a users row inside the CALLER's tenant — an admin can never clear the
// lockout ladder for an account they don't own. The response is uniform whether or
// not the email exists (AUT-05), and a real clear is audited (ACT-04).
const Input = z.object({
  email: z.email(),
  kind: z.enum(["login", "reset", "change_password"]).default("login"),
});

export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }

  let scope: ScopeContext;
  try {
    scope = await getServerScope();
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("scope_failed", "Could not resolve session.", 500);
  }
  const forbidden = requireAdminResponse(scope);
  if (forbidden) return forbidden;

  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("invalid_input", "A valid email is required.", 400);
  }

  const email = parsed.data.email.toLowerCase();
  const db = getDb();
  const [target] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(tenantWhere(schema.users, scope), eq(schema.users.email, email)));

  if (target) {
    await new AuthAttemptsStore(db).clearFailures(email, parsed.data.kind);
    // ACT-04: clearing another account's brute-force protection is admin evidence.
    await db.insert(schema.auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: scope.userId,
      action: "auth.lockout_cleared",
      entityType: "user",
      entityRef: target.id,
      before: null,
      after: { kind: parsed.data.kind },
      traceId: globalThis.crypto.randomUUID(),
    });
  }

  // AUT-05: identical response whether or not the email resolved in-tenant.
  return jsonOk({ code: "ok", message: "Account unlocked." });
}
