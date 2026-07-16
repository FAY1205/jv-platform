import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";
import { recentDevEmails, clearDevMailbox } from "@/modules/notify/dev-mailbox";
import { jsonRequest } from "./_route-harness";

// AUT-05/WP-SU-1: `after()` does not flush on a direct route invocation in a test — mock it to
// collect callbacks so the test can flush them explicitly, and prove the work is deferred.
const afterCallbacks: Array<() => unknown | Promise<unknown>> = [];
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (fn: () => unknown | Promise<unknown>) => { afterCallbacks.push(fn); } };
});
async function flushAfter() {
  const cbs = afterCallbacks.splice(0);
  for (const cb of cbs) await cb();
}

// AUT-05/ADR-0034/AUT-03 (live): the public signup endpoint ties turnstile
// (ADR-0034), rate-limiting (AUT-03), password strength (AUT-02), enumeration-safe
// timing (AUT-05), and provisioning (SCP-02/ADR-0033) together. Self-skips
// without DATABASE_URL (must NOT self-skip in this environment).
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

// verifyTurnstile is mocked so the test controls pass/fail without hitting
// Cloudflare; toggled per test via turnstileOk.
let turnstileOk = true;
vi.mock("@/lib/auth/turnstile", () => ({
  verifyTurnstile: vi.fn(async () => turnstileOk),
}));

// getSupabaseAdmin is mocked so no real Supabase auth user is ever created —
// createUser records its arg and returns a fresh uuid; deleteUser is a no-op
// recorder (the compensating-saga path in provisionSignup).
const createUserCalls: unknown[] = [];
const deleteUserCalls: string[] = [];
const fakeAdmin = {
  auth: {
    admin: {
      createUser: async (args: unknown) => {
        createUserCalls.push(args);
        return { data: { user: { id: randomUUID() } }, error: null };
      },
      deleteUser: async (userId: string) => {
        deleteUserCalls.push(userId);
        return { data: {}, error: null };
      },
    },
  },
};
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin: () => fakeAdmin }));

// Imported after the mocks are registered (Vitest hoists vi.mock above imports).
import { POST } from "@/app/api/auth/signup/route";

function strongPassword(): string {
  // Long, high-entropy passphrase — clears length(12)+zxcvbn(3); the breach
  // check (real HIBP lookup, fail-open) will not find this random suffix.
  return `Correct-Horse-${randomUUID()}-Battery-9!`;
}

suite("POST /api/auth/signup", () => {
  let db: ReturnType<typeof getDb>;
  const tenantIds: string[] = [];
  const userIds: string[] = [];
  const identifiersToClear: string[] = [];

  beforeAll(() => {
    db = getDb();
  });

  beforeEach(() => {
    turnstileOk = true;
    createUserCalls.length = 0;
    deleteUserCalls.length = 0;
    afterCallbacks.length = 0;
    clearDevMailbox();
  });

  afterAll(async () => {
    if (userIds.length) await db.delete(schema.signupVerifications).where(inArray(schema.signupVerifications.userId, userIds));
    if (userIds.length) await db.delete(schema.tosAcceptances).where(inArray(schema.tosAcceptances.userId, userIds));
    if (userIds.length) await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    // tenants provisioned via the happy-path test carry an append-only audit_log row
    // (ADR-0031: the trigger rejects DELETE) whose FK (ON DELETE no action) blocks deleting
    // the tenant itself too — both are intentionally left in place, as in production. The
    // "already-registered" test's PRE-INSERTED tenant (no audit_log row) has no such row and
    // could be deleted, but is left alongside the others for a single, simple cleanup story.
    if (identifiersToClear.length) {
      await db.delete(schema.authAttempts).where(inArray(schema.authAttempts.identifier, identifiersToClear));
    }
  });

  it("AUT-05: a new email returns 200 {code:signup_check_email} and provisions a tenant+admin + sends a verify email", async () => {
    const email = `signup-${randomUUID()}@example.test`;
    identifiersToClear.push(email.toLowerCase());
    const workspaceName = `Acme ${randomUUID().slice(0, 8)}`;

    const req = jsonRequest("POST", "/api/auth/signup", {
      email,
      password: strongPassword(),
      workspaceName,
      captchaToken: "captcha-token",
      tosAccepted: true,
    });
    const res = await POST(req);
    await flushAfter();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      code: "signup_check_email",
      message: "If that email can be used, we've sent a link to finish signing up.",
    });

    const userRows = await db
      .select()
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`);
    expect(userRows).toHaveLength(1);
    expect(userRows[0].role).toBe("admin");
    userIds.push(userRows[0].id);
    tenantIds.push(userRows[0].tenantId);

    const tenantRows = await db.select().from(schema.tenants).where(eq(schema.tenants.id, userRows[0].tenantId));
    expect(tenantRows).toHaveLength(1);
    expect(tenantRows[0].name).toBe(workspaceName);

    expect(createUserCalls).toHaveLength(1);

    const emails = recentDevEmails();
    const verifyEmail = emails.find((e) => e.kind === "signup_verify" && e.intendedTo.includes(email.toLowerCase()));
    expect(verifyEmail).toBeTruthy();
    expect(verifyEmail!.links.some((l) => l.includes("/signup/verify?token="))).toBe(true);
  });

  it("AUT-05: the heavy provisioning work is DEFERRED (not on the response path)", async () => {
    const email = `signup-${randomUUID()}@example.test`;
    identifiersToClear.push(email.toLowerCase());
    const workspaceName = `Acme ${randomUUID().slice(0, 8)}`;

    const req = jsonRequest("POST", "/api/auth/signup", {
      email,
      password: strongPassword(),
      workspaceName,
      captchaToken: "captcha-token",
      tosAccepted: true,
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      code: "signup_check_email",
      message: "If that email can be used, we've sent a link to finish signing up.",
    });

    // BEFORE flushing: no tenant/user row exists yet and no verify email has been sent —
    // proves the heavy provisioning work never ran on the response path.
    const userRowsBefore = await db
      .select()
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`);
    expect(userRowsBefore).toHaveLength(0);
    expect(
      recentDevEmails().find((e) => e.kind === "signup_verify" && e.intendedTo.includes(email.toLowerCase())),
    ).toBeUndefined();

    await flushAfter();

    const userRowsAfter = await db
      .select()
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`);
    expect(userRowsAfter).toHaveLength(1);
    userIds.push(userRowsAfter[0].id);
    tenantIds.push(userRowsAfter[0].tenantId);

    const tenantRows = await db.select().from(schema.tenants).where(eq(schema.tenants.id, userRowsAfter[0].tenantId));
    expect(tenantRows).toHaveLength(1);

    const verifyEmail = recentDevEmails().find(
      (e) => e.kind === "signup_verify" && e.intendedTo.includes(email.toLowerCase()),
    );
    expect(verifyEmail).toBeTruthy();
  });

  it("AUT-05: an already-registered email returns the IDENTICAL 200 envelope, creates NO new tenant, and sends an already_registered email", async () => {
    const email = `signup-${randomUUID()}@example.test`;
    identifiersToClear.push(email.toLowerCase());

    // Pre-insert an existing tenant + admin user with this email.
    const [t] = await db
      .insert(schema.tenants)
      .values({ name: `Existing ${randomUUID().slice(0, 8)}`, slug: `existing-${randomUUID()}` })
      .returning({ id: schema.tenants.id });
    tenantIds.push(t.id);
    const existingUserId = randomUUID();
    await db.insert(schema.users).values({ id: existingUserId, tenantId: t.id, email, role: "admin" });
    userIds.push(existingUserId);

    const tenantCountBefore = (await db.select({ id: schema.tenants.id }).from(schema.tenants)).length;

    const req = jsonRequest("POST", "/api/auth/signup", {
      email,
      password: strongPassword(),
      workspaceName: "Someone Else's Workspace",
      captchaToken: "captcha-token",
      tosAccepted: true,
    });
    const res = await POST(req);
    await flushAfter();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      code: "signup_check_email",
      message: "If that email can be used, we've sent a link to finish signing up.",
    });

    const tenantCountAfter = (await db.select({ id: schema.tenants.id }).from(schema.tenants)).length;
    expect(tenantCountAfter).toBe(tenantCountBefore);
    expect(createUserCalls).toHaveLength(0); // no provisioning attempted

    const emails = recentDevEmails();
    const alreadyEmail = emails.find((e) => e.kind === "already_registered" && e.intendedTo.includes(email.toLowerCase()));
    expect(alreadyEmail).toBeTruthy();
  });

  it("ADR-0034: a failed CAPTCHA returns 400 and does no provisioning", async () => {
    turnstileOk = false;
    const email = `signup-${randomUUID()}@example.test`;
    identifiersToClear.push(email.toLowerCase());

    const req = jsonRequest("POST", "/api/auth/signup", {
      email,
      password: strongPassword(),
      workspaceName: "Never Provisioned Co",
      captchaToken: "bad-token",
      tosAccepted: true,
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("captcha_failed");

    const userRows = await db
      .select()
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`);
    expect(userRows).toHaveLength(0);
    expect(createUserCalls).toHaveLength(0);
    expect(recentDevEmails()).toHaveLength(0);
  });

  it("AUT-03: signup is rate-limited", async () => {
    const email = `signup-${randomUUID()}@example.test`;
    identifiersToClear.push(email.toLowerCase());
    const attempts = new AuthAttemptsStore(db);
    // Drive the identifier past the lockout threshold (>4 failures locks — AUT-04).
    for (let i = 0; i < 5; i++) await attempts.record(email, null, "signup", false);

    const req = jsonRequest("POST", "/api/auth/signup", {
      email,
      password: strongPassword(),
      workspaceName: "Rate Limited Co",
      captchaToken: "captcha-token",
      tosAccepted: true,
    });
    const res = await POST(req);

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    const body = await res.json();
    expect(body.code).toBe("signup_check_email"); // uniform body even when throttled

    const userRows = await db
      .select()
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`);
    expect(userRows).toHaveLength(0);
    expect(createUserCalls).toHaveLength(0);
  });

  it("LGL-01: a missing tosAccepted returns 400 invalid_input and does no provisioning", async () => {
    const email = `signup-${randomUUID()}@example.test`;
    identifiersToClear.push(email.toLowerCase());

    const req = jsonRequest("POST", "/api/auth/signup", {
      email,
      password: strongPassword(),
      workspaceName: "No Consent Co",
      captchaToken: "captcha-token",
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_input");
    expect(createUserCalls).toHaveLength(0);
  });

  it("LGL-01: a false tosAccepted returns 400 invalid_input and does no provisioning", async () => {
    const email = `signup-${randomUUID()}@example.test`;
    identifiersToClear.push(email.toLowerCase());

    const req = jsonRequest("POST", "/api/auth/signup", {
      email,
      password: strongPassword(),
      workspaceName: "No Consent Co",
      captchaToken: "captcha-token",
      tosAccepted: false,
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_input");
    expect(createUserCalls).toHaveLength(0);
  });

  it("ADR-0034: returns 403 signup_disabled when the kill-switch is off", async () => {
    vi.resetModules();
    vi.doMock("@/lib/env", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/env")>();
      return { ...actual, isSignupEnabled: false };
    });
    try {
      const { POST: disabledPost } = await import("@/app/api/auth/signup/route");
      const email = `signup-${randomUUID()}@example.test`;
      identifiersToClear.push(email.toLowerCase());

      const req = jsonRequest("POST", "/api/auth/signup", {
        email,
        password: strongPassword(),
        workspaceName: "Disabled Co",
        captchaToken: "captcha-token",
        tosAccepted: true,
      });
      const res = await disabledPost(req);

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe("signup_disabled");
      expect(createUserCalls).toHaveLength(0);
    } finally {
      vi.doUnmock("@/lib/env");
      vi.resetModules();
    }
  });

  it("SEC-05: a provisioning failure logs the error via logError and still returns the uniform 200", async () => {
    vi.resetModules();
    const logErrorSpy = vi.fn();
    vi.doMock("@/lib/observability", () => ({ logError: logErrorSpy }));
    vi.doMock("@/lib/auth/provision-signup", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/auth/provision-signup")>();
      return {
        ...actual,
        provisionSignup: vi.fn(async () => {
          throw new Error("boom: provisioning exploded");
        }),
      };
    });
    try {
      const { POST: failingPost } = await import("@/app/api/auth/signup/route");
      const email = `signup-${randomUUID()}@example.test`;
      identifiersToClear.push(email.toLowerCase());

      const req = jsonRequest("POST", "/api/auth/signup", {
        email,
        password: strongPassword(),
        workspaceName: "Boom Co",
        captchaToken: "captcha-token",
        tosAccepted: true,
      });
      const res = await failingPost(req);
      await flushAfter();

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        code: "signup_check_email",
        message: "If that email can be used, we've sent a link to finish signing up.",
      });
      expect(logErrorSpy).toHaveBeenCalledWith(
        "signup_provision_failed",
        expect.objectContaining({ message: expect.stringContaining("boom: provisioning exploded") }),
      );

      const userRows = await db
        .select()
        .from(schema.users)
        .where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`);
      expect(userRows).toHaveLength(0);
    } finally {
      vi.doUnmock("@/lib/observability");
      vi.doUnmock("@/lib/auth/provision-signup");
      vi.resetModules();
    }
  });
});
