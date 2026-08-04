import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { purgeAuditLog } from "../helpers/audit";
import { applyProfile, LEAD_SOURCE_1_PROFILE } from "@/modules/sources";
import { loadProfilesForDetection, saveProfileVersion } from "@/modules/sources/profile-store";
import type { ScopeContext } from "@/lib/scope";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-ls1-profile";

// ─────────────────────────────────────────────────────────────────────────────
// WP-LS1 — the transform seam must survive a ROUND-TRIP THROUGH THE DATABASE.
//
// Why this test exists: detection prefers the tenant's SAVED profile rows over the
// code seeds. If `transform` doesn't persist, a saved "Lead Source 1" row loads back
// WITHOUT its transform, applyProfile silently skips derivation, and every lead
// ingests with no address, no seller name, and un-stripped skip-trace notes — a
// silent SEC-05 + PRN-03 failure that no pure unit test would ever catch.
// ─────────────────────────────────────────────────────────────────────────────

suite("WP-LS1: the profile transform survives the DB round-trip (SEAM, DM-08)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let scope: ScopeContext;

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await purgeAuditLog(db, inArray(schema.auditLog.tenantId, tids));
    await db.delete(schema.sourceProfiles).where(inArray(schema.sourceProfiles.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "LS1", slug: SLUG }).returning({ id: schema.tenants.id });
    scope = { tenantId: t.id, role: "admin", userId: randomUUID() };
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  it("SEAM: a saved profile loads back WITH its transform name", async () => {
    await saveProfileVersion(db, scope, LEAD_SOURCE_1_PROFILE);
    const loaded = await loadProfilesForDetection(db, scope);
    const ls1 = loaded.find((p) => p.name === "Lead Source 1");
    expect(ls1).toBeDefined();
    expect(ls1!.transform).toBe("lead-source-1");
  });

  it("SEAM: applyProfile with the DB-loaded profile still derives every field", async () => {
    const loaded = await loadProfilesForDetection(db, scope);
    const ls1 = loaded.find((p) => p.name === "Lead Source 1")!;

    // Sanitized row (SEC-05): invented PII, real structure.
    const row = {
      "Contact Name": "Dana Fake",
      phone: "5555550100",
      email: "dana@example.invalid",
      source: "Campaign Alpha",
      "Created on": "2026-07-07T17:30:37.714Z",
      "Property Address": "12 Invented St, Houston TX 77021",
      Notes: "Listed? No\n\nReason For Selling: Quick sale\n\nSkip Trace Phones: mobile, 5555559999 [DNC]\n\nHow Soon to Sell: ASAP",
    };

    const { canonical } = applyProfile(row, ls1);
    expect(canonical.sellerFirst).toBe("Dana");
    expect(canonical.address).toBe("12 Invented St");
    expect(canonical.zip).toBe("77021");
    expect(canonical.dateCreated).toBe("2026-07-07");
    // SEC-05: the strip must still happen on the DB-loaded path.
    expect(canonical.notes).not.toContain("Skip Trace");
    expect(canonical.notes).not.toContain("[DNC]");
  });
});
