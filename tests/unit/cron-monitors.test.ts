import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as Sentry from "@sentry/nextjs";
import { CRON_MONITORS, monitorConfig, withCronMonitor } from "@/lib/cron-monitors";

// NOTE: this file deliberately does NOT mock @sentry/nextjs — see the last test.

// ACT-05 (ADR-0032): each scheduled job checks in with Sentry, which alerts when a
// check-in is missed. The alert is only trustworthy if Sentry expects the SAME
// schedule Vercel actually fires on — so the monitor table and vercel.json must not
// drift. This test is the thing that keeps them honest.
const vercel = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as {
  crons: { path: string; schedule: string }[];
};

describe("ACT-05: cron monitors match the real Vercel schedule", () => {
  it("ACT-05: every scheduled cron in vercel.json has a monitor with the identical schedule", () => {
    for (const cron of vercel.crons) {
      const monitor = CRON_MONITORS[cron.path];
      expect(monitor, `no Sentry monitor declared for ${cron.path}`).toBeDefined();
      expect(monitor.schedule, `schedule drift for ${cron.path}`).toBe(cron.schedule);
    }
  });

  it("ACT-05: declares no monitor for a path Vercel does not schedule (no orphan alerts)", () => {
    const scheduled = vercel.crons.map((c) => c.path);
    expect(Object.keys(CRON_MONITORS).sort()).toEqual(scheduled.sort());
  });

  it("ACT-05: every monitor has a stable, non-empty slug", () => {
    const slugs = Object.values(CRON_MONITORS).map((m) => m.slug);
    expect(slugs.every((s) => s.length > 0)).toBe(true);
    expect(new Set(slugs).size).toBe(slugs.length); // slugs identify the monitor — no collisions
  });

  // WP-SU-2: pins the signup-sweep monitor's declared shape so a future edit can't silently
  // drift it from what vercel.json actually schedules (the two generic tests above already
  // prove no path is missing a monitor; this proves THIS monitor's fields are the exact
  // owner-approved values from the WP-SU-2 brief, not just "defined").
  it("WP-SU-2: signup-sweep monitor matches the owner-approved slug/schedule/margins", () => {
    expect(CRON_MONITORS["/api/cron/signup-sweep"]).toEqual({
      slug: "signup-sweep",
      schedule: "30 3 * * *",
      checkinMargin: 10,
      maxRuntime: 5,
    });
  });

  // The wiring tests mock Sentry, so they prove we CALL withMonitor — not that the real
  // one behaves. Everywhere without a DSN (dev, CI, preview) Sentry is uninitialised, and
  // both cron routes now run their entire body inside withMonitor. If an uninitialised
  // withMonitor ever swallowed the callback or threw, both jobs would break where we are
  // least likely to notice. This pins that behaviour against an SDK upgrade.
  it("ACT-05: the REAL uninitialised withMonitor still runs the job and returns its value", async () => {
    const result = await Sentry.withMonitor(
      "unit-test-probe",
      async () => "job ran",
      monitorConfig(CRON_MONITORS["/api/cron/drain-outbox"]),
    );
    expect(result).toBe("job ran");
  });

  // Same guarantee for the flush wrapper the routes actually call. With no DSN, Sentry.flush()
  // resolves immediately against no client, so the added flush must be a harmless no-op that
  // neither throws nor swallows the job's return value — proven against the REAL SDK, not a mock.
  it("ACT-05: the REAL uninitialised withCronMonitor still runs the job and returns its value", async () => {
    const result = await withCronMonitor(CRON_MONITORS["/api/cron/drain-outbox"], async () => "job ran");
    expect(result).toBe("job ran");
  });
});
