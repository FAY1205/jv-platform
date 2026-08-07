import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { detectProfile } from "@/modules/sources";
import { LEAD_SOURCE_1_PROFILE } from "@/modules/sources/seed-profiles";
import { loadProfilesForDetection, findProfileById } from "@/modules/sources/profile-store";
import type { ScopeContext } from "@/lib/scope";

// WP-032b-2 / ADR-0039: DB-backed format detection (ING-02/08). The in-app remap/confirm
// flow was retired (a new format is added in code, not remapped at runtime), but detection is
// KEPT — a changed file is still surfaced loudly, never silently re-guessed.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-drift-wp032b2";

suite("WP-032b-2 / ADR-0039: DB-backed format detection (ING-02/08)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let scope: ScopeContext;

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
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

  it("ING-08: a renamed mapped column is detected as drift against the DB-loaded seed — never silently re-guessed", async () => {
    // The CRM renames a mapped column week-to-week: the real drift path, off the LIVE seed.
    const notesHeader = LEAD_SOURCE_1_PROFILE.mapping.notes!;
    const drifted = LEAD_SOURCE_1_PROFILE.headerSignature.map((h) => (h === notesHeader ? "Lead Notes" : h));

    const profiles = await loadProfilesForDetection(db, scope);
    const d = detectProfile(drifted, profiles);
    expect(d.status).toBe("drift");
    expect(d.profile?.name).toBe("Lead Source 1");
    expect(d.diff?.added).toContain("lead notes"); // the new column is surfaced (normalized)
  });

  it("ING-02: an unrelated file detects as unknown — it does not masquerade as Lead Source 1", async () => {
    const profiles = await loadProfilesForDetection(db, scope);
    expect(detectProfile(["Deal Zip", "Deal State", "Deal Address", "Seller"], profiles).status).toBe("unknown");
  });

  it("findProfileById resolves a seed slug (not a uuid) without a DB type error", async () => {
    // Still used by the template-download route (/api/templates/[id]) after ADR-0039.
    expect((await findProfileById(db, scope, "lead-source-1"))?.name).toBe("Lead Source 1");
    expect(await findProfileById(db, scope, "not-a-uuid")).toBeNull();
  });
});
