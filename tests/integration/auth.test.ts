import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as schema from "@/db/schema";
import { provisionAdmin, deprovisionAdmin } from "@/lib/auth/provision";
import { resolveScope } from "@/lib/scope-context";

// TST-12 (live): real Supabase Auth sign-in → scope resolution end-to-end. Needs
// the dev DB + a dev Supabase Auth project; self-skips when unconfigured (like the
// other integration suites) so the fast unit suite stays green.
const dbUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(dbUrl && supabaseUrl && anonKey && serviceKey);
const suite = configured ? describe : describe.skip;

const SLUG = "test-auth-iso";

suite("TST-12: Supabase Auth sign-in resolves to the correct scope", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let admin: SupabaseClient;
  const email = `admin-${randomUUID()}@auth-iso.test`;
  const password = `Iso-${randomUUID()}-Aa1!`;
  let tenantId = "";
  let userId = "";

  beforeAll(async () => {
    client = postgres(dbUrl!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    admin = createClient(supabaseUrl!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // Clean any leftover tenant from a prior aborted run.
    await db.delete(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const [t] = await db
      .insert(schema.tenants)
      .values({ name: "Auth Iso", slug: SLUG })
      .returning({ id: schema.tenants.id });
    tenantId = t.id;
    const res = await provisionAdmin(admin, db, { tenantId, email, password });
    userId = res.userId;
  });

  afterAll(async () => {
    if (userId) await deprovisionAdmin(admin, db, userId);
    if (tenantId) await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    await client.end();
  });

  it("provisions the auth user with tenant/role claims in app_metadata", async () => {
    const anon = createClient(supabaseUrl!, anonKey!);
    const { data, error } = await anon.auth.signInWithPassword({ email, password });
    expect(error).toBeNull();
    expect(data.user?.id).toBe(userId);
    expect(data.user?.app_metadata?.role).toBe("admin");
    expect(data.user?.app_metadata?.tenant_id).toBe(tenantId);
  });

  it("resolves the verified user to an admin scope for the right tenant", async () => {
    const [row] = await db
      .select({
        tenantId: schema.users.tenantId,
        role: schema.users.role,
        partnerId: schema.users.partnerId,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    const scope = resolveScope({ id: userId }, row ?? null);
    expect(scope).toEqual({ tenantId, role: "admin", userId });
  });

  it("rejects a wrong password (AUT-05: uniform failure at the SDK boundary)", async () => {
    const anon = createClient(supabaseUrl!, anonKey!);
    const { data, error } = await anon.auth.signInWithPassword({ email, password: "wrong-password-xyz" });
    expect(error).not.toBeNull();
    expect(data.session).toBeNull();
  });

  it("AUT-07: each sign-in mints a fresh session token (no fixation)", async () => {
    const r1 = await createClient(supabaseUrl!, anonKey!).auth.signInWithPassword({ email, password });
    const r2 = await createClient(supabaseUrl!, anonKey!).auth.signInWithPassword({ email, password });
    expect(r1.data.session?.access_token).toBeTruthy();
    expect(r2.data.session?.access_token).toBeTruthy();
    // A new token per authentication event — session identifiers are never reused
    // or accepted from the client.
    expect(r1.data.session?.access_token).not.toBe(r2.data.session?.access_token);
  });
});
