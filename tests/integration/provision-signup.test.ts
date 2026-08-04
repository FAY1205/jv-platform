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

      // WP-SU-21: the ingestion config is seeded in the SAME provisioning transaction, so a
      // self-serve tenant can import leads immediately. The Lead Source 1 profile must carry its
      // transform (skip-trace strip + address/ZIP derivation).
      const profileRows = await db.select().from(schema.sourceProfiles).where(eq(schema.sourceProfiles.tenantId, tenantId));
      expect(profileRows.some((p) => p.name === "Lead Source 1" && p.transform === "lead-source-1")).toBe(true);
      const patternRows = await db.select().from(schema.mlsPatterns).where(eq(schema.mlsPatterns.tenantId, tenantId));
      expect(patternRows.length).toBeGreaterThanOrEqual(1);
    } finally {
      // audit_log is append-only (DB trigger rejects DELETE, ADR-0031), and audit_log.tenant_id
      // is a hard FK (ON DELETE no action) — so once a tenant has an audit_log row, the tenant
      // row itself can never be hard-deleted either. Both are intentionally left in place here,
      // same as they would be in production. Only the deletable rows are cleaned up.
      await db.delete(schema.sourceProfiles).where(eq(schema.sourceProfiles.tenantId, tenantId));
      await db.delete(schema.mlsPatterns).where(eq(schema.mlsPatterns.tenantId, tenantId));
      await db.delete(schema.settings).where(eq(schema.settings.tenantId, tenantId));
      await db.delete(schema.featureFlags).where(eq(schema.featureFlags.tenantId, tenantId));
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

  it("SCP-02 (WP-SU-7): a slug UNIQUE violation is retried, not surfaced as a failed signup", async () => {
    // The real gap is the RACE, not a pre-existing slug: the clash check is read-then-insert,
    // so two concurrent signups for the same workspace name both see "no clash" and the
    // second violates tenants.slug UNIQUE at INSERT time. Squatting the base slug does NOT
    // reproduce that (the check catches it and suffixes) — the conflict has to come from the
    // insert itself, so it is injected here. Without a retry this throws, fires the
    // compensating auth-user delete, and the user sees a generic failure.
    const { admin, deleteUserCalls } = makeFakeAdmin();
    const insertedSlugs: string[] = [];
    let attempts = 0;
    const pgUnique = Object.assign(new Error("duplicate key value violates unique constraint"), {
      cause: { code: "23505", constraint_name: "tenants_slug_unique" },
    });
    const stubDb = {
      select: () => ({ from: () => ({ where: async () => [] }) }), // clash check finds nothing
      transaction: async (fn: (tx: unknown) => Promise<void>) => {
        attempts += 1;
        if (attempts === 1) throw pgUnique; // the concurrent insert won the race
        // values() is awaited directly at some call sites and chained with
        // .onConflictDoNothing() at others (recordTosAcceptance) — so return a thenable
        // that also carries the chain method. Values are CAPTURED, not discarded: without
        // that, deleting the fresh-suffix regeneration still passes, and the retry would
        // re-insert the identical slug forever against a real DB.
        const chain = (v: unknown) => {
          if (v && typeof v === "object" && "slug" in v) insertedSlugs.push((v as { slug: string }).slug);
          return Object.assign(Promise.resolve(undefined), {
            onConflictDoNothing: () => Promise.resolve(undefined),
          });
        };
        await fn({ insert: () => ({ values: chain }) });
      },
    } as unknown as PostgresJsDatabase<typeof schema>;

    const result = await provisionSignup(admin, stubDb, {
      email: `race-${randomUUID()}@example.com`,
      password: "correct horse battery staple 1!",
      workspaceName: "Race Realty",
    });

    expect(attempts).toBe(2); // retried rather than giving up
    expect(result.tenantId).toBeTruthy();
    expect(deleteUserCalls).toHaveLength(0); // the auth user survives — no compensation needed
    // The retry must use a DIFFERENT slug: re-inserting the same one would conflict forever.
    expect(insertedSlugs).toHaveLength(1); // attempt 1 threw before its insert landed
    expect(insertedSlugs[0]).not.toBe("race-realty");
    expect(insertedSlugs[0].startsWith("race-realty-")).toBe(true);
  });

  it("SCP-02 (WP-SU-7): retries are BOUNDED — persistent collisions give up and compensate", async () => {
    const { admin, createdUserIds, deleteUserCalls } = makeFakeAdmin();
    let attempts = 0;
    const slugConflict = Object.assign(new Error("duplicate key"), {
      cause: { code: "23505", constraint_name: "tenants_slug_unique" },
    });
    const stubDb = {
      select: () => ({ from: () => ({ where: async () => [] }) }),
      transaction: async () => {
        attempts += 1;
        throw slugConflict; // never resolves
      },
    } as unknown as PostgresJsDatabase<typeof schema>;

    await expect(
      provisionSignup(admin, stubDb, {
        email: `bounded-${randomUUID()}@example.com`,
        password: "correct horse battery staple 1!",
        workspaceName: "Bounded Realty",
      }),
    ).rejects.toThrow();

    expect(attempts).toBe(3); // SLUG_RETRIES, not an unbounded loop
    expect(deleteUserCalls).toEqual([createdUserIds[0]]); // still compensates
  });

  it("SCP-02 (WP-SU-7): a DIFFERENT unique violation is rethrown at once, never retried", async () => {
    // Retrying a non-slug conflict would mask a real bug behind 3 pointless transactions.
    const { admin, createdUserIds, deleteUserCalls } = makeFakeAdmin();
    let attempts = 0;
    const emailConflict = Object.assign(new Error("duplicate key"), {
      cause: { code: "23505", constraint_name: "users_tenant_email_idx" },
    });
    const stubDb = {
      select: () => ({ from: () => ({ where: async () => [] }) }),
      transaction: async () => {
        attempts += 1;
        throw emailConflict;
      },
    } as unknown as PostgresJsDatabase<typeof schema>;

    await expect(
      provisionSignup(admin, stubDb, {
        email: `other-${randomUUID()}@example.com`,
        password: "correct horse battery staple 1!",
        workspaceName: "Other Realty",
      }),
    ).rejects.toThrow();

    expect(attempts).toBe(1); // no retry
    expect(deleteUserCalls).toEqual([createdUserIds[0]]);
  });

  it("SCP-02 (WP-SU-7): a real tenants.slug 23505 has the {cause:{code,constraint_name}} shape the retry matches on", async () => {
    // The retry's correctness rests on drizzle wrapping the postgres error exactly one level
    // deep. A version bump that adds a layer would make the matcher miss, silently reverting
    // to the old always-fail behaviour — and the stub-driven test above would still pass.
    // This pins the real driver contract against the live DB.
    const slug = `pin-${randomUUID().slice(0, 8)}`;
    const first = randomUUID();
    await db.insert(schema.tenants).values({ id: first, name: "Pin", slug });
    try {
      await expect(
        db.insert(schema.tenants).values({ id: randomUUID(), name: "Pin2", slug }),
      ).rejects.toMatchObject({ cause: { code: "23505", constraint_name: expect.stringContaining("slug") } });
    } finally {
      await db.delete(schema.tenants).where(eq(schema.tenants.id, first));
    }
  });
});
