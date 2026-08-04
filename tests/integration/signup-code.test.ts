import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as schema from "@/db/schema";
import { provisionSignup, SignupCodeConsumedError } from "@/lib/auth/provision-signup";
import { SignupCodeStore } from "@/lib/auth/signup-code-store";
import { issueSignupCode, hashCode } from "@/lib/auth/signup-code";

// SCP-03: invitation code lifecycle + single-use consumption inside provisioning.
// Self-skips without DATABASE_URL.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG_PREFIX = "test-scp03";

function makeFakeAdmin() {
  const createdUserIds: string[] = [];
  const deleteUserCalls: string[] = [];
  const admin = {
    auth: {
      admin: {
        createUser: async () => {
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
  return { admin: admin as unknown as SupabaseClient, createdUserIds, deleteUserCalls };
}

suite("SCP-03: signup invitation codes", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let store: SignupCodeStore;
  const now = Date.now();

  // Best-effort: audit_log is append-only (ADR-0031), so a provisioned tenant can't be
  // fully deleted — accept that pollution (the suite uses unique slugs/emails per run) and
  // only tidy what deletes cleanly. Never throws, so beforeAll can't fail on it.
  async function cleanup() {
    try {
      await db.delete(schema.signupCodes).where(eq(schema.signupCodes.createdBy, "owner@test.scp03"));
      const tenants = await db.select({ id: schema.tenants.id, slug: schema.tenants.slug }).from(schema.tenants);
      const ids = tenants.filter((x) => x.slug.startsWith(SLUG_PREFIX)).map((x) => x.id);
      for (const id of ids) {
        try {
          await db.delete(schema.mlsPatterns).where(eq(schema.mlsPatterns.tenantId, id));
          await db.delete(schema.sourceProfiles).where(eq(schema.sourceProfiles.tenantId, id));
          await db.delete(schema.settings).where(eq(schema.settings.tenantId, id));
          await db.delete(schema.users).where(eq(schema.users.tenantId, id));
          await db.delete(schema.tenants).where(eq(schema.tenants.id, id));
        } catch {
          /* audit_log FK / immutability — leave it */
        }
      }
    } catch {
      /* best-effort */
    }
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    store = new SignupCodeStore(db);
    await cleanup();
  });
  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  it("persists only the hash, finds it, and lists it as active", async () => {
    const { code, record } = issueSignupCode(now);
    const { id } = await store.persist(record, "owner@test.scp03");
    const found = await store.findByHash(hashCode(code));
    expect(found?.id).toBe(id);
    const active = await store.listActive(now);
    expect(active.some((c) => c.id === id && c.createdBy === "owner@test.scp03")).toBe(true);
    // The row never holds the plaintext.
    const [row] = await db.select().from(schema.signupCodes).where(eq(schema.signupCodes.id, id));
    expect(row.codeHash).not.toContain(code.replace(/-/g, ""));
  });

  it("provisioning consumes the code atomically, and a second use fails + compensates", async () => {
    const { record } = issueSignupCode(now);
    const { id: codeId } = await store.persist(record, "owner@test.scp03");
    const admin = makeFakeAdmin();
    const { tenantId } = await provisionSignup(admin.admin, db, {
      email: `a-${randomUUID()}@test.scp03`,
      password: "correct horse battery staple 9",
      workspaceName: `${SLUG_PREFIX} alpha`,
      signupCodeId: codeId,
    });
    const [afterUse] = await db.select().from(schema.signupCodes).where(eq(schema.signupCodes.id, codeId));
    expect(afterUse.usedAt).not.toBeNull();
    expect(afterUse.usedByTenantId).toBe(tenantId);
    // It no longer appears as active.
    expect((await store.listActive(now)).some((c) => c.id === codeId)).toBe(false);

    // Re-using the burned code fails and compensates (auth user deleted, no new tenant).
    const admin2 = makeFakeAdmin();
    await expect(
      provisionSignup(admin2.admin, db, {
        email: `b-${randomUUID()}@test.scp03`,
        password: "correct horse battery staple 9",
        workspaceName: `${SLUG_PREFIX} beta`,
        signupCodeId: codeId,
      }),
    ).rejects.toBeInstanceOf(SignupCodeConsumedError);
    expect(admin2.deleteUserCalls).toHaveLength(1); // compensated → the tenant+users tx rolled back
  });

  it("revoke marks an unused code used so it can never redeem", async () => {
    const { record } = issueSignupCode(now);
    const { id } = await store.persist(record, "owner@test.scp03");
    await store.revoke(id);
    const [row] = await db.select().from(schema.signupCodes).where(eq(schema.signupCodes.id, id));
    expect(row.usedAt).not.toBeNull();
    expect((await store.listActive(now)).some((c) => c.id === id)).toBe(false);
  });
});
