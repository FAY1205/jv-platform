import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { TrustedDeviceService } from "@/lib/auth/trusted-device";
import { TRUST_COOKIE_NAME } from "@/lib/supabase/cookie-options";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/lib/auth/csrf-token";

// AUT-14 (live): signing out must ALSO revoke the trusted-device ("remember this device")
// credential — the long-lived cookie AND the DB family. Without it, a partner who checked
// "remember this device" is bounced straight back in: the portal login page auto-POSTs
// /api/auth/trust/refresh on mount, and a surviving trust credential re-mints a session
// (the "sign out doesn't work" bug). This proves logout closes that credential too.
//
// The route reads the trust cookie via next/headers and signs out via the Supabase server
// client, so both are mocked; the trusted_devices revoke goes through the real getDb() (env
// DATABASE_URL), so the suite self-skips without a DB like the other auth integration tests.

const cookieState = vi.hoisted(() => ({
  store: new Map<string, string>(),
  sets: [] as { name: string; value: string; options?: { maxAge?: number } }[],
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => {
      const v = cookieState.store.get(n);
      return v === undefined ? undefined : { name: n, value: v };
    },
    set: (n: string, v: string, o?: { maxAge?: number }) => {
      cookieState.sets.push({ name: n, value: v, options: o });
      if (o?.maxAge === 0 || v === "") cookieState.store.delete(n);
      else cookieState.store.set(n, v);
    },
    getAll: () => [...cookieState.store].map(([name, value]) => ({ name, value })),
  }),
}));

const signOut = vi.hoisted(() => vi.fn(async () => ({ error: null })));
const authUser = vi.hoisted(() => ({ id: "" })); // set to the seeded user id in beforeAll
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: async () => ({
    auth: {
      signOut,
      getUser: async () => ({ data: { user: { id: authUser.id } }, error: null }),
    },
  }),
}));

const { POST: logout } = await import("@/app/api/auth/logout/route");

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

const ORIGIN = "http://localhost";
const CSRF = "csrf-token-fixed";

function post(scope: "local" | "others" | "global"): Request {
  return new Request(`${ORIGIN}/api/auth/logout`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      cookie: `${CSRF_COOKIE_NAME}=${CSRF}`,
      [CSRF_HEADER_NAME]: CSRF,
    },
    body: JSON.stringify({ scope }),
  });
}

const SLUG = "test-logout-trust";

suite("AUT-14: logout revokes the trusted-device credential", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  const id: Record<string, string> = {};

  async function cleanup() {
    const tenants = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(inArray(schema.tenants.slug, [SLUG]));
    const tids = tenants.map((t) => t.id);
    if (tids.length === 0) return;
    await db.delete(schema.trustedDevices).where(inArray(schema.trustedDevices.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Logout Trust", slug: SLUG }).returning({ id: schema.tenants.id });
    id.tenant = t.id;
    id.user = randomUUID();
    authUser.id = id.user; // the mocked Supabase session resolves to this seeded user
    await db.insert(schema.users).values({ id: id.user, tenantId: t.id, email: "trust@logout.test", role: "partner" });
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  beforeEach(() => {
    cookieState.store.clear();
    cookieState.sets.length = 0;
    signOut.mockClear();
  });

  async function issueTrust(): Promise<string> {
    const svc = new TrustedDeviceService(db);
    const { token } = await svc.issue({ tenantId: id.tenant, userId: id.user, partnerId: null, deviceLabel: null, ip: null }, Date.now());
    return token;
  }

  function activeFamilies(): Promise<{ familyId: string }[]> {
    return db
      .select({ familyId: schema.trustedDevices.familyId })
      .from(schema.trustedDevices)
      .where(and(eq(schema.trustedDevices.userId, id.user), isNull(schema.trustedDevices.revokedAt)));
  }

  it("local sign-out revokes THIS device's family and clears the trust cookie", async () => {
    const token = await issueTrust();
    cookieState.store.set(TRUST_COOKIE_NAME, token);

    const res = await logout(post("local"));
    expect(res.status).toBe(200);

    // The DB family is revoked (a surviving trust token can no longer refresh a session).
    expect(await activeFamilies()).toHaveLength(0);
    // The cookie is cleared (maxAge 0 or emptied) — the login auto-refresh sees nothing.
    expect(cookieState.sets.some((s) => s.name === TRUST_COOKIE_NAME && (s.options?.maxAge === 0 || s.value === ""))).toBe(true);
    // Supabase session revocation still happens with the requested scope.
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("global sign-out revokes ALL of the user's remembered devices", async () => {
    await issueTrust(); // a second remembered device, not the one on this browser
    const token = await issueTrust();
    cookieState.store.set(TRUST_COOKIE_NAME, token);
    expect((await activeFamilies()).length).toBeGreaterThanOrEqual(2);

    const res = await logout(post("global"));
    expect(res.status).toBe(200);
    expect(await activeFamilies()).toHaveLength(0);
    expect(signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("a sign-out with no trusted device on this browser still succeeds", async () => {
    const res = await logout(post("local"));
    expect(res.status).toBe(200);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
