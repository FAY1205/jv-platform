import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { purgeAuditLog } from "../helpers/audit";
import type { ScopeContext } from "@/lib/scope";
import { listAdminActivity, listActivityActors } from "@/modules/activity/queries";
import { ActivityQuerySchema } from "@/modules/activity/schema";

// TST-01 family: ACT-01/04 server-side activity filtering. Self-skips without DATABASE_URL.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-activity-filter";

suite("WS-8c: activity filtering (ACT-01/04)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let scope: ScopeContext;
  const id: Record<string, string> = {};

  async function cleanup() {
    const rows = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(inArray(schema.tenants.slug, [SLUG]));
    const tids = rows.map((t) => t.id);
    if (tids.length === 0) return;
    await purgeAuditLog(db, inArray(schema.auditLog.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  const q = (o: Record<string, unknown>) => ActivityQuerySchema.parse(o);

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Act", slug: SLUG }).returning({ id: schema.tenants.id });
    id.tenant = t.id;
    id.u1 = randomUUID();
    id.u2 = randomUUID();
    await db.insert(schema.users).values({ id: id.u1, tenantId: t.id, email: "alice@a.test", role: "admin" });
    await db.insert(schema.users).values({ id: id.u2, tenantId: t.id, email: "bob@a.test", role: "admin" });
    scope = { tenantId: t.id, role: "admin", userId: id.u1 };

    const row = (action: string, actor: string) => ({
      tenantId: t.id,
      actorUserId: actor,
      action,
      entityType: "x",
      entityRef: action.split(".")[0].toUpperCase(),
      traceId: randomUUID(),
    });
    await db.insert(schema.auditLog).values([
      row("mls_pattern.updated", id.u1), // security (prefix)
      row("partner.created", id.u2), // data
      row("partner.deactivated", id.u1), // security (marker)
      row("upload.voided", id.u2), // security (marker)
      row("note.edited", id.u1), // security (marker)
      row("mlsxpattern.updated", id.u2), // DATA — the "_" is literal, not a LIKE wildcard (F-1)
    ]);
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  it("ACT-04: category=security returns exactly the security-classified actions", async () => {
    const res = await listAdminActivity(scope, q({ category: "security" }));
    const actions = res.items.map((i) => i.action).sort();
    expect(actions).toEqual(["mls_pattern.updated", "note.edited", "partner.deactivated", "upload.voided"].sort());
    expect(res.items.every((i) => i.category === "security")).toBe(true);
  });

  it("ACT-04: category=data excludes security actions but keeps look-alikes ('_' is literal, F-1)", async () => {
    const res = await listAdminActivity(scope, q({ category: "data" }));
    expect(res.items.map((i) => i.action).sort()).toEqual(["mlsxpattern.updated", "partner.created"].sort());
  });

  it("F-1: category=security matches the underscore literally (not 'mlsxpattern.updated')", async () => {
    const res = await listAdminActivity(scope, q({ category: "security" }));
    expect(res.items.map((i) => i.action)).not.toContain("mlsxpattern.updated");
    expect(res.items.map((i) => i.action)).toContain("mls_pattern.updated");
  });

  it("ACT-01: actor filter returns only that actor's rows", async () => {
    const res = await listAdminActivity(scope, q({ actor: id.u2 }));
    expect(res.items.map((i) => i.action).sort()).toEqual(["mlsxpattern.updated", "partner.created", "upload.voided"].sort());
  });

  it("ACT-01: search matches on the action string (case-insensitive)", async () => {
    const res = await listAdminActivity(scope, q({ q: "PARTNER" }));
    expect(res.items.map((i) => i.action).sort()).toEqual(["partner.created", "partner.deactivated"].sort());
  });

  it("ACT-01: a literal % (and _) in the search query matches literally, never as a wildcard", async () => {
    // Seeded inside the test (and removed after) so the sibling assertions' row counts stay
    // untouched. Non-vacuous by construction (TST-11): the % query must find EXACTLY the
    // seeded row — pre-fix it matched every row in the tenant.
    const [r] = await db
      .insert(schema.auditLog)
      .values({ tenantId: id.tenant, actorUserId: id.u1, action: "promo.50%off", entityType: "x", entityRef: "PROMO", traceId: randomUUID() })
      .returning({ id: schema.auditLog.id });
    try {
      const percent = await listAdminActivity(scope, q({ q: "%" }));
      expect(percent.total).toBe(1);
      expect(percent.items.map((i) => i.action)).toEqual(["promo.50%off"]);
      // `_` was a single-character wildcard pre-fix (matched every row); literally it hits
      // only the one seeded action that truly contains an underscore.
      const underscore = await listAdminActivity(scope, q({ q: "_" }));
      expect(underscore.items.map((i) => i.action)).toEqual(["mls_pattern.updated"]);
    } finally {
      await purgeAuditLog(db, inArray(schema.auditLog.id, [r.id]));
    }
  });

  it("ACT-01: pageSize + total drive pagination", async () => {
    const res = await listAdminActivity(scope, q({ pageSize: "10" }));
    expect(res.total).toBe(6);
    expect(res.pageSize).toBe(10);
  });

  it("ACT-01: listActivityActors returns the distinct actors present", async () => {
    const actors = await listActivityActors(scope);
    expect(actors.map((a) => a.email).sort()).toEqual(["alice@a.test", "bob@a.test"]);
  });
});
