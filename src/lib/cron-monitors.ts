// ACT-05 (ADR-0032): the Sentry cron-monitor table, keyed by the route path Vercel
// schedules. Declaring the schedule here (rather than only in the Sentry UI) means the
// monitor is upserted from code and a `tests/unit/cron-monitors.test.ts` drift test can
// prove it still matches vercel.json — a monitor expecting the wrong schedule is worse
// than no monitor, because it alerts on nothing while looking healthy.
//
// Why this matters beyond missed digests: drain-outbox also releases held imports
// (ADR-0026) and retention-sweep purges consumer PII (ADR-0025 / LGL-02). A silently
// dead scheduler has no error to catch — the absence IS the failure.

import type * as Sentry from "@sentry/nextjs";

// @sentry/nextjs does not re-export the MonitorConfig type, so derive it from the
// function we actually call — it cannot drift from the SDK, and it keeps us off
// @sentry/core, which is only a transitive dependency here.
type MonitorConfig = NonNullable<Parameters<typeof Sentry.withMonitor>[2]>;

export type CronMonitor = {
  /** Stable Sentry monitor identity. Changing it orphans the monitor's history. */
  slug: string;
  /** Crontab expression — MUST equal this path's `schedule` in vercel.json. */
  schedule: string;
  /** Minutes a check-in may be late before Sentry calls it missed. */
  checkinMargin: number;
  /** Minutes a run may take before Sentry calls it stuck (routes cap at maxDuration=60s). */
  maxRuntime: number;
};

export const CRON_MONITORS: Record<string, CronMonitor> = {
  "/api/cron/drain-outbox": {
    slug: "drain-outbox",
    schedule: "*/5 * * * *",
    checkinMargin: 2,
    maxRuntime: 5,
  },
  "/api/cron/retention-sweep": {
    slug: "retention-sweep",
    schedule: "0 3 * * *",
    checkinMargin: 10,
    maxRuntime: 5,
  },
};

// Upsert shape for Sentry.withMonitor — the monitor is defined from code, so it cannot
// silently disagree with the table above (and therefore with vercel.json).
export function monitorConfig(m: CronMonitor): MonitorConfig {
  return {
    schedule: { type: "crontab", value: m.schedule },
    checkinMargin: m.checkinMargin,
    maxRuntime: m.maxRuntime,
  };
}
