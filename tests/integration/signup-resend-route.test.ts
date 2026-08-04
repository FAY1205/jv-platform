import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";
import { jsonRequest } from "./_route-harness";

// WP-B (SCP-02/AUT-05): resend the signup verification email. Enumeration-safe — uniform
// response whether or not a pending signup exists — and a new link is rotated + emailed ONLY
// for an account that exists and is still unconfirmed. Self-skips without DATABASE_URL.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

// getUserById is driven per-test via `confirmedById`: absent id ⇒ user missing; value ⇒ that
// email_confirmed_at (undefined = unconfirmed). notifySignupVerify is mocked to record sends.
let confirmedById: Map<string, string | undefined>;
const fakeAdmin = {
  auth: {
    admin: {
      getUserById: async (id: string) => {
        if (!confirmedById.has(id)) return { data: { user: null }, error: { message: "not found" } };
        return { data: { user: { id, email_confirmed_at: confirmedById.get(id) } }, error: null };
      },
    },
  },
};
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin: () => fakeAdmin }));

const verifySends: Array<{ email: string; link: string }> = [];
vi.mock("@/lib/auth/notify", () => ({
  notifySignupVerify: async (email: string, link: string) => {
    verifySends.push({ email, link });
  },
}));

// Imported after the mocks are registered (Vitest hoists vi.mock above imports).
import { POST } from "@/app/api/auth/signup/resend/route";

suite("POST /api/auth/signup/resend", () => {
  let db: ReturnType<typeof getDb>;
  const tenantIds: string[] = [];
  const userIds: string[] = [];
  const ipsToClear: string[] = [];
  const emailsToClear: string[] = [];

  beforeAll(() => {
    db = getDb();
  });

  beforeEach(() => {
    confirmedById = new Map();
    verifySends.length = 0;
  });

  afterAll(async () => {
    if (userIds.length) {
      await db.delete(schema.signupVerifications).where(inArray(schema.signupVerifications.userId, userIds));
      await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    }
    if (tenantIds.length) await db.delete(schema.tenants).where(inArray(schema.tenants.id, tenantIds));
    if (ipsToClear.length) await db.delete(schema.authAttempts).where(inArray(schema.authAttempts.ip, ipsToClear));
    if (emailsToClear.length)
      await db.delete(schema.authAttempts).where(inArray(schema.authAttempts.identifier, emailsToClear));
  });

  async function seedUser(confirmed: boolean): Promise<{ email: string; userId: string }> {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const email = `resend-${userId.slice(0, 8)}@example.com`;
    tenantIds.push(tenantId);
    userIds.push(userId);
    emailsToClear.push(email);
    await db.insert(schema.tenants).values({ id: tenantId, name: email, slug: `resend-${userId.slice(0, 8)}` });
    await db.insert(schema.users).values({ id: userId, tenantId, email, role: "admin" });
    confirmedById.set(userId, confirmed ? new Date().toISOString() : undefined);
    return { email, userId };
  }

  it("WP-B: an unconfirmed pending signup gets a rotated token + a verification email (200 uniform)", async () => {
    const { email, userId } = await seedUser(false);

    const res = await POST(jsonRequest("POST", "/api/auth/signup/resend", { email }));
    expect(res.status).toBe(200);
    expect((await res.json()).code).toBe("signup_resend_check_email");

    expect(verifySends).toHaveLength(1);
    expect(verifySends[0].email).toBe(email);
    expect(verifySends[0].link).toContain("/signup/verify?token=");

    // Exactly one (freshly rotated) verification row now exists for the user.
    const rows = await db.select().from(schema.signupVerifications).where(eq(schema.signupVerifications.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0].usedAt).toBeNull();
  });

  it("WP-B: an already-confirmed account gets the SAME uniform 200 but NO email and NO token", async () => {
    const { email, userId } = await seedUser(true);

    const res = await POST(jsonRequest("POST", "/api/auth/signup/resend", { email }));
    expect(res.status).toBe(200);
    expect((await res.json()).code).toBe("signup_resend_check_email");

    expect(verifySends).toHaveLength(0);
    const rows = await db.select().from(schema.signupVerifications).where(eq(schema.signupVerifications.userId, userId));
    expect(rows).toHaveLength(0);
  });

  it("AUT-05: an unknown email gets the SAME uniform 200 and sends nothing", async () => {
    const email = `nobody-${randomUUID().slice(0, 8)}@example.com`;
    emailsToClear.push(email);

    const res = await POST(jsonRequest("POST", "/api/auth/signup/resend", { email }));
    expect(res.status).toBe(200);
    expect((await res.json()).code).toBe("signup_resend_check_email");
    expect(verifySends).toHaveLength(0);
  });

  it("AUT-03: resend is rate-limited per IP", async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    ipsToClear.push(ip);
    const attempts = new AuthAttemptsStore(getDb());
    for (let i = 0; i < 25; i++) await attempts.record(`r-${i}@example.com`, ip, "signup_resend", true);

    const req = jsonRequest("POST", "/api/auth/signup/resend", { email: "someone@example.com" });
    req.headers.set("x-vercel-forwarded-for", ip);
    const res = await POST(req);

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });
});
