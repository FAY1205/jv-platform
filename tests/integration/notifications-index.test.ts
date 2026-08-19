import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";

// WP-NF1 D1 (NTF-04): the notification bell's read path is indexed for the predicate it
// actually uses — (tenant_id, user_id), never user_id alone (ownerWhere, lib/scope.ts). An
// index migration is invisible at the application layer: nothing fails if it silently never
// applied (the drizzle `when` trap has bitten this repo before — see 0036/0037), so the shape
// is asserted against the live catalog rather than assumed from the migration file.
//
// Own file, so this parked Tier-A PR carries its proof without touching a suite that ships
// separately. Self-skips without DATABASE_URL, like the rest of the integration tier.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("NTF-04 / DM-13: notifications bell-read indexes (migration 0055)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let byName: Map<string, string>;

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    const rows = await db.execute<{ indexname: string; indexdef: string }>(sql`
      select indexname, indexdef from pg_indexes where tablename = 'notifications'
    `);
    byName = new Map(rows.map((r) => [r.indexname, r.indexdef]));
  });

  afterAll(async () => {
    await client.end();
  });

  it("NTF-04: the list index covers (tenant_id, user_id, created_at DESC) — the exact read shape", async () => {
    const def = byName.get("notifications_tenant_user_created_idx");
    expect(def, "notifications_tenant_user_created_idx exists").toBeDefined();
    // Column ORDER is the whole point: tenant and user are the equality pins, created_at is the
    // sort. A (user_id, tenant_id, …) index would serve the same query far worse.
    expect(def).toMatch(/\(tenant_id,\s*user_id,\s*created_at DESC/i);
    // Not partial — the list shows read AND unread rows.
    expect(def).not.toMatch(/WHERE/i);
  });

  it("NTF-04: the unread-count index is PARTIAL on read_at IS NULL", async () => {
    const def = byName.get("notifications_tenant_user_unread_idx");
    expect(def, "notifications_tenant_user_unread_idx exists").toBeDefined();
    expect(def).toMatch(/\(tenant_id,\s*user_id\)/i);
    // The partial predicate is what keeps the badge count proportional to the unread minority
    // rather than to everything the user has ever been sent.
    expect(def).toMatch(/WHERE\s*\(?read_at IS NULL/i);
  });

  it("DM-13: the superseded user-only index is GONE (not left shadowing the composite)", async () => {
    expect(byName.has("notifications_user_idx")).toBe(false);
    // The indexes that must survive: the tenant FK cover and the C-36 redaction lookup.
    expect(byName.has("notifications_tenant_idx"), "tenant FK-covering index").toBe(true);
    expect(byName.has("notifications_tenant_lead_ref_idx"), "C-36 redaction lookup index").toBe(true);
  });
});
