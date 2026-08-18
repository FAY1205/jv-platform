import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { sha256Hex } from "@/lib/auth/hash";
import { TrustedDeviceService } from "@/lib/auth/trusted-device";
import { sweepTrustedDevices, trustedDevicesCutoff } from "@/modules/retention/auth-tables";

// WP-SU-14: the sweep predicate is SQL, proven against the real trusted_devices table.
// Self-skips without DATABASE_URL (must NOT self-skip in this environment — read the counts).
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-su14-ret";
const DAY = 24 * 3_600_000;

suite("WP-SU-14: canary-safe trusted_devices retention", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let svc: TrustedDeviceService;
  const userId = randomUUID();
  let tenantId = "";
  const now = new Date();
  void trustedDevicesCutoff(now); // cutoff derivation is unit-tested; kept in scope for clarity

  // Insert a raw row directly so we can pin expiresAt / rotatedTo precisely (the service refuses to
  // rotate an expired head, so a live-family-with-old-rotated-row can't be built through it alone).
  async function row(
    familyId: string,
    token: string,
    opts: { expiresAt: Date; rotatedTo: string | null; issuedAt?: Date },
  ) {
    const id = randomUUID();
    await db.insert(schema.trustedDevices).values({
      id,
      familyId,
      tenantId,
      userId,
      partnerId: null,
      tokenHash: sha256Hex(token),
      deviceLabel: "UA",
      ip: "1.2.3.4",
      issuedAt: opts.issuedAt ?? new Date(now.getTime() - 40 * DAY),
      expiresAt: opts.expiresAt,
      lastSeenAt: opts.issuedAt ?? new Date(now.getTime() - 40 * DAY),
      rotatedTo: opts.rotatedTo,
      revokedAt: null,
    });
    return id;
  }
  const familyRows = (familyId: string) =>
    db
      .select({ id: schema.trustedDevices.id })
      .from(schema.trustedDevices)
      .where(eq(schema.trustedDevices.familyId, familyId));

  // Family fixtures.
  const active = randomUUID();
  const activeOldToken = "active-old-tok";
  const dead = randomUUID();
  const deadOldToken = "dead-old-tok";
  const margin = randomUUID();

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    svc = new TrustedDeviceService(db);
    await db.delete(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const [t] = await db
      .insert(schema.tenants)
      .values({ name: "SU14 Ret", slug: SLUG })
      .returning({ id: schema.tenants.id });
    tenantId = t.id;
    await db
      .insert(schema.users)
      .values({ id: userId, tenantId, email: "su14@ret.test", role: "admin" });

    // ACTIVE family: an OLD rotated canary (expiresAt past cutoff) + a LIVE head (expiresAt future).
    await row(active, activeOldToken, { expiresAt: new Date(now.getTime() - 10 * DAY), rotatedTo: randomUUID() });
    await row(active, "active-head-tok", {
      expiresAt: new Date(now.getTime() + 20 * DAY),
      rotatedTo: null,
      issuedAt: new Date(now.getTime() - 1 * DAY),
    });

    // DEAD family: an old rotated row + an expired head, BOTH past cutoff. No live head.
    await row(dead, deadOldToken, { expiresAt: new Date(now.getTime() - 10 * DAY), rotatedTo: randomUUID() });
    await row(dead, "dead-head-tok", { expiresAt: new Date(now.getTime() - 8 * DAY), rotatedTo: null });

    // DEAD-BUT-WITHIN-MARGIN family: dead (head expired) but both rows still inside the 7d margin.
    await row(margin, "margin-old-tok", { expiresAt: new Date(now.getTime() - 5 * DAY), rotatedTo: randomUUID() });
    await row(margin, "margin-head-tok", { expiresAt: new Date(now.getTime() - 3 * DAY), rotatedTo: null });
  });

  afterAll(async () => {
    await db.delete(schema.trustedDevices).where(inArray(schema.trustedDevices.familyId, [active, dead, margin]));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    await client.end();
  });

  // NOTE ordering: this test's rotate() call revokes the ACTIVE family as a side effect (that IS the
  // behaviour under test), so later tests in this file run additional sweeps that then prune its
  // now-dead old rotated row. IDEM-01's before/after counts hold regardless; keep declaration order.
  it("AUT-10-DEV-CANARY-01: an ACTIVE family's old rotated canary SURVIVES a sweep and still triggers reuse_revoked", async () => {
    await sweepTrustedDevices(db, { now });
    // The old rotated row is past its own cutoff, but its family has a live head → preserved.
    expect((await familyRows(active)).length).toBe(2);
    // And the canary still fires: replaying the leaked old token revokes the family (AUT-10 intact).
    const reuse = await svc.rotate(activeOldToken, now.getTime(), "1.2.3.4");
    expect(reuse.result.status).toBe("reuse_revoked");
  });

  it("AUT-10-DEV-DEAD-01: a FULLY-DEAD family past the margin is pruned (abandoned IP dropped)", async () => {
    await sweepTrustedDevices(db, { now });
    expect((await familyRows(dead)).length).toBe(0);
    // Residual (ADR-0035): the leaked old token of a dead+pruned family now reads as invalid.
    const gone = await svc.rotate(deadOldToken, now.getTime(), "1.2.3.4");
    expect(gone.result.status).toBe("invalid");
  });

  it("AUT-10-DEV-MARGIN-01: a just-dead family within the 7d margin is NOT pruned (canary grace window)", async () => {
    await sweepTrustedDevices(db, { now });
    expect((await familyRows(margin)).length).toBe(2);
  });

  it("AUT-10-DEV-IDEM-01: a second sweep at the same instant removes none of the survivors", async () => {
    const before = (await familyRows(active)).length + (await familyRows(margin)).length;
    await sweepTrustedDevices(db, { now });
    const after = (await familyRows(active)).length + (await familyRows(margin)).length;
    expect(after).toBe(before);
  });
});
