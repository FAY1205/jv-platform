import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { TrustedDeviceService } from "@/lib/auth/trusted-device";

// AUT-10 (live): rotating trusted-device families with reuse detection, over the
// real trusted_devices table. Self-skips without DATABASE_URL.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

const SLUG = "test-trust-iso";

suite("AUT-10: trusted-device rotation + reuse detection", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let svc: TrustedDeviceService;
  const userId = randomUUID();
  let tenantId = "";

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    // id/family_id are uuid columns → use the default UUID id generator.
    svc = new TrustedDeviceService(db);
    await db.delete(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const [t] = await db.insert(schema.tenants).values({ name: "Trust Iso", slug: SLUG }).returning({ id: schema.tenants.id });
    tenantId = t.id;
    await db.insert(schema.users).values({ id: userId, tenantId, email: "trust@iso.test", role: "admin" });
  });

  afterAll(async () => {
    await db.delete(schema.trustedDevices).where(eq(schema.trustedDevices.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    await client.end();
  });

  const ctx = () => ({ tenantId, userId, partnerId: null, deviceLabel: "Test UA", ip: "1.2.3.4" });

  it("issues a family, then rotates the token on refresh", async () => {
    const now = Date.now();
    const { token: t1 } = await svc.issue(ctx(), now);
    const r = await svc.rotate(t1, now + 1000, "1.2.3.4");
    expect(r.result.status).toBe("rotated");
    expect(r.email).toBe("trust@iso.test");
    if (r.result.status === "rotated") expect(r.result.token).toBeTruthy();
  });

  it("detects reuse of a rotated token and revokes the whole family", async () => {
    const now = Date.now();
    const { token: t1, familyId } = await svc.issue(ctx(), now);
    const first = await svc.rotate(t1, now + 1000, "1.2.3.4"); // t1 -> t2
    expect(first.result.status).toBe("rotated");
    const t2 = first.result.status === "rotated" ? first.result.token : "";

    // Re-presenting the already-rotated t1 = leaked token → revoke the family.
    const reuse = await svc.rotate(t1, now + 2000, "1.2.3.4");
    expect(reuse.result.status).toBe("reuse_revoked");

    // The successor t2 is now dead too (family revoked).
    const afterRevoke = await svc.rotate(t2, now + 3000, "1.2.3.4");
    expect(afterRevoke.result.status).toBe("invalid");

    const rows = await db.select().from(schema.trustedDevices).where(eq(schema.trustedDevices.familyId, familyId));
    expect(rows.every((r) => r.revokedAt != null)).toBe(true);
  });

  it("rejects an unknown token", async () => {
    const r = await svc.rotate("not-a-real-token", Date.now(), null);
    expect(r.result.status).toBe("invalid");
  });
});
