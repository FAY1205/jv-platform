import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { requireTosResponse, needsTosGate } from "@/lib/auth/tos-guard";
import { recordTosAcceptance } from "@/lib/auth/tos-store";
import { CURRENT_TOS_VERSION } from "@/lib/legal/tos";
import type { ScopeContext } from "@/lib/scope";

// LGL-01 (WP-SU-5a): the ToS gate exempted EVERY admin — correct while admins were only
// ever provisioned by the owner's script, and wrong the moment a stranger can self-register
// as one. Self-serve admins accept at signup, so the gate only bites after a version bump;
// owner/script-provisioned tenants have no acceptance record at all and MUST stay exempt,
// or a version bump would lock the owner out of their own app.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG_SELF = "test-tos-self-serve";
const SLUG_OWNER = "test-tos-owner-provisioned";

suite("LGL-01: admin ToS gate applies to self-serve tenants only", () => {
  let db: ReturnType<typeof getDb>;
  const ids: string[] = [];
  const userIds: string[] = [];

  // partnerId is optional on ScopeContext and only required for the partner path, which
  // this guard reaches before it ever dereferences it.
  const scopeFor = (tenantId: string, userId: string, role: "admin" | "partner"): ScopeContext => ({
    tenantId,
    userId,
    role,
  });

  async function seedTenant(slug: string, selfServe: boolean) {
    const [t] = await db
      .insert(schema.tenants)
      .values({ name: slug, slug, selfServe })
      .returning({ id: schema.tenants.id });
    const userId = randomUUID();
    await db.insert(schema.users).values({
      id: userId,
      tenantId: t!.id,
      email: `${slug}-${userId.slice(0, 8)}@example.test`,
      role: "admin",
    });
    ids.push(t!.id);
    userIds.push(userId);
    return { tenantId: t!.id, userId };
  }

  async function cleanup() {
    if (userIds.length) await db.delete(schema.tosAcceptances).where(inArray(schema.tosAcceptances.userId, userIds));
    if (ids.length) {
      await db.delete(schema.users).where(inArray(schema.users.tenantId, ids));
      await db.delete(schema.tenants).where(inArray(schema.tenants.id, ids));
    }
  }

  beforeAll(async () => {
    db = getDb();
    // Pre-clean every slug the suite creates, including the derived ones — otherwise a run
    // killed before afterAll leaves rows that make the next run fail on the slug unique
    // index with a confusing error instead of self-healing.
    await db.delete(schema.tenants).where(
      inArray(schema.tenants.slug, [
        SLUG_SELF,
        SLUG_OWNER,
        `${SLUG_SELF}-stale`,
        `${SLUG_SELF}-notes`,
        `${SLUG_SELF}-agree`,
        `${SLUG_OWNER}-agree`,
        `${SLUG_OWNER}-partner`,
      ]),
    );
  });

  afterAll(cleanup);

  it("LGL-01: an owner/script-provisioned admin with NO acceptance record stays exempt", async () => {
    // The lockout case. self_serve=false is the default for every pre-existing tenant.
    const { tenantId, userId } = await seedTenant(SLUG_OWNER, false);
    expect(await requireTosResponse(db, scopeFor(tenantId, userId, "admin"))).toBeNull();
  });

  it("LGL-01: a self-serve admin who has NOT accepted the current version is refused 403", async () => {
    const { tenantId, userId } = await seedTenant(SLUG_SELF, true);
    const res = await requireTosResponse(db, scopeFor(tenantId, userId, "admin"));
    expect(res?.status).toBe(403);
    expect((await res!.json()).code).toBe("tos_required");
  });

  it("LGL-01: the same admin passes once the current version is accepted", async () => {
    const tenant = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG_SELF));
    const user = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.tenantId, tenant[0]!.id));
    await recordTosAcceptance(db, user[0]!.id, CURRENT_TOS_VERSION);
    expect(await requireTosResponse(db, scopeFor(tenant[0]!.id, user[0]!.id, "admin"))).toBeNull();
  });

  it("LGL-01: a stale acceptance re-gates the self-serve admin after a version bump", async () => {
    const { tenantId, userId } = await seedTenant(`${SLUG_SELF}-stale`, true);
    ids.push(tenantId);
    await recordTosAcceptance(db, userId, "1999-01-01"); // an older version
    const res = await requireTosResponse(db, scopeFor(tenantId, userId, "admin"));
    expect(res?.status).toBe(403);
  });

  it("LGL-01: the gate is NOT inert — it already fires on the shared admin notes route", async () => {
    // The notes routes are shared admin+partner surfaces and already call the guard, so a
    // self-serve admin with a stale acceptance loses the admin Notes panel the moment
    // CURRENT_TOS_VERSION is bumped. Verified here rather than assumed — an earlier status
    // report of mine claimed this path was inert, and it was not.
    const { tenantId, userId } = await seedTenant(`${SLUG_SELF}-notes`, true);
    ids.push(tenantId);
    await recordTosAcceptance(db, userId, "1999-01-01");
    const res = await requireTosResponse(db, scopeFor(tenantId, userId, "admin"));
    expect(res?.status).toBe(403);
    expect((await res!.json()).code).toBe("tos_required");
  });

  it("LGL-01: the page gate and the API guard agree — one predicate, two surfaces", async () => {
    // /dashboard's server layout redirects on needsTosGate; the data routes 403 on
    // requireTosResponse. If those ever disagreed, an admin could be bounced to /tos by a
    // page while the API still served them (or worse, the reverse — a redirect loop).
    const gated = await seedTenant(`${SLUG_SELF}-agree`, true);
    ids.push(gated.tenantId);
    const gatedScope = scopeFor(gated.tenantId, gated.userId, "admin");
    expect(await needsTosGate(db, gatedScope)).toBe(true);
    expect((await requireTosResponse(db, gatedScope))?.status).toBe(403);

    const exempt = await seedTenant(`${SLUG_OWNER}-agree`, false);
    ids.push(exempt.tenantId);
    const exemptScope = scopeFor(exempt.tenantId, exempt.userId, "admin");
    expect(await needsTosGate(db, exemptScope)).toBe(false);
    expect(await requireTosResponse(db, exemptScope)).toBeNull();
  });

  it("LGL-01: partners are gated regardless of how their tenant was created", async () => {
    const { tenantId, userId } = await seedTenant(`${SLUG_OWNER}-partner`, false);
    ids.push(tenantId);
    const res = await requireTosResponse(db, scopeFor(tenantId, userId, "partner"));
    expect(res?.status).toBe(403); // unchanged behaviour — the partner path must not regress
  });
});
