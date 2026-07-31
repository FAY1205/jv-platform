import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as schema from "@/db/schema";
import { provisionAdmin, deprovisionAdmin } from "@/lib/auth/provision";
import { clearDevMailbox, recentDevEmails } from "@/modules/notify/dev-mailbox";
import { nextHeadersMock, routeCookieJar } from "./_route-harness";

// WP-SU-16 F-2 (live): the admin login route is PRE-SESSION — it builds a Supabase server client via
// getSupabaseServer() → next/headers cookies(), which throws outside an App-Router request. The
// reusable harness seam supplies that cookie store so we can drive the real route over HTTP and
// prove AUT-04 end-to-end: N concurrent wrong-password logins at the tripping attempt email the
// owner EXACTLY once (login's claimLockoutNotice("login") de-dup, mirroring the otp/verify test).
// Needs the dev DB + a dev Supabase Auth project; self-skips when unconfigured (read the counts).
vi.mock("next/headers", () => nextHeadersMock());

const dbUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(dbUrl && supabaseUrl && anonKey && serviceKey);
const suite = configured ? describe : describe.skip;

const ORIGIN = "http://localhost";
function post(body: unknown): Request {
  // requireToken:false — the login route needs only an Origin matching the request URL's origin.
  return new Request(`${ORIGIN}/api/auth/login`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

suite("AUT-04: admin login lockout notifies the account owner (HTTP, concurrent)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let admin: SupabaseClient;
  let login: (req: Request) => Promise<Response>;
  const SLUG = `login-lock-${randomUUID().slice(0, 8)}`;
  const email = `admin-${randomUUID()}@wp-su-16-login.test`;
  const victim = email.toLowerCase();
  const password = `Lk-${randomUUID()}-Aa1!`;
  let tenantId = "";
  let userId = "";

  beforeAll(async () => {
    client = postgres(dbUrl!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    admin = createClient(supabaseUrl!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await db.delete(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const [t] = await db
      .insert(schema.tenants)
      .values({ name: "Login Lock", slug: SLUG })
      .returning({ id: schema.tenants.id });
    tenantId = t.id;
    ({ userId } = await provisionAdmin(admin, db, { tenantId, email, password }));
    // Import AFTER the next/headers mock is in place (vi.mock is hoisted, so this is belt-and-braces).
    ({ POST: login } = await import("@/app/api/auth/login/route"));
  });

  afterAll(async () => {
    await db.delete(schema.authAttempts).where(eq(schema.authAttempts.identifier, victim));
    await db.execute(sql`delete from notice_claims where identifier = ${victim}`).catch(() => {});
    if (userId) await deprovisionAdmin(admin, db, userId);
    if (tenantId) await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    await client.end();
  });

  beforeEach(() => {
    clearDevMailbox();
    routeCookieJar.clear();
  });
  afterEach(async () => {
    await db.delete(schema.authAttempts).where(eq(schema.authAttempts.identifier, victim));
    await db.execute(sql`delete from notice_claims where identifier = ${victim}`).catch(() => {});
    clearDevMailbox();
  });

  const lockoutMailsTo = (e: string): number =>
    recentDevEmails(200).filter((m) => m.kind === "lockout" && m.intendedTo.includes(e)).length;

  it("AUT-04: N concurrent wrong-password logins at the tripping attempt email the owner exactly once", async () => {
    // Prime 4 prior credential failures, back-dated ~6min so they sit OUTSIDE the 5-min login rate
    // window but INSIDE the 1h lockout window: they count 4 toward `failures` (so the burst trips the
    // lock) without spending the 8/5min rate budget (so the burst isn't 429'd at the gate and races).
    const staleFailedAt = new Date(Date.now() - 6 * 60_000);
    await db.insert(schema.authAttempts).values(
      Array.from({ length: 4 }, () => ({
        identifier: victim,
        ip: null,
        kind: "login",
        success: false,
        createdAt: staleFailedAt,
      })),
    );

    // 6 simultaneous wrong-password logins. Each real sign-in fails → the 5th failure trips the lock.
    // Before WP-SU-16 each racer would read the same pre-settle failures===4 and email the owner; the
    // atomic claimLockoutNotice("login") must collapse them to exactly one owner mail.
    const burst = await Promise.all(
      Array.from({ length: 6 }, () => login(post({ email, password: `wrong-${randomUUID()}` }))),
    );
    // Precondition guarding a THROTTLE regression (not the claim race itself): assert ≥2 racers
    // reached the credential-check branch (401) rather than the lockout gate (429), so a future
    // tightening that 429'd the burst can't silently turn this into a non-race. The atomic de-dup is
    // proven by the exactly-1 assertion below + the bypass-goes-red TDD validation (6 emails).
    expect(burst.filter((r) => r.status === 401).length).toBeGreaterThanOrEqual(2);
    expect(lockoutMailsTo(victim)).toBe(1);
  });
});
