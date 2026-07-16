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
        return [];
      },
    }),
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
});
