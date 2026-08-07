import { describe, it, expect, vi, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { AI_CREDENTIAL_TEST_THROTTLE } from "@/lib/auth/throttle";
import type * as ScopeContextModule from "@/lib/scope-context";
import { adminScope, jsonRequest, scopeContextMock, setRouteScope } from "./_route-harness";

// WP-AI-GUARD / AUT-03 (audit R-60): the settings "test connection" action makes a live provider
// call on the tenant's BYO key and was unthrottled. This drives the REAL route + throttle store
// against the DB and proves the reserve -> snapshot -> 429 wiring. No provider is ever called:
// with no key configured, testAiCredential short-circuits (not_configured / no_key) before any
// generateText, so the 5 admitted calls are 200s with test.ok=false. Self-skips without DATABASE_URL.
vi.mock("@/lib/scope-context", async (orig) => scopeContextMock(await orig<typeof ScopeContextModule>()));

const { POST } = await import("@/app/api/settings/ai/route");

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const KIND = "ai_credential_test";

suite("POST /api/settings/ai action:test — throttle (WP-AI-GUARD)", () => {
  const db = getDb();

  afterEach(async () => {
    setRouteScope(null);
    await db.delete(schema.authAttempts).where(eq(schema.authAttempts.kind, KIND));
  });

  const callTest = () => POST(jsonRequest("POST", "/api/settings/ai", { action: "test" }));

  it("AUT-03: refuses with 429 + Retry-After past the per-tenant limit", async () => {
    setRouteScope(adminScope(randomUUID()));

    for (let i = 0; i < AI_CREDENTIAL_TEST_THROTTLE.perIdentifier.limit; i++) {
      const res = await callTest();
      expect(res.status).toBe(200); // admitted; testAiCredential short-circuits (no key), no provider call
      expect((await res.json()).test.ok).toBe(false);
    }

    const blocked = await callTest();
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    const body = await blocked.json();
    expect(body.code).toBe("too_many_requests");
    expect(body.traceId).toBeTruthy();
  });

  it("PRN-08: the throttle key is the caller's tenant, kind ai_credential_test", async () => {
    const tenantId = randomUUID();
    setRouteScope(adminScope(tenantId));
    await callTest();

    const rows = await db
      .select({ identifier: schema.authAttempts.identifier })
      .from(schema.authAttempts)
      .where(eq(schema.authAttempts.kind, KIND));
    expect(rows).toHaveLength(1);
    expect(rows[0].identifier).toBe(tenantId);
  });

  it("PRN-08: a different tenant has its own budget — one exhausted tenant does not block another", async () => {
    const exhausted = randomUUID();
    setRouteScope(adminScope(exhausted));
    for (let i = 0; i < AI_CREDENTIAL_TEST_THROTTLE.perIdentifier.limit + 1; i++) await callTest();
    expect((await callTest()).status).toBe(429);

    setRouteScope(adminScope(randomUUID())); // fresh tenant
    expect((await callTest()).status).toBe(200);
  });
});
