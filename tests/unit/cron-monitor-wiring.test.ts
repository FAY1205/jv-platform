import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { CRON_MONITORS } from "@/lib/cron-monitors";

// ACT-05 (ADR-0032): the drift test proves the monitor TABLE is right; this proves each
// route actually checks in through it. A correct table nobody calls alerts on nothing.
// This mock mirrors the REAL withMonitor's status semantics, verified against
// @sentry/core's source: the check-in is finished "ok" whenever the callback RESOLVES
// (the resolved value is never inspected) and "error" only when it THROWS. Testing
// against those semantics is the whole point — a pass-through mock would happily agree
// that a totally failed run is healthy.
// vi.hoisted: vi.mock factories are lifted above imports, so their shared state must be too.
const h = vi.hoisted(() => ({
  outcomes: [] as { slug: string; ok: boolean }[],
  dbThrows: false,
  // signup-sweep only: rows the tenant-list read returns, whether the merged dropped-signup
  // reconcile pass throws, and an optional per-tenant sweep error (to exercise item-4 codes).
  tenantRows: [] as { id: string }[],
  reconcileThrows: false,
  sweepError: null as unknown,
}));

vi.mock("@sentry/nextjs", () => ({
  withMonitor: vi.fn(async (slug: string, cb: () => unknown) => {
    try {
      const result = await cb();
      h.outcomes.push({ slug, ok: true });
      return result;
    } catch (e) {
      h.outcomes.push({ slug, ok: false });
      throw e;
    }
  }),
  captureMessage: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  env: { CRON_SECRET: "test-cron-secret", APP_URL: "https://example.test", SENTRY_DSN: undefined },
}));

// No tenants ⇒ the per-tenant work loop is skipped; we only care about the wrapping.
// dbThrows simulates the total-failure case: the job fires but cannot even list tenants.
vi.mock("@/db", () => ({
  getDb: () => ({
    select: () => ({
      from: async () => {
        if (h.dbThrows) throw new Error("db down");
        return h.tenantRows;
      },
    }),
  }),
}));

// signup-sweep pulls in the service-role admin client and the sweep module. We prove the ROUTE
// wiring (auth gate, withMonitor, throw semantics, per-tenant error classification), not the
// sweep internals (integration tests cover those), so both are mocked. reconcileDroppedSignups
// can be made to throw to pin item L1: a broken reconcile pass must FAIL the check-in, not be
// swallowed by the per-tenant catch. sweepAbandonedSignups can be made to throw a shaped error
// to pin item 4's 23503 (FK-blocked) vs generic per-tenant classification.
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin: () => ({}) }));

vi.mock("@/modules/retention/signup-sweep", () => ({
  sweepAbandonedSignups: vi.fn(async () => {
    if (h.sweepError) throw h.sweepError;
    return { purged: 0, skipped: 0 };
  }),
  reconcileDroppedSignups: vi.fn(async () => {
    if (h.reconcileThrows) throw new Error("dropped-signup pass down");
    return { orphans: 0, partials: 0 };
  }),
}));

const withMonitor = vi.mocked(Sentry.withMonitor);
const authed = () =>
  new Request("https://example.test/api/cron/x", {
    headers: { authorization: "Bearer test-cron-secret" },
  });

// Braces matter: a concise arrow would RETURN the mock (mockClear chains), and vitest
// treats a value returned from beforeEach as a teardown hook — it would then call the
// mock itself with no args after every test.
beforeEach(() => {
  withMonitor.mockClear();
  h.outcomes.length = 0;
  h.dbThrows = false;
  h.tenantRows = [];
  h.reconcileThrows = false;
  h.sweepError = null;
});

describe("ACT-05: each cron route checks in with its Sentry monitor", () => {
  it("ACT-05: drain-outbox runs its work inside withMonitor with the declared slug + schedule", async () => {
    const { GET } = await import("@/app/api/cron/drain-outbox/route");
    const res = await GET(authed());

    expect(res.status).toBe(200);
    expect(withMonitor).toHaveBeenCalledTimes(1);
    const [slug, , config] = withMonitor.mock.calls[0];
    const declared = CRON_MONITORS["/api/cron/drain-outbox"];
    expect(slug).toBe(declared.slug);
    expect(config).toMatchObject({ schedule: { type: "crontab", value: declared.schedule } });
  });

  it("ACT-05: retention-sweep runs its work inside withMonitor with the declared slug + schedule", async () => {
    const { GET } = await import("@/app/api/cron/retention-sweep/route");
    const res = await GET(authed());

    expect(res.status).toBe(200);
    expect(withMonitor).toHaveBeenCalledTimes(1);
    const [slug, , config] = withMonitor.mock.calls[0];
    const declared = CRON_MONITORS["/api/cron/retention-sweep"];
    expect(slug).toBe(declared.slug);
    expect(config).toMatchObject({ schedule: { type: "crontab", value: declared.schedule } });
  });

  // The motivating case in ADR-0032: the job FIRES but does nothing. A missed check-in
  // catches "never ran"; this catches "ran and achieved nothing". Without it the
  // retention sweep can fail to purge any PII while the monitor dashboard shows green —
  // the precise false sense of safety this WP was built to remove.
  it("ACT-05: drain-outbox reports a FAILED check-in when the run cannot list tenants", async () => {
    h.dbThrows = true;
    const { GET } = await import("@/app/api/cron/drain-outbox/route");
    const res = await GET(authed());

    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("cron_drain_failed"); // envelope unchanged
    expect(h.outcomes).toEqual([{ slug: "drain-outbox", ok: false }]); // ...and Sentry knows
  });

  it("ACT-05: retention-sweep reports a FAILED check-in when the run cannot list tenants", async () => {
    h.dbThrows = true;
    const { GET } = await import("@/app/api/cron/retention-sweep/route");
    const res = await GET(authed());

    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("cron_retention_failed");
    expect(h.outcomes).toEqual([{ slug: "retention-sweep", ok: false }]);
  });

  it("ACT-05: a successful run reports a healthy check-in", async () => {
    const { GET } = await import("@/app/api/cron/drain-outbox/route");
    await GET(authed());
    expect(h.outcomes).toEqual([{ slug: "drain-outbox", ok: true }]);
  });

  it("ACT-05: an unauthorized call does NOT check in (a 401 must not look like a healthy run)", async () => {
    const { GET } = await import("@/app/api/cron/drain-outbox/route");
    const res = await GET(new Request("https://example.test/api/cron/x"));

    expect(res.status).toBe(401);
    expect(withMonitor).not.toHaveBeenCalled();
  });

  // ── WP-SU-2 (item A): the signup-sweep route wiring, mirroring the retention-sweep block. ──

  it("WP-SU-2: signup-sweep runs its work inside withMonitor with the declared slug + schedule", async () => {
    const { GET } = await import("@/app/api/cron/signup-sweep/route");
    const res = await GET(authed());

    expect(res.status).toBe(200);
    expect(withMonitor).toHaveBeenCalledTimes(1);
    const [slug, , config] = withMonitor.mock.calls[0];
    const declared = CRON_MONITORS["/api/cron/signup-sweep"];
    expect(slug).toBe(declared.slug);
    expect(config).toMatchObject({ schedule: { type: "crontab", value: declared.schedule } });
    expect(h.outcomes).toEqual([{ slug: "signup-sweep", ok: true }]); // healthy run ⇒ healthy check-in
  });

  it("WP-SU-2: signup-sweep reports a FAILED check-in when the run cannot list tenants", async () => {
    h.dbThrows = true;
    const { GET } = await import("@/app/api/cron/signup-sweep/route");
    const res = await GET(authed());

    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("cron_signup_sweep_failed"); // envelope unchanged
    expect(h.outcomes).toEqual([{ slug: "signup-sweep", ok: false }]); // ...and Sentry knows
  });

  it("WP-SU-2 (item L1): a thrown reconcile pass FAILS the check-in — the per-tenant best-effort catch does not swallow it", async () => {
    // A tenant is present so the per-tenant loop actually runs AND succeeds; only the merged
    // dropped-signup reconciliation pass throws. Its throw must propagate out of withMonitor
    // (failed check-in), proving it sits OUTSIDE the per-tenant try that swallows one tenant's
    // failure.
    h.tenantRows = [{ id: "tenant-1" }];
    h.reconcileThrows = true;
    const { GET } = await import("@/app/api/cron/signup-sweep/route");
    const res = await GET(authed());

    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("cron_signup_sweep_failed");
    expect(h.outcomes).toEqual([{ slug: "signup-sweep", ok: false }]);
  });

  it("WP-SU-2 (item 4): a per-tenant purge blocked by a 23503 FK violation logs cron_signup_sweep_tenant_fk_blocked", async () => {
    // drizzle wraps the driver error, so the SQLSTATE lives on `.cause.code` — the exact shape
    // pgErrorCode walks. A per-tenant failure is best-effort (logged, run continues), so the
    // route still returns 200; the DISTINCT fk-blocked code is what item 4 pins.
    h.tenantRows = [{ id: "tenant-1" }];
    h.sweepError = { cause: { code: "23503" } };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/cron/signup-sweep/route");
    const res = await GET(authed());

    expect(res.status).toBe(200);
    const line = errSpy.mock.calls
      .map((c) => c[0] as string)
      .find((l) => typeof l === "string" && l.includes("cron_signup_sweep_tenant"));
    expect(line).toBeDefined();
    expect(JSON.parse(line!)).toMatchObject({ code: "cron_signup_sweep_tenant_fk_blocked", tenantId: "tenant-1" });
    errSpy.mockRestore();
  });

  it("WP-SU-2 (item 4): a per-tenant purge failing for a NON-FK reason logs the generic cron_signup_sweep_tenant_failed", async () => {
    h.tenantRows = [{ id: "tenant-1" }];
    h.sweepError = new Error("connection reset"); // no 23503 anywhere in the cause chain
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/cron/signup-sweep/route");
    const res = await GET(authed());

    expect(res.status).toBe(200);
    const line = errSpy.mock.calls
      .map((c) => c[0] as string)
      .find((l) => typeof l === "string" && l.includes("cron_signup_sweep_tenant"));
    expect(line).toBeDefined();
    expect(JSON.parse(line!)).toMatchObject({ code: "cron_signup_sweep_tenant_failed", tenantId: "tenant-1" });
    errSpy.mockRestore();
  });

  it("WP-SU-2: an unauthorized signup-sweep call does NOT check in", async () => {
    const { GET } = await import("@/app/api/cron/signup-sweep/route");
    const res = await GET(new Request("https://example.test/api/cron/x"));

    expect(res.status).toBe(401);
    expect(withMonitor).not.toHaveBeenCalled();
  });
});
