import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type * as EnumModule from "@/lib/auth/enumeration";
import type { SessionEstablishResult } from "@/lib/auth/otp-session";
import * as schema from "@/db/schema";
import { hashOtp } from "@/lib/auth/otp";
import { TrustedDeviceService } from "@/lib/auth/trusted-device";
import { TRUST_COOKIE_NAME } from "@/lib/supabase/cookie-options";

// C-34 (SEC-09): otp/verify and trust/refresh answer a session-mint failure by mapping
// establishSessionForEmail's tri-state — "unavailable" ⇒ 503 + Retry-After (a transient, retryable
// auth-backend outage, mirroring login/change-password), "failed" ⇒ 500. Both run AFTER the
// code/token is validated, so the distinct status is account-independent. This drives the REAL routes
// against the DB with only establishSessionForEmail mocked, so the mapping is proven end to end.

const session = vi.hoisted(() => ({ result: "unavailable" as SessionEstablishResult }));
vi.mock("@/lib/auth/otp-session", () => ({
  establishSessionForEmail: vi.fn(async () => ({ status: session.result, detail: "test-detail" })),
}));

// Skip otp/verify's real timing-floor sleep (deterministic; the floor math is unit-proven elsewhere).
vi.mock("@/lib/auth/enumeration", async (orig) => {
  const actual = await orig<typeof EnumModule>();
  return { ...actual, withUniformTiming: vi.fn(async (_min: number, work: () => Promise<unknown>) => work()) };
});

// trust/refresh reads + rotates the trust cookie via next/headers.
const cookieState = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => {
      const v = cookieState.store.get(n);
      return v === undefined ? undefined : { name: n, value: v };
    },
    set: (n: string, v: string, o?: { maxAge?: number }) => {
      if (o?.maxAge === 0 || v === "") cookieState.store.delete(n);
      else cookieState.store.set(n, v);
    },
  }),
}));

const { POST: otpVerify } = await import("@/app/api/auth/otp/verify/route");
const { POST: trustRefresh } = await import("@/app/api/auth/trust/refresh/route");

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const ORIGIN = "http://localhost";
const SLUG = "test-session-availability";

function post(path: string, body?: unknown): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

suite("C-34/SEC-09: auth session-mint availability mapping", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let tenantId: string;
  const emails = new Set<string>();

  async function cleanup() {
    for (const e of emails) {
      await db.delete(schema.authAttempts).where(eq(schema.authAttempts.identifier, e));
      await db.delete(schema.otpChallenges).where(eq(schema.otpChallenges.identifier, e));
    }
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length) {
      // trust_refresh auth_attempts are keyed by familyId (uuid); drop them via the tenant's families.
      const fams = await db.select({ familyId: schema.trustedDevices.familyId }).from(schema.trustedDevices).where(inArray(schema.trustedDevices.tenantId, tids));
      const famIds = fams.map((f) => f.familyId);
      if (famIds.length) await db.delete(schema.authAttempts).where(inArray(schema.authAttempts.identifier, famIds));
      await db.delete(schema.trustedDevices).where(inArray(schema.trustedDevices.tenantId, tids));
      await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
      await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
    }
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Session Avail", slug: SLUG }).returning({ id: schema.tenants.id });
    tenantId = t.id;
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  beforeEach(() => {
    cookieState.store.clear();
  });

  // ── otp/verify ──────────────────────────────────────────────────────────────
  const PEPPER = "test-pepper";
  const CODE = "123456";
  async function seedChallenge(email: string) {
    emails.add(email.toLowerCase());
    await db.insert(schema.otpChallenges).values({
      identifier: email.toLowerCase(),
      codeHash: hashOtp(CODE, PEPPER),
      pepper: PEPPER,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
  }

  it("otp/verify: a transient session-mint outage ('unavailable') is a 503 + Retry-After (not 500)", async () => {
    const email = `otp-unavail-${randomUUID()}@avail.test`;
    await seedChallenge(email);
    session.result = "unavailable";
    const res = await otpVerify(post("/api/auth/otp/verify", { email, code: CODE }));
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
    expect(await res.json()).toMatchObject({ code: "session_unavailable" });
    // The code was NOT consumed — an immediate retry can reuse it.
    const [c] = await db.select().from(schema.otpChallenges).where(eq(schema.otpChallenges.identifier, email.toLowerCase()));
    expect(c.consumedAt).toBeNull();
  });

  it("otp/verify: a clean-but-unusable session response ('failed') stays a 500", async () => {
    const email = `otp-failed-${randomUUID()}@avail.test`;
    await seedChallenge(email);
    session.result = "failed";
    const res = await otpVerify(post("/api/auth/otp/verify", { email, code: CODE }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "session_failed" });
  });

  // ── trust/refresh ─────────────────────────────────────────────────────────────
  async function issueTrust(): Promise<string> {
    const userId = randomUUID();
    await db.insert(schema.users).values({ id: userId, tenantId, email: `trust-${userId}@avail.test`, role: "partner" });
    const { token } = await new TrustedDeviceService(db).issue(
      { tenantId, userId, partnerId: null, deviceLabel: null, ip: null },
      Date.now(),
    );
    return token;
  }

  it("trust/refresh: a transient session-mint outage ('unavailable') is a 503 + Retry-After", async () => {
    cookieState.store.set(TRUST_COOKIE_NAME, await issueTrust());
    session.result = "unavailable";
    const res = await trustRefresh(post("/api/auth/trust/refresh"));
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
    expect(await res.json()).toMatchObject({ code: "session_unavailable" });
  });

  it("trust/refresh: a clean-but-unusable session response ('failed') stays a 500", async () => {
    cookieState.store.set(TRUST_COOKIE_NAME, await issueTrust());
    session.result = "failed";
    const res = await trustRefresh(post("/api/auth/trust/refresh"));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "session_failed" });
  });
});
