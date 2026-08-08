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
  // retention-sweep only (WP-SU-11): the auth_attempts pass's result, and whether it throws.
  authAttemptsDeleted: 0,
  authAttemptsThrows: false,
  // retention-sweep only (WP-SU-13): the three sibling passes' deleted counts, and whether the
  // first one throws (to exercise the best-effort log path).
  otpChallengesDeleted: 0,
  resetTokensDeleted: 0,
  signupVerificationsDeleted: 0,
  signupCodesDeleted: 0,
  otpChallengesThrows: false,
  // retention-sweep only (WP-SU-14): the canary-safe trusted_devices pass's count, and whether it throws.
  trustedDevicesDeleted: 0,
  trustedDevicesThrows: false,
  // retention-sweep only (WP-SU-18): the notice_claims pass's count, and whether it throws.
  noticeClaimsDeleted: 0,
  noticeClaimsThrows: false,
  // F-3: how many check-in outcomes were already recorded at the instant flush() was CALLED.
  // Call order alone can't prove flush ran after withMonitor SETTLED (flush is always invoked
  // textually after withMonitor, even if a refactor dropped the await); this snapshot can.
  flushSawOutcomes: null as number | null,
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
  // withCronMonitor flushes after the check-in so the terminal envelope ships before Vercel
  // freezes the function. Snapshot how many outcomes were recorded when flush is CALLED, so a
  // test can prove flush ran after withMonitor SETTLED (F-3), not merely after it was invoked.
  flush: vi.fn(async () => {
    h.flushSawOutcomes = h.outcomes.length;
    return true;
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

// WP-SU-11: the retention route's auth_attempts pass. Mocked for the same reason as the signup
// passes above — this file proves ROUTE wiring (does the pass run, is its failure best-effort,
// does its count reach the response); the sweep's own semantics are proven against the real
// table in tests/integration/auth-attempts-retention.test.ts.
vi.mock("@/modules/retention/auth-attempts", () => ({
  sweepAuthAttempts: vi.fn(async () => {
    if (h.authAttemptsThrows) throw new Error("auth_attempts pass down");
    return { deleted: h.authAttemptsDeleted };
  }),
}));

// WP-SU-13: the retention route's four sibling-table passes. Mocked for the same reason as the
// auth_attempts pass above — this file proves ROUTE wiring (does each pass run best-effort, does its
// count reach the response); the sweeps' own semantics are proven against the real tables in
// tests/integration/auth-tables-retention.test.ts.
vi.mock("@/modules/retention/auth-tables", () => ({
  sweepOtpChallenges: vi.fn(async () => {
    if (h.otpChallengesThrows) throw new Error("otp_challenges pass down");
    return { deleted: h.otpChallengesDeleted };
  }),
  sweepResetTokens: vi.fn(async () => ({ deleted: h.resetTokensDeleted })),
  sweepSignupVerifications: vi.fn(async () => ({ deleted: h.signupVerificationsDeleted })),
  sweepSignupCodes: vi.fn(async () => ({ deleted: h.signupCodesDeleted })),
  sweepTrustedDevices: vi.fn(async () => {
    if (h.trustedDevicesThrows) throw new Error("trusted_devices pass down");
    return { deleted: h.trustedDevicesDeleted };
  }),
  sweepNoticeClaims: vi.fn(async () => {
    if (h.noticeClaimsThrows) throw new Error("notice_claims pass down");
    return { deleted: h.noticeClaimsDeleted };
  }),
}));

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
const flush = vi.mocked(Sentry.flush);
const authed = () =>
  new Request("https://example.test/api/cron/x", {
    headers: { authorization: "Bearer test-cron-secret" },
  });

// Braces matter: a concise arrow would RETURN the mock (mockClear chains), and vitest
// treats a value returned from beforeEach as a teardown hook — it would then call the
// mock itself with no args after every test.
beforeEach(() => {
  withMonitor.mockClear();
  flush.mockClear();
  h.outcomes.length = 0;
  h.flushSawOutcomes = null;
  h.dbThrows = false;
  h.tenantRows = [];
  h.reconcileThrows = false;
  h.sweepError = null;
  h.authAttemptsDeleted = 0;
  h.authAttemptsThrows = false;
  h.otpChallengesDeleted = 0;
  h.resetTokensDeleted = 0;
  h.signupVerificationsDeleted = 0;
  h.signupCodesDeleted = 0;
  h.otpChallengesThrows = false;
  h.trustedDevicesDeleted = 0;
  h.trustedDevicesThrows = false;
  h.noticeClaimsDeleted = 0;
  h.noticeClaimsThrows = false;
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
    expect(flush).toHaveBeenCalledTimes(1); // ...and the FAILED check-in ships too (finally runs on both paths)
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

  // The bug this fixes: on Vercel the function is suspended the instant GET resolves, so
  // withMonitor's buffered terminal "ok" check-in never ships and Sentry logs a false
  // "timeout check-in" for a run that returned 200 (drain-outbox did this every ~5 min).
  it("ACT-05: a completed run flushes Sentry AFTER the check-in, so the terminal check-in ships before the serverless freeze", async () => {
    const { GET } = await import("@/app/api/cron/drain-outbox/route");
    await GET(authed());

    expect(flush).toHaveBeenCalledTimes(1);
    expect(h.outcomes).toEqual([{ slug: "drain-outbox", ok: true }]);
    // flush must run after withMonitor SETTLED — the "ok" envelope is only in the buffer once
    // the callback resolved and the outcome was recorded. If a refactor dropped the `await`
    // before flush (the exact regression this guards), flush would fire with 0 outcomes.
    expect(h.flushSawOutcomes).toBe(1);
  });

  it("ACT-05: a flush failure is logged (cron_flush_failed) and does NOT change the job outcome", async () => {
    // The flush is best-effort telemetry: a degraded Sentry transport must not fail the cron.
    // But it must not fail SILENTLY either (ADR-0014) — the run still returns 200 AND leaves a
    // first-party trace so a persistently-lost check-in is diagnosable.
    flush.mockRejectedValueOnce(new Error("sentry transport down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/cron/drain-outbox/route");
    const res = await GET(authed());

    expect(res.status).toBe(200);
    expect(h.outcomes).toEqual([{ slug: "drain-outbox", ok: true }]);
    const line = errSpy.mock.calls
      .map((c) => c[0] as string)
      .find((l) => typeof l === "string" && l.includes("cron_flush_failed"));
    expect(line).toBeDefined();
    expect(JSON.parse(line!)).toMatchObject({ code: "cron_flush_failed" });
    errSpy.mockRestore();
  });

  it("ACT-05: an unauthorized call does NOT check in (a 401 must not look like a healthy run)", async () => {
    const { GET } = await import("@/app/api/cron/drain-outbox/route");
    const res = await GET(new Request("https://example.test/api/cron/x"));

    expect(res.status).toBe(401);
    expect(withMonitor).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled(); // no check-in happened, so there is nothing to flush
  });

  // ── WP-SU-11 (ADR-0010): the auth_attempts pass hung off the daily retention sweep. ──

  it("WP-SU-11: retention-sweep runs the auth_attempts pass and reports what it deleted", async () => {
    h.authAttemptsDeleted = 42;
    const { GET } = await import("@/app/api/cron/retention-sweep/route");
    const res = await GET(authed());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ code: "ok", authAttempts: 42 });
    expect(h.outcomes).toEqual([{ slug: "retention-sweep", ok: true }]);
  });

  it("WP-SU-11: a failing auth_attempts pass is best-effort — it logs, and does NOT fail the PII purge's check-in", async () => {
    // Deliberately NOT the item-L1 treatment the signup reconcile pass gets. The check-in on this
    // monitor answers "did the LGL-02 consumer-PII purge run"; failing it because a data-minimisation
    // pass errored would raise a legal-grade alarm for a hygiene problem and, worse, would mark a
    // purge that DID run as failed. The dedicated logError code is the alert instead (ADR-0032).
    h.authAttemptsThrows = true;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/cron/retention-sweep/route");
    const res = await GET(authed());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ code: "ok", authAttempts: 0 });
    expect(h.outcomes).toEqual([{ slug: "retention-sweep", ok: true }]);

    const line = errSpy.mock.calls
      .map((c) => c[0] as string)
      .find((l) => typeof l === "string" && l.includes("cron_auth_attempts_sweep_failed"));
    expect(line).toBeDefined();
    expect(JSON.parse(line!)).toMatchObject({ code: "cron_auth_attempts_sweep_failed" });
    errSpy.mockRestore();
  });

  // ── WP-SU-13 (ADR-0010): the four auth SIBLING-table passes on the same daily sweep. ──

  it("WP-SU-13: retention-sweep runs the three sibling passes and reports what each deleted", async () => {
    h.otpChallengesDeleted = 1;
    h.resetTokensDeleted = 2;
    h.signupVerificationsDeleted = 3;
    h.signupCodesDeleted = 4;
    const { GET } = await import("@/app/api/cron/retention-sweep/route");
    const res = await GET(authed());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      code: "ok",
      otpChallenges: 1,
      resetTokens: 2,
      signupVerifications: 3,
      signupCodes: 4,
    });
    expect(h.outcomes).toEqual([{ slug: "retention-sweep", ok: true }]);
  });

  it("WP-SU-13: a failing sibling pass is best-effort — logs its code, does NOT fail the PII purge check-in", async () => {
    h.otpChallengesThrows = true;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/cron/retention-sweep/route");
    const res = await GET(authed());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ code: "ok", otpChallenges: 0 });
    expect(h.outcomes).toEqual([{ slug: "retention-sweep", ok: true }]);

    const line = errSpy.mock.calls
      .map((c) => c[0] as string)
      .find((l) => typeof l === "string" && l.includes("cron_otp_challenges_sweep_failed"));
    expect(line).toBeDefined();
    expect(JSON.parse(line!)).toMatchObject({ code: "cron_otp_challenges_sweep_failed" });
    errSpy.mockRestore();
  });

  // ── WP-SU-14 (AUT-10): the canary-safe trusted_devices pass on the same daily sweep. ──

  it("WP-SU-14: retention-sweep runs the trusted_devices pass and reports what it deleted", async () => {
    h.trustedDevicesDeleted = 7;
    const { GET } = await import("@/app/api/cron/retention-sweep/route");
    const res = await GET(authed());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ code: "ok", trustedDevices: 7 });
    expect(h.outcomes).toEqual([{ slug: "retention-sweep", ok: true }]);
  });

  it("WP-SU-14: a failing trusted_devices pass is best-effort — logs its code, does NOT fail the PII purge check-in", async () => {
    h.trustedDevicesThrows = true;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/cron/retention-sweep/route");
    const res = await GET(authed());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ code: "ok", trustedDevices: 0 });
    expect(h.outcomes).toEqual([{ slug: "retention-sweep", ok: true }]);

    const line = errSpy.mock.calls
      .map((c) => c[0] as string)
      .find((l) => typeof l === "string" && l.includes("cron_trusted_devices_sweep_failed"));
    expect(line).toBeDefined();
    expect(JSON.parse(line!)).toMatchObject({ code: "cron_trusted_devices_sweep_failed" });
    errSpy.mockRestore();
  });

  // ── WP-SU-18: the notice_claims pass (raw login/OTP email PII) on the same daily sweep. ──

  it("WP-SU-18: retention-sweep runs the notice_claims pass and reports what it deleted", async () => {
    h.noticeClaimsDeleted = 4;
    const { GET } = await import("@/app/api/cron/retention-sweep/route");
    const res = await GET(authed());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ code: "ok", noticeClaims: 4 });
    expect(h.outcomes).toEqual([{ slug: "retention-sweep", ok: true }]);
  });

  it("WP-SU-18: a failing notice_claims pass is best-effort — logs its code, does NOT fail the PII purge check-in", async () => {
    h.noticeClaimsThrows = true;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/cron/retention-sweep/route");
    const res = await GET(authed());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ code: "ok", noticeClaims: 0 });
    expect(h.outcomes).toEqual([{ slug: "retention-sweep", ok: true }]);

    const line = errSpy.mock.calls
      .map((c) => c[0] as string)
      .find((l) => typeof l === "string" && l.includes("cron_notice_claims_sweep_failed"));
    expect(line).toBeDefined();
    expect(JSON.parse(line!)).toMatchObject({ code: "cron_notice_claims_sweep_failed" });
    errSpy.mockRestore();
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
