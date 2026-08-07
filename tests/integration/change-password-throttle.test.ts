import { describe, it, expect, vi, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { CHANGE_PASSWORD_THROTTLE } from "@/lib/auth/throttle";
import type * as ScopeContextModule from "@/lib/scope-context";
import { adminScope, jsonRequest, scopeContextMock, setRouteScope } from "./_route-harness";

// WP-SU-22 / AUT-03 (audit R-30): change-password was the one credential endpoint with NO throttle
// — a session-holder could brute-force the CURRENT password unmetered. This drives the REAL route +
// throttle store against the DB and proves the reserve -> snapshot -> 429 wiring, keyed on the
// caller's own email. Supabase auth is mocked (getUser gives the email; signInWithPassword returns
// an error, so admitted calls are 401 reauth_failed — the re-auth never reaches a live backend).
// Self-skips without DATABASE_URL.
const MOCK_EMAIL = "admin@changepw.test";
vi.mock("@/lib/scope-context", async (orig) => scopeContextMock(await orig<typeof ScopeContextModule>()));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { email: MOCK_EMAIL } }, error: null }),
      signInWithPassword: async () => ({ error: { message: "invalid" } }), // wrong current password
      updateUser: async () => ({ error: null }),
    },
  }),
}));

const { POST } = await import("@/app/api/auth/change-password/route");

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const KIND = "change_password";

suite("POST /api/auth/change-password — throttle (WP-SU-22)", () => {
  const db = getDb();

  afterEach(async () => {
    setRouteScope(null);
    await db.delete(schema.authAttempts).where(eq(schema.authAttempts.kind, KIND));
  });

  const call = () =>
    POST(jsonRequest("POST", "/api/auth/change-password", { currentPassword: "guess", newPassword: `New-${randomUUID()}-9!` }));

  it("AUT-03: refuses with 429 + Retry-After past the per-identifier limit", async () => {
    setRouteScope(adminScope(randomUUID()));

    for (let i = 0; i < CHANGE_PASSWORD_THROTTLE.perIdentifier.limit; i++) {
      expect((await call()).status).toBe(401); // reauth_failed — admitted, wrong current password
    }

    const blocked = await call();
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    const body = await blocked.json();
    expect(body.code).toBe("too_many_requests");
    expect(body.traceId).toBeTruthy();
  });

  it("AUT-03/SEC-05: the throttle key is the caller's own (lowercased) email, kind change_password", async () => {
    setRouteScope(adminScope(randomUUID()));
    await call();

    const rows = await db
      .select({ identifier: schema.authAttempts.identifier })
      .from(schema.authAttempts)
      .where(eq(schema.authAttempts.kind, KIND));
    expect(rows).toHaveLength(1);
    expect(rows[0].identifier).toBe(MOCK_EMAIL.toLowerCase());
  });
});
