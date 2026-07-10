import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import * as schema from "@/db/schema";
import { purgeAuditLog } from "../helpers/audit";

// Runs against a live Postgres (dev DB locally; CI service container). Self-skips
// when DATABASE_URL is unset. Proves the migration-0014 append-only trigger (F-05).
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-audit-immutable-ws9";

suite("F-05: audit_log is append-only (DB trigger)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let tenantId: string;
  let rowId: string;

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
    const [t] = await db.insert(schema.tenants).values({ name: "Audit Immutable", slug: SLUG }).returning({ id: schema.tenants.id });
    tenantId = t.id;
    const [row] = await db
      .insert(schema.auditLog)
      .values({ tenantId, action: "partner.created", entityType: "partner", entityRef: "JV-001", traceId: "t-1" })
      .returning({ id: schema.auditLog.id });
    rowId = row.id;
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  it("F-05: INSERT (append) is allowed", async () => {
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.id, rowId));
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("partner.created");
  });

  it("F-05: UPDATE is rejected", async () => {
    await expect(
      db.update(schema.auditLog).set({ action: "tampered" }).where(eq(schema.auditLog.id, rowId)),
    ).rejects.toThrow(/append-only/);
    // The row is unchanged.
    const [row] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.id, rowId));
    expect(row.action).toBe("partner.created");
  });

  it("F-05: DELETE is rejected", async () => {
    await expect(
      db.delete(schema.auditLog).where(eq(schema.auditLog.id, rowId)),
    ).rejects.toThrow(/append-only/);
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.id, rowId));
    expect(rows).toHaveLength(1);
  });

  it("F-05: the explicit purge escape hatch can delete (retention/test teardown)", async () => {
    await purgeAuditLog(db, eq(schema.auditLog.id, rowId));
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.id, rowId));
    expect(rows).toHaveLength(0);
    // Re-seed so afterAll cleanup + other assertions have a stable tenant to remove.
    const [row] = await db
      .insert(schema.auditLog)
      .values({ tenantId, action: "partner.created", entityType: "partner", entityRef: "JV-001", traceId: "t-2" })
      .returning({ id: schema.auditLog.id });
    rowId = row.id;
  });
});
