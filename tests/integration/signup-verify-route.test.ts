import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { SignupStore } from "@/lib/auth/signup-store";
import { issueSignupToken } from "@/lib/auth/signup-token";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";
import { jsonRequest } from "./_route-harness";

// SCP-02/ADR-0033 (live): the signup email-verification endpoint consumes a
// single-use token and activates the Supabase auth user (email_confirm:true).
// Self-skips without DATABASE_URL (must NOT self-skip in this environment).
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

// getSupabaseAdmin is mocked so no real Supabase call happens — updateUserById
// records its args and returns success by default.
const updateUserByIdCalls: Array<{ userId: string; attrs: unknown }> = [];
const fakeAdmin = {
  auth: {
    admin: {
      updateUserById: async (userId: string, attrs: unknown) => {
        updateUserByIdCalls.push({ userId, attrs });
        return { error: null };
      },
    },
  },
};
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin: () => fakeAdmin }));

// Imported after the mock is registered (Vitest hoists vi.mock above imports).
import { POST } from "@/app/api/auth/signup/verify/route";

suite("POST /api/auth/signup/verify", () => {
  let db: ReturnType<typeof getDb>;
  const userIds: string[] = [];

  const ipsToClear: string[] = [];

  beforeAll(() => {
    db = getDb();
  });

  beforeEach(() => {
    updateUserByIdCalls.length = 0;
  });

  afterAll(async () => {
    if (userIds.length) {
      await db.delete(schema.signupVerifications).where(inArray(schema.signupVerifications.userId, userIds));
    }
    if (ipsToClear.length) {
      await db.delete(schema.authAttempts).where(inArray(schema.authAttempts.ip, ipsToClear));
    }
  });

  it("SCP-02: a valid token returns 200 {code:signup_verified}, calls updateUserById(userId,{email_confirm:true}), and activates only once", async () => {
    const userId = randomUUID();
    userIds.push(userId);
    const store = new SignupStore(getDb());
    const { token, record } = issueSignupToken(userId, Date.now());
    await store.persist(record);

    const req = jsonRequest("POST", "/api/auth/signup/verify", { token });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe("signup_verified");

    expect(updateUserByIdCalls).toHaveLength(1);
    expect(updateUserByIdCalls[0].userId).toBe(userId);
    expect(updateUserByIdCalls[0].attrs).toEqual({ email_confirm: true });

    // WP-B: a second POST with the same (now-consumed) token is a double-click / refresh, not a
    // failure. It returns the benign already-verified response — and crucially does NOT re-activate
    // (updateUserById is still called exactly once), so single-use activation is preserved.
    const req2 = jsonRequest("POST", "/api/auth/signup/verify", { token });
    const res2 = await POST(req2);
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.code).toBe("signup_already_verified");
    expect(updateUserByIdCalls).toHaveLength(1); // never activated twice
  });

  it("SCP-02: an unknown token returns 400", async () => {
    const req = jsonRequest("POST", "/api/auth/signup/verify", { token: `unknown-${randomUUID()}-token-value` });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("signup_verify_invalid");
    expect(updateUserByIdCalls).toHaveLength(0);
  });

  it("SCP-02: an expired token returns 400", async () => {
    const userId = randomUUID();
    userIds.push(userId);
    const store = new SignupStore(getDb());
    const past = Date.now() - 1000 * 60 * 60 * 48; // 48h ago, well past 24h TTL
    const { token, record } = issueSignupToken(userId, past);
    await store.persist(record);

    const req = jsonRequest("POST", "/api/auth/signup/verify", { token });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("signup_verify_invalid");
    expect(updateUserByIdCalls).toHaveLength(0);
  });
  it("AUT-03: the verify endpoint is rate-limited per IP (token guessing / DB load)", async () => {
    // The only credential endpoint that had no throttle. Token entropy (32 random bytes)
    // makes guessing infeasible, so this caps DB + Auth-API load and restores the
    // "every credential endpoint wires a throttle kind" invariant.
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    const attempts = new AuthAttemptsStore(getDb());
    ipsToClear.push(ip);
    for (let i = 0; i < 25; i++) await attempts.record("verify", ip, "signup_verify", false);

    const req = jsonRequest("POST", "/api/auth/signup/verify", { token: "a".repeat(43) });
    req.headers.set("x-vercel-forwarded-for", ip);
    const res = await POST(req);

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });
});
