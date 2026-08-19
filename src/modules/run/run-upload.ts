import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import type { SourceProfile } from "@/modules/sources";
import { loadRunRules } from "./rules";
import { processRun } from "./process";
import { DrizzleRunStore } from "./store";
import { withDbIdempotency } from "@/lib/idempotency-db";
import { storeExport } from "@/modules/export/storage";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enqueueRunDigests, drainOutbox } from "@/modules/notify/outbox";
import { notifyImportProcessed } from "@/modules/notify/events";
import { loadNotificationPrefs } from "@/modules/notify/prefs";
import { runListingChecks } from "@/modules/listing/run-checks";
import { adminAllowlist, env } from "@/lib/env";
import { logError } from "@/lib/observability";
import { loadColorCoding } from "@/modules/settings/export-settings";
import { newTraceId } from "@/lib/http";
import type { RunSummary } from "@/modules/analytics/run-summary";

// Shared upload processing (WP-020 + WP-028/029/032): run the pipeline for a chosen Source Profile,
// store the export, send the ADMIN run-summary now (partner digests are deferred to the release cron
// by the distribution hold), and drain — all best-effort around the run so email/storage never fail
// an upload. Both the exact-detect path and the confirmed-mapping path (ING-08) call this.

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function resolveAdminEmails(db: ReturnType<typeof getDb>, userId: string): Promise<string[]> {
  const [me] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId));
  return [...(me?.email ? [me.email] : []), ...adminAllowlist];
}

export interface RunUploadInput {
  profile: SourceProfile;
  filename: string;
  rows: readonly Record<string, unknown>[];
  idempotencyKey?: string;
  /** SHA-256 of the raw uploaded file (ADR-0038 duplicate-file warn); omitted = unknown. */
  contentHash?: string | null;
}

export async function runUpload(scope: ScopeContext, input: RunUploadInput): Promise<{ uploadRef: string; summary: RunSummary }> {
  const db = getDb();
  const { rules, snapshotParts } = await loadRunRules(scope);
  const key = input.idempotencyKey ?? newTraceId();
  const year = new Date().getUTCFullYear();

  const colorCoding = await loadColorCoding(scope); // F-39: honor the tenant setting (SET-01)
  const { response } = await withDbIdempotency(db, scope.tenantId, key, async () => {
    const store = new DrizzleRunStore(db);
    const result = await processRun(
      {
        tenantId: scope.tenantId,
        filename: input.filename,
        rows: input.rows,
        profile: input.profile,
        rules,
        snapshotInput: { sourceProfile: { id: input.profile.id, version: input.profile.version }, ...snapshotParts },
        year,
        colorCoding,
        contentHash: input.contentHash ?? null,
      },
      { store, clock: () => new Date().toISOString() },
    );

    // EXP-05: store the rendered deliverable (best-effort).
    try {
      const path = await storeExport(getSupabaseAdmin(), { tenantId: scope.tenantId, uploadRef: result.uploadRefId, bytes: result.exportBytes });
      await db.update(schema.uploads).set({ storagePath: path }).where(and(tenantWhere(schema.uploads, scope), eq(schema.uploads.refId, result.uploadRefId)));
    } catch (e) {
      logError("export_store_failed", { message: errMsg(e) });
    }

    // NTF-02/04: the ADMIN run-summary goes out now — the admin isn't a partner, and it carries the
    // true full-run summary + acting-admin context. PARTNER digests are HELD: the distribution hold
    // defers them to the release cron once the 10-min window elapses, so a within-window void reaches
    // no partner (visibility is likewise held, self-releasing). Best-effort.
    try {
      const [adminEmails, prefs] = await Promise.all([resolveAdminEmails(db, scope.userId), loadNotificationPrefs(db, scope)]);
      // C-101 (CWE-644): portalBaseUrl is env.APP_URL — the canonical origin, prod-guarded in
      // lib/env — never the uploading request's Host. These CTA links leave the system by email,
      // and the Host header is attacker-controlled input; the release cron already passed
      // env.APP_URL here, so upload-time and cron-time digests now carry identical links.
      await enqueueRunDigests(db, scope, { uploadRef: result.uploadRefId, summary: result.summary, portalBaseUrl: env.APP_URL, adminEmails, adminUserId: scope.userId, prefs, audience: "admin" });
    } catch (e) {
      logError("admin_summary_enqueue_failed", { message: errMsg(e) });
    }

    // WP-NF2 NTF-11 `import_result` (success). Inside the idempotency block ON PURPOSE: a
    // replayed upload key returns the stored response without re-running this, so a retried
    // request cannot double-notify. The acting admin is excluded — the run-summary above is
    // already their signal, and two rows about one upload in one bell is noise (§10.2).
    // Best-effort, like every sibling step in this block.
    await notifyImportProcessed(db, scope.tenantId, { uploadRef: result.uploadRefId, actorUserId: scope.userId });

    // LST-01: run the listing check (LinkOnly) after the pipeline. Best-effort; it
    // never removes leads and never blocks the export (already stored above).
    try {
      await runListingChecks(db, scope, result.uploadRefId);
    } catch (e) {
      logError("listing_check_failed", { message: errMsg(e) });
    }

    return { uploadRef: result.uploadRefId, summary: result.summary };
  });

  try {
    await drainOutbox(db, { tenantId: scope.tenantId });
  } catch (e) {
    logError("outbox_drain_failed", { message: errMsg(e) });
  }

  return response;
}
