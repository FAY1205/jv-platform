import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";

// ─────────────────────────────────────────────────────────────────────────────
// Server-side scope resolution. In Phase 1 (admin-only, no portal yet) this resolves
// the dev tenant as admin so the pipeline UI has a scope to query through (PRN-08).
//
// TODO (Phase 2, PTL-01): replace with the authenticated Supabase session →
// tenant/role/partner from JWT app_metadata claims. The scope guard (lib/scope.ts)
// and RLS do not change; only this resolver does.
// ─────────────────────────────────────────────────────────────────────────────

const DEV_TENANT_SLUG = "dev-jv";
const SYSTEM_ADMIN_USER = "00000000-0000-0000-0000-000000000000";

let cached: ScopeContext | null = null;

export async function getServerScope(): Promise<ScopeContext> {
  if (cached) return cached;
  const db = getDb();
  const [tenant] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, DEV_TENANT_SLUG));
  if (!tenant) {
    throw new Error(`Dev tenant "${DEV_TENANT_SLUG}" not found — run the seed first.`);
  }
  cached = { tenantId: tenant.id, role: "admin", userId: SYSTEM_ADMIN_USER };
  return cached;
}
