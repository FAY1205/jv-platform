import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { purgeAuditLog } from "../helpers/audit";
import { listAdminActivity, listPartnerActivity } from "@/modules/activity/queries";
import { ActivityQuerySchema } from "@/modules/activity/schema";
import type { ScopeContext } from "@/lib/scope";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-activity-wp034";

suite("WP-034: activity views (ACT-01/02/04)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let admin: ScopeContext;
  let partner: ScopeContext;

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await purgeAuditLog(db, inArray(schema.auditLog.tenantId, tids));
    for (const tbl of [schema.leadNotes, schema.leadStatusHistory, schema.leads, schema.uploads, schema.users, schema.partners]) {
      await db.delete(tbl).where(inArray(tbl.tenantId, tids));
    }
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Act", slug: SLUG }).returning({ id: schema.tenants.id });
    const adminUserId = randomUUID();
    const partnerUserId = randomUUID();
    const [p] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-001", name: "Alpha", color: "#f4c95d", status: "active" }).returning({ id: schema.partners.id });
    await db.insert(schema.users).values([
      { id: adminUserId, tenantId: t.id, email: "admin@t.test", role: "admin" },
      { id: partnerUserId, tenantId: t.id, email: "alpha@p.test", role: "partner", partnerId: p.id },
    ]);
    admin = { tenantId: t.id, role: "admin", userId: adminUserId };
    partner = { tenantId: t.id, role: "partner", userId: partnerUserId, partnerId: p.id };

    const [up] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-001", filename: "w.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    const [lead] = await db.insert(schema.leads).values({ tenantId: t.id, refId: "LD-26-00001", uploadId: up.id, dedupeKey: "1|75001", rawJson: {}, partnerId: p.id, mlsStatus: "kept", createdAt: new Date(Date.now() - 20 * 60 * 1000) }).returning({ id: schema.leads.id }); // backdated past the hold window (released)

    await db.insert(schema.auditLog).values([
      { tenantId: t.id, actorUserId: adminUserId, action: "mls_pattern.updated", entityType: "rule", entityRef: "dq_is_listed_yes" },
      { tenantId: t.id, actorUserId: adminUserId, action: "partner.created", entityType: "partner", entityRef: "JV-001" },
    ]);
    await db.insert(schema.leadStatusHistory).values({ tenantId: t.id, leadId: lead.id, status: "Contacted", changedByUserId: partnerUserId });
    await db.insert(schema.leadNotes).values({ tenantId: t.id, leadId: lead.id, authorUserId: partnerUserId, authorRole: "partner", body: "called" });
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  it("ACT-01/04: admin sees the audit trail with actor + security categorization", async () => {
    const p = await listAdminActivity(admin, ActivityQuerySchema.parse({}));
    expect(p.total).toBe(2);
    const ruleEvent = p.items.find((i) => i.action === "mls_pattern.updated")!;
    expect(ruleEvent.category).toBe("security");
    expect(ruleEvent.actor).toBe("admin@t.test"); // resolved from actorUserId
    expect(p.items.find((i) => i.action === "partner.created")!.category).toBe("data");
  });

  it("ACT-02: a partner sees only their own actions (status + note) on their leads", async () => {
    const p = await listPartnerActivity(partner);
    expect(p.items).toHaveLength(2);
    expect(p.items.some((i) => i.kind === "status" && i.detail.includes("Contacted"))).toBe(true);
    expect(p.items.some((i) => i.kind === "note" && i.detail.includes("LD-26-00001"))).toBe(true);
    // WP-PP-5: a real total (statuses + notes) so the shared Pagination can drive the view.
    expect(p.total).toBe(2);
  });
});
