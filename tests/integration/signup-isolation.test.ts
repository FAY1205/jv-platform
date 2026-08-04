import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as schema from "@/db/schema";
import { provisionSignup } from "@/lib/auth/provision-signup";
import { tenantWhere } from "@/lib/scope";
import { purgeAuditLog } from "../helpers/audit";

// SCP-02: proves the security property the self-serve signup feature rests on —
// a tenant created via public signup is isolated from every other signup's data.
// Self-skips without DATABASE_URL (must NOT self-skip in this environment).
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

// Fake Supabase admin (mirrors provision-signup.test.ts): createUser returns a
// fresh uuid per call, records nothing else needed here; no real Supabase.
function makeFakeAdmin() {
  const admin = {
    auth: {
      admin: {
        createUser: async () => ({ data: { user: { id: randomUUID() } }, error: null }),
        deleteUser: async () => ({ data: {}, error: null }),
      },
    },
  };
  return admin as unknown as SupabaseClient;
}

suite("SCP-02: self-serve signup tenant isolation", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  const id: Record<string, string> = {};

  async function cleanup() {
    const tenantIds = [id.tenantA, id.tenantB].filter((v): v is string => Boolean(v));
    if (tenantIds.length === 0) return;
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tenantIds));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tenantIds));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tenantIds));
    // provisionSignup writes an append-only audit_log row per tenant (compliance F-2); its FK
    // blocks the tenant delete, so purge it via the deliberate escape hatch first.
    await purgeAuditLog(db, inArray(schema.auditLog.tenantId, tenantIds));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tenantIds));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });

    const admin = makeFakeAdmin();
    const emailA = `signup-iso-a-${randomUUID()}@example.com`;
    const emailB = `signup-iso-b-${randomUUID()}@example.com`;

    const a = await provisionSignup(admin, db, {
      email: emailA,
      password: "correct horse battery staple 1!",
      workspaceName: "Workspace A",
    });
    id.tenantA = a.tenantId;
    id.userA = a.userId;

    const b = await provisionSignup(admin, db, {
      email: emailB,
      password: "correct horse battery staple 1!",
      workspaceName: "Workspace B",
    });
    id.tenantB = b.tenantId;
    id.userB = b.userId;

    // Seed a lead in tenant A (mirrors activity.test.ts's upload → lead shape).
    const [upload] = await db
      .insert(schema.uploads)
      .values({ tenantId: id.tenantA, refId: "IM-26-901", filename: "signup-iso-a.xlsx", status: "processed" })
      .returning({ id: schema.uploads.id });
    id.uploadA = upload.id;

    const [lead] = await db
      .insert(schema.leads)
      .values({
        tenantId: id.tenantA,
        refId: "LD-26-90001",
        uploadId: upload.id,
        dedupeKey: "signup-iso|90001",
        rawJson: {},
        mlsStatus: "kept",
      })
      .returning({ id: schema.leads.id });
    id.leadA = lead.id;
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  it("SCP-02: a scoped query for tenant B never sees tenant A's lead", async () => {
    const rows = await db
      .select({ id: schema.leads.id })
      .from(schema.leads)
      .where(tenantWhere(schema.leads, { tenantId: id.tenantB, role: "admin", userId: id.userB }));
    expect(rows).toHaveLength(0);
  });

  it("SCP-02: a scoped query for tenant A sees exactly the one lead it created", async () => {
    const rows = await db
      .select({ id: schema.leads.id })
      .from(schema.leads)
      .where(tenantWhere(schema.leads, { tenantId: id.tenantA, role: "admin", userId: id.userA }));
    expect(rows.map((r) => r.id)).toEqual([id.leadA]);
  });

  it("SCP-02: a scoped users query for tenant B never sees tenant A's admin user", async () => {
    const rows = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(tenantWhere(schema.users, { tenantId: id.tenantB, role: "admin", userId: id.userB }));
    const got = rows.map((r) => r.id);
    expect(got).toEqual([id.userB]);
    expect(got).not.toContain(id.userA);
  });
});
