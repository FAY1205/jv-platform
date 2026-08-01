import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { purgeAuditLog } from "../helpers/audit";
import { renameWorkspace } from "@/modules/settings/workspace";
import type { ScopeContext } from "@/lib/scope";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-workspace-rename";

suite("Workspace rename (settings)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let scope: ScopeContext;

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await purgeAuditLog(db, inArray(schema.auditLog.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Old Name", slug: SLUG }).returning({ id: schema.tenants.id });
    scope = { tenantId: t.id, role: "admin", userId: randomUUID() };
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  it("updates the tenant name and writes an audit entry", async () => {
    await renameWorkspace(scope, "New Name");
    const [row] = await db.select({ name: schema.tenants.name }).from(schema.tenants).where(eq(schema.tenants.id, scope.tenantId));
    expect(row.name).toBe("New Name");
    const audits = await db.select().from(schema.auditLog).where(eq(schema.auditLog.tenantId, scope.tenantId));
    expect(audits.some((a) => a.action === "workspace.renamed")).toBe(true);
  });

  it("is a no-op (no error, no audit) when the name is unchanged", async () => {
    await renameWorkspace(scope, "New Name"); // same as current
    const audits = await db.select().from(schema.auditLog).where(eq(schema.auditLog.tenantId, scope.tenantId));
    expect(audits.filter((a) => a.action === "workspace.renamed").length).toBe(1);
  });
});
