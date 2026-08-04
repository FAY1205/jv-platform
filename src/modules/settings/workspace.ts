import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";

// Workspace (tenant) settings write side. Admin-only, tenant-scoped (PRN-08) and
// audited. The tenants table is keyed by `id` (not a tenant_id column), so scope is
// enforced with `id = scope.tenantId` rather than tenantWhere().

export async function renameWorkspace(scope: ScopeContext, name: string): Promise<void> {
  const db = getDb();
  const [before] = await db
    .select({ name: schema.tenants.name })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, scope.tenantId));
  if (!before) return;
  if (before.name === name) return;

  await db.update(schema.tenants).set({ name }).where(eq(schema.tenants.id, scope.tenantId));
  await db.insert(schema.auditLog).values({
    tenantId: scope.tenantId,
    actorUserId: scope.userId,
    action: "workspace.renamed",
    entityType: "tenant",
    entityRef: scope.tenantId,
    before: { name: before.name },
    after: { name },
    traceId: globalThis.crypto.randomUUID(),
  });
}
