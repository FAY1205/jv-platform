import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { purgeAuditLog } from "../helpers/audit";
import { detectProfile } from "@/modules/sources";
import { INVESTORFUSE_PROFILE } from "@/modules/sources/seed-profiles";
import { suggestMapping, buildConfirmedProfile } from "@/modules/sources/mapping";
import { loadProfilesForDetection, saveProfileVersion, findProfileById } from "@/modules/sources/profile-store";
import type { ScopeContext } from "@/lib/scope";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-drift-wp032b2";

suite("WP-032b-2: format drift + versioned profiles (ING-02/08, DM-08)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let scope: ScopeContext;

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await purgeAuditLog(db, inArray(schema.auditLog.tenantId, tids));
    for (const tbl of [schema.sourceProfiles]) await db.delete(tbl).where(inArray(tbl.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Drift", slug: SLUG }).returning({ id: schema.tenants.id });
    scope = { tenantId: t.id, role: "admin", userId: randomUUID() };
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  it("ING-08/DM-08: a confirmed drift saves a new version; the same file then matches EXACTLY", async () => {
    const zipHeader = INVESTORFUSE_PROFILE.mapping.zip!;
    const drifted = INVESTORFUSE_PROFILE.headerSignature.map((h) => (h === zipHeader ? "Property Postal Code" : h));

    // Before confirming: detection sees drift against the seed.
    const before = await loadProfilesForDetection(db, scope);
    const d0 = detectProfile(drifted, before);
    expect(d0.status).toBe("drift");
    expect(d0.profile?.name).toBe("InvestorFuse");

    // Suggested mapping follows the rename, then we confirm → save v2.
    const mapping = suggestMapping(d0.profile ?? null, drifted);
    expect(mapping.zip).toBe("Property Postal Code");
    const v2 = buildConfirmedProfile({ base: d0.profile!, name: d0.profile!.name, uploadHeaders: drifted, mapping, strictness: "flexible" });
    expect(v2.version).toBe(INVESTORFUSE_PROFILE.version + 1);
    await saveProfileVersion(db, scope, v2);

    // After: the saved v2 replaces the seed for that name, and the file matches exactly.
    const after = await loadProfilesForDetection(db, scope);
    expect(after.filter((p) => p.name === "InvestorFuse")).toHaveLength(1); // v2 only
    const d1 = detectProfile(drifted, after);
    expect(d1.status).toBe("exact");
    expect(d1.profile?.version).toBe(2);

    const audits = await db.select().from(schema.auditLog).where(eq(schema.auditLog.tenantId, scope.tenantId));
    expect(audits.some((a) => a.action === "source_profile.saved")).toBe(true);
  });

  it("findProfileById resolves a seed slug (not a uuid) without a DB type error", async () => {
    expect((await findProfileById(db, scope, "investorfuse"))?.name).toBe("InvestorFuse");
    expect(await findProfileById(db, scope, "not-a-uuid")).toBeNull();
  });

  it("ING-02: a brand-new file is mapped from scratch, saved, and then matches exactly", async () => {
    const headers = ["Deal Zip", "Deal State", "Deal Address", "Seller"];
    const before = await loadProfilesForDetection(db, scope);
    expect(detectProfile(headers, before).status).toBe("unknown");

    const mapping = { zip: "Deal Zip", state: "Deal State", address: "Deal Address" };
    const profile = buildConfirmedProfile({ base: null, name: "Acme CRM", uploadHeaders: headers, mapping, strictness: "flexible" });
    expect(profile.version).toBe(1);
    await saveProfileVersion(db, scope, profile);

    const after = await loadProfilesForDetection(db, scope);
    const d = detectProfile(headers, after);
    expect(d.status).toBe("exact");
    expect(d.profile?.name).toBe("Acme CRM");
  });
});
