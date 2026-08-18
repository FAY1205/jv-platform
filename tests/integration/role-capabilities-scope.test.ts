import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { resolveScope } from "@/lib/scope-context";

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0049 / audit-tenancy F-6: the getServerScope role_capabilities LEFT JOIN,
// proven against a REAL database (the unit tests stub the builder, so the join
// predicate itself was never evaluated by Postgres). Three legs: a tenant's own
// config row rides onto its member's scope; a SIBLING tenant's row never leaks
// (cross-tenant join safety — the one place a wrong predicate becomes a
// cross-tenant capability grant, ADR-0013); admin/partner ignore stray rows.
// The query below is the SAME shape getServerScope runs (join on tenant+role).
// ─────────────────────────────────────────────────────────────────────────────

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG_A = "test-rolecaps-a";
const SLUG_B = "test-rolecaps-b";

suite("ADR-0049: role_capabilities resolution joins tenant-safely", () => {
  let db: ReturnType<typeof getDb>;
  let tenantA: string;
  let tenantB: string;
  const memberA = randomUUID();
  const adminA = randomUUID();

  async function fetchRow(userId: string) {
    const [row] = await db
      .select({
        tenantId: schema.users.tenantId,
        role: schema.users.role,
        partnerId: schema.users.partnerId,
        deactivatedAt: schema.users.deactivatedAt,
        storedCapabilities: schema.roleCapabilities.capabilities,
      })
      .from(schema.users)
      .leftJoin(
        schema.roleCapabilities,
        and(
          eq(schema.roleCapabilities.tenantId, schema.users.tenantId),
          eq(schema.roleCapabilities.role, schema.users.role),
        ),
      )
      .where(eq(schema.users.id, userId));
    return row;
  }

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(inArray(schema.tenants.slug, [SLUG_A, SLUG_B]));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await db.delete(schema.roleCapabilities).where(inArray(schema.roleCapabilities.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    db = getDb();
    await cleanup();
    const [a] = await db.insert(schema.tenants).values({ name: "RoleCaps A", slug: SLUG_A }).returning({ id: schema.tenants.id });
    const [b] = await db.insert(schema.tenants).values({ name: "RoleCaps B", slug: SLUG_B }).returning({ id: schema.tenants.id });
    tenantA = a.id;
    tenantB = b.id;
    await db.insert(schema.users).values([
      { id: memberA, tenantId: tenantA, email: "m@rolecaps.test", role: "member" },
      { id: adminA, tenantId: tenantA, email: "a@rolecaps.test", role: "admin" },
    ]);
    // Tenant B configures its member tier generously; tenant A stays unconfigured.
    await db.insert(schema.roleCapabilities).values({ tenantId: tenantB, role: "member", capabilities: ["data.export", "runs.void"] });
    // A stray row for the admin tier of tenant A — must be inert (admin is locked-full).
    await db.insert(schema.roleCapabilities).values({ tenantId: tenantA, role: "admin", capabilities: ["leads.read"] });
  });

  afterAll(cleanup);

  it("F-6a: an UNCONFIGURED tenant's member resolves the code defaults — a sibling tenant's row never leaks", async () => {
    const row = await fetchRow(memberA);
    expect(row.storedCapabilities).toBeNull(); // tenant B's member row did NOT join across
    const scope = resolveScope({ id: memberA }, row);
    expect(scope.capabilities?.has("leads.write")).toBe(true); // default
    expect(scope.capabilities?.has("data.export")).toBe(false); // tenant B's grant stayed in B
  });

  it("F-6b: the tenant's own config row rides onto its member's scope once configured", async () => {
    await db.insert(schema.roleCapabilities).values({ tenantId: tenantA, role: "member", capabilities: ["data.export"] });
    const row = await fetchRow(memberA);
    expect(row.storedCapabilities).toEqual(["data.export"]);
    const scope = resolveScope({ id: memberA }, row);
    expect(scope.capabilities?.has("data.export")).toBe(true);
    expect(scope.capabilities?.has("leads.write")).toBe(false); // explicit row replaces defaults
    expect(scope.capabilities?.has("leads.read")).toBe(true); // always-on floor
  });

  it("F-6c: an admin joining a stray config row resolves with NO capabilities field (locked-full)", async () => {
    const row = await fetchRow(adminA);
    expect(row.storedCapabilities).toEqual(["leads.read"]); // the stray row joins…
    const scope = resolveScope({ id: adminA }, row);
    expect(scope.capabilities).toBeUndefined(); // …and is ignored by resolution
  });
});
