import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as schema from "@/db/schema";
import { provisionSignup } from "@/lib/auth/provision-signup";
import { CURRENT_TOS_VERSION } from "@/lib/legal/tos";

// SCP-02 (ADR-0033): tenant + admin-user provisioning as a compensating saga —
// the auth user is created first (unconfirmed), then tenant+user land in one DB
// transaction; any DB failure deletes the auth user so no orphan survives.
// Self-skips without DATABASE_URL (must NOT self-skip in this environment).
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

// Records createUser/deleteUser calls; returns a fresh uuid per createUser call
// so each test gets its own userId without a real Supabase project.
function makeFakeAdmin() {
  const createUserCalls: unknown[] = [];
  const createdUserIds: string[] = [];
  const deleteUserCalls: string[] = [];
  const admin = {
    auth: {
      admin: {
        createUser: async (args: unknown) => {
          createUserCalls.push(args);
          const id = randomUUID();
          createdUserIds.push(id);
          return { data: { user: { id } }, error: null };
        },
        deleteUser: async (userId: string) => {
          deleteUserCalls.push(userId);
          return { data: {}, error: null };
        },
      },
    },
  };
  return { admin: admin as unknown as SupabaseClient, createUserCalls, createdUserIds, deleteUserCalls };
}

suite("SCP-02: provisionSignup", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
  });
  afterAll(async () => {
    await client.end();
  });

  it("SCP-02: happy path creates an unconfirmed auth user, a tenant, and an admin user", async () => {
    const { admin, createUserCalls } = makeFakeAdmin();
    const email = `signup-${randomUUID()}@example.com`;

    const { userId, tenantId } = await provisionSignup(admin, db, {
      email,
      password: "correct horse battery staple 1!",
      workspaceName: "Acme Realty",
    });

    try {
      const tenantRows = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
      expect(tenantRows).toHaveLength(1);
      expect(tenantRows[0].name).toBe("Acme Realty");
      expect(tenantRows[0].slug).toBeTruthy();
      // LGL-01 (WP-SU-5): marks the tenant as publicly self-registered, which is what makes
      // its admin subject to ToS re-acceptance. Without this the gate never applies to anyone.
      expect(tenantRows[0].selfServe).toBe(true);

      const userRows = await db.select().from(schema.users).where(eq(schema.users.id, userId));
      expect(userRows).toHaveLength(1);
      expect(userRows[0].id).toBe(userId);
      expect(userRows[0].role).toBe("admin");
      expect(userRows[0].tenantId).toBe(tenantId);

      expect(createUserCalls).toHaveLength(1);
      const arg = createUserCalls[0] as {
        email_confirm: boolean;
        app_metadata: { role: string; tenant_id: string };
      };
      expect(arg.email_confirm).toBe(false);
      expect(arg.app_metadata.role).toBe("admin");
      expect(arg.app_metadata.tenant_id).toBe(tenantId);

      const auditRows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.tenantId, tenantId));
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].action).toBe("tenant.signup_provisioned");
      expect(auditRows[0].actorUserId).toBe(userId);

      const tosRows = await db.select().from(schema.tosAcceptances).where(eq(schema.tosAcceptances.userId, userId));
      expect(tosRows).toHaveLength(1);
      expect(tosRows[0].version).toBe(CURRENT_TOS_VERSION);
    } finally {
      // audit_log is append-only (DB trigger rejects DELETE, ADR-0031), and audit_log.tenant_id
      // is a hard FK (ON DELETE no action) — so once a tenant has an audit_log row, the tenant
      // row itself can never be hard-deleted either. Both are intentionally left in place here,
      // same as they would be in production. Only the deletable rows are cleaned up.
      await db.delete(schema.tosAcceptances).where(eq(schema.tosAcceptances.userId, userId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
  });

  it("SCP-02: compensates by deleting the auth user when the DB transaction fails", async () => {
    const { admin, createdUserIds, deleteUserCalls } = makeFakeAdmin();
    const stubDb = {
      select: () => ({ from: () => ({ where: async () => [] }) }),
      transaction: async () => {
        throw new Error("db down");
      },
    } as unknown as PostgresJsDatabase<typeof schema>;

    await expect(
      provisionSignup(admin, stubDb, {
        email: `signup-${randomUUID()}@example.com`,
        password: "correct horse battery staple 1!",
        workspaceName: "Beta Realty",
      }),
    ).rejects.toThrow();

    expect(createdUserIds).toHaveLength(1);
    expect(deleteUserCalls).toHaveLength(1);
    expect(deleteUserCalls[0]).toBe(createdUserIds[0]);
  });
});
