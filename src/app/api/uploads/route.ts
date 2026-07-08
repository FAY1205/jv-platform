import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { detectProfile } from "@/modules/sources";
import { SEED_SOURCE_PROFILES } from "@/modules/sources/seed-profiles";
import { loadRunRules } from "@/modules/run/rules";
import { processRun } from "@/modules/run/process";
import { DrizzleRunStore } from "@/modules/run/store";
import { withDbIdempotency, RequestInProgressError } from "@/lib/idempotency-db";
import { assertCsrf, authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { enqueueRunDigests, drainOutbox } from "@/modules/notify/outbox";
import { loadNotificationPrefs } from "@/modules/notify/prefs";
import { storeExport } from "@/modules/export/storage";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { adminAllowlist } from "@/lib/env";
import { MAX_UPLOAD_ROWS } from "@/lib/upload-guard";
import { logError } from "@/lib/observability";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { jsonOk, jsonError, newTraceId } from "@/lib/http";

// POST /api/uploads — process a parsed weekly file end-to-end (WP-020). The client parses
// the workbook off the main thread (FEP-06) and posts { headers, rows }; the server detects
// the Source Profile, loads the tenant's rules, runs the pipeline, and persists the run.
const BodySchema = z.object({
  filename: z.string().min(1).max(255),
  headers: z.array(z.string()).min(1),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(MAX_UPLOAD_ROWS), // SEC-03 row cap
  idempotencyKey: z.string().min(8).max(200).optional(),
});

/** Admin recipients for the run-summary email: the acting admin + the env allowlist. */
async function resolveAdminEmails(db: ReturnType<typeof getDb>, tenantId: string, userId: string): Promise<string[]> {
  const [me] = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return [...(me?.email ? [me.email] : []), ...adminAllowlist];
}

export async function POST(req: Request) {
  if (!assertCsrf(req, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return jsonError("invalid_body", "Malformed upload payload.", 400);
  }

  // ING-02/08: exact signature auto-applies; anything else is surfaced, never silently guessed.
  const detected = detectProfile(body.headers, SEED_SOURCE_PROFILES);
  if (detected.status !== "exact" || !detected.profile) {
    return jsonError(
      "format_unrecognized",
      `File format not recognized (${detected.status}). The mapping/drift screen is coming; for now upload an InvestorFuse export.`,
      409,
    );
  }
  const profile = detected.profile;

  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const db = getDb();
    const { rules, snapshotParts } = await loadRunRules(scope);
    const key = body.idempotencyKey ?? newTraceId();
    const year = new Date().getUTCFullYear();

    const origin = new URL(req.url).origin;
    const { response } = await withDbIdempotency(db, scope.tenantId, key, async () => {
      const store = new DrizzleRunStore(db);
      const result = await processRun(
        {
          tenantId: scope.tenantId,
          filename: body.filename,
          rows: body.rows,
          profile,
          rules,
          snapshotInput: { sourceProfile: { id: profile.id, version: profile.version }, ...snapshotParts },
          year,
          colorCoding: true,
        },
        { store, clock: () => new Date().toISOString() },
      );

      // EXP-05: store the rendered deliverable in the private bucket and record its
      // path. Best-effort — if storage hiccups, the download route regenerates.
      try {
        const path = await storeExport(getSupabaseAdmin(), {
          tenantId: scope.tenantId,
          uploadRef: result.uploadRefId,
          bytes: result.exportBytes,
        });
        await db
          .update(schema.uploads)
          .set({ storagePath: path })
          .where(and(eq(schema.uploads.tenantId, scope.tenantId), eq(schema.uploads.refId, result.uploadRefId)));
      } catch (e) {
        logError("export_store_failed", { message: e instanceof Error ? e.message : String(e) });
      }

      // NTF-01/02: enqueue per-partner + admin digests for this run. Best-effort —
      // a notification problem must never fail (or roll back) a processed upload.
      try {
        const [adminEmails, prefs] = await Promise.all([
          resolveAdminEmails(db, scope.tenantId, scope.userId),
          loadNotificationPrefs(db, scope),
        ]);
        await enqueueRunDigests(db, scope, {
          uploadRef: result.uploadRefId,
          summary: result.summary,
          portalBaseUrl: origin,
          adminEmails,
          adminUserId: scope.userId,
          prefs,
        });
      } catch (e) {
        logError("digest_enqueue_failed", { message: e instanceof Error ? e.message : String(e) });
      }

      return { uploadRef: result.uploadRefId, summary: result.summary };
    });

    // Drain the outbox (best-effort). In dev this captures to the Sent-emails viewer;
    // in production it sends via Resend. Failures retry on the next drain (backoff).
    try {
      await drainOutbox(db, { tenantId: scope.tenantId });
    } catch (e) {
      logError("outbox_drain_failed", { message: e instanceof Error ? e.message : String(e) });
    }

    return jsonOk(response);
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    if (e instanceof RequestInProgressError) return jsonError("in_progress", "This upload is already being processed.", 409);
    return jsonError("process_failed", e instanceof Error ? e.message : "Processing failed.", 500);
  }
}
