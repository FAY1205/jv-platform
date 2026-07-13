import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";

/** Backdate a tenant's leads' `created_at` past the distribution hold window so they are RELEASED
 *  (partner-visible) in tests. The hold gates fresh leads from partners; tests that assert partner
 *  visibility call this after creating the leads (mirrors production, where 10 min have elapsed). */
export async function releaseTenantLeads(db: PostgresJsDatabase<typeof schema>, tenantId: string): Promise<void> {
  await db
    .update(schema.leads)
    .set({ createdAt: new Date(Date.now() - 20 * 60 * 1000) })
    .where(eq(schema.leads.tenantId, tenantId));
}
