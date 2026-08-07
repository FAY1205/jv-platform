import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { adminAllowlist } from "@/lib/env";
import { tenantWhere, type ScopeContext } from "@/lib/scope";

// SCP-07: the platform OWNER gate. There is no platform-super-admin role (roles are
// tenant-scoped admin|partner), so "owner" = a tenant admin whose email is in the
// ADMIN_ALLOWLIST env (the same list that already receives the platform alert mails).
// This is the app's first email-vs-allowlist authorization check; it gates only the
// owner-only signup-code surface.

export function isPlatformOwner(email: string | null | undefined): boolean {
  return !!email && adminAllowlist.includes(email.toLowerCase());
}

/** The caller's own email from their users row (scoped, PRN-08), or null. */
export async function callerEmail(scope: ScopeContext): Promise<string | null> {
  const [row] = await getDb()
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(and(tenantWhere(schema.users, scope), eq(schema.users.id, scope.userId)));
  return row?.email ?? null;
}

/** True iff the caller is a tenant admin AND on the platform-owner allowlist. */
export async function isCallerPlatformOwner(scope: ScopeContext): Promise<boolean> {
  if (scope.role !== "admin") return false;
  return isPlatformOwner(await callerEmail(scope));
}
