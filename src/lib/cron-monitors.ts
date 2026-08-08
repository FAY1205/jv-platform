// ACT-05 (ADR-0032): the Sentry cron-monitor table, keyed by the route path Vercel
// schedules. Declaring the schedule here (rather than only in the Sentry UI) means the
// monitor is upserted from code and a `tests/unit/cron-monitors.test.ts` drift test can
// prove it still matches vercel.json — a monitor expecting the wrong schedule is worse
// than no monitor, because it alerts on nothing while looking healthy.
//
// Why this matters beyond missed digests: drain-outbox also releases held imports
// (ADR-0026) and retention-sweep purges consumer PII (ADR-0025 / LGL-02). A silently
// dead scheduler has no error to catch — the absence IS the failure.

import * as Sentry from "@sentry/nextjs";
import { logError } from "@/lib/observability";

// ADR-0032: withCronMonitor below pulls the Sentry SDK in at RUNTIME (this was a type-only
// import until the flush wrapper landed), so importing this module from client code would
// bundle Sentry into the browser — the consumer-PII leak ADR-0031 forbids. It reads like a
// plain config table, so that mistake is easy to make; fail loudly, mirroring
// @/lib/observability (which this also imports, so the guard also holds transitively — this
// is the explicit backstop, not a substitute for it).
if (typeof window !== "undefined") {
  throw new Error("ADR-0032: @/lib/cron-monitors is server-only — never import it from client code.");
}

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
  "/api/cron/signup-sweep": {
    slug: "signup-sweep",
    schedule: "30 3 * * *",
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

// Run a cron job's work inside its Sentry check-in, then FLUSH before returning.
//
// Vercel suspends the function the instant the handler's promise settles. withMonitor emits
// the terminal "ok"/"error" check-in when `work` settles, but that envelope is only BUFFERED —
// on a serverless freeze it never ships, so Sentry waits out maxRuntime and reports a "timeout
// check-in" for a run that actually SUCCEEDED. (drain-outbox did exactly this every ~5 min:
// the job ran and returned 200, but the monitor was red — an ACT-05 FALSE alarm that, left
// alone, trains the owner to ignore the one dashboard that is supposed to catch a dead
// scheduler.) A bounded, explicit flush makes the terminal check-in actually reach Sentry.
//
// flush is best-effort: a slow or unreachable Sentry transport must never fail or delay the
// job, and when Sentry is uninitialised (dev/test/CI/preview, no DSN) it is a no-op that
// resolves immediately. The finally runs on BOTH paths, so a failed run's "error" check-in
// ships too; the caller still sees withMonitor's own resolution/rejection unchanged.
export async function withCronMonitor<T>(m: CronMonitor, work: () => Promise<T>): Promise<T> {
  try {
    return await Sentry.withMonitor(m.slug, work, monitorConfig(m));
  } finally {
    try {
      await Sentry.flush(2000);
    } catch (e) {
      // Telemetry delivery must never affect the job's outcome — but a persistently failing
      // flush silently reintroduces the very lost-check-in this wrapper exists to close, so
      // leave a first-party trace. logError never throws and is console-only without a DSN.
      logError("cron_flush_failed", { slug: m.slug, message: e instanceof Error ? e.message : String(e) });
    }
  }
}
