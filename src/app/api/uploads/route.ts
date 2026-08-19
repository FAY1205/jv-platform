import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { detectProfile } from "@/modules/sources";
import { loadProfilesForDetection } from "@/modules/sources/profile-store";
import { runUpload } from "@/modules/run/run-upload";
import { notifyImportFailed } from "@/modules/notify/events";
import { findDuplicateUpload } from "@/modules/run/queries";
import { RequestInProgressError } from "@/lib/idempotency-db";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { MAX_UPLOAD_ROWS, exceedsBodyLimit, parseContentLength } from "@/lib/upload-guard";
import { jsonOk, jsonError, jsonServerError, newTraceId } from "@/lib/http";
import { NextResponse } from "next/server";
import { requireCapabilityResponse } from "@/lib/authz";
import { logError } from "@/lib/observability";

// F-86: bound the serverless function's runtime for a large-run process.
export const maxDuration = 60;

// POST /api/uploads — detect the file's Source Profile (ING-02/08) and either process it
// (exact match), hard-block a genuinely-missing required column, or report an unrecognized
// file back with the columns that are off (ADR-0039: no in-app remap — a new format is added
// in code by a developer; we still never silently re-guess a changed format).
const BodySchema = z.object({
  filename: z.string().min(1).max(255),
  headers: z.array(z.string()).min(1),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(MAX_UPLOAD_ROWS), // SEC-03 row cap
  idempotencyKey: z.string().min(8).max(200).optional(),
  // ADR-0038: SHA-256 fingerprint of the raw file bytes, for the duplicate-file warn.
  contentHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  // Set when the admin explicitly chose "Import anyway" on the duplicate-file warning.
  confirmDuplicate: z.boolean().optional(),
});

export async function POST(req: Request) {
  if (!assertCsrf(req, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  // F-86: reject an oversize body from its Content-Length before parsing it into memory.
  if (exceedsBodyLimit(parseContentLength(req.headers.get("content-length")))) {
    return jsonError("payload_too_large", "That upload is too large to process.", 413);
  }
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return jsonError("invalid_body", "Malformed upload payload.", 400);
  }

  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "ingest.run");
    if (gate) return gate;

    const db = getDb();
    const profiles = await loadProfilesForDetection(db, scope);
    const detected = detectProfile(body.headers, profiles);
    const origin = new URL(req.url).origin;

    if (detected.status === "exact" && detected.profile) {
      // ADR-0038: with dedup retired, re-importing the same file would duplicate and
      // redistribute every lead — so an identical file (same content hash) warns first.
      // Warn-and-allow, never block: `confirmDuplicate` pushes through deliberately.
      if (body.contentHash && !body.confirmDuplicate) {
        const prior = await findDuplicateUpload(scope, body.contentHash);
        if (prior) {
          return jsonOk({ result: "duplicate_file", priorRef: prior.refId, priorDate: prior.createdAt });
        }
      }
      const res = await runUpload(scope, {
        profile: detected.profile,
        filename: body.filename,
        rows: body.rows,
        origin,
        idempotencyKey: body.idempotencyKey,
        contentHash: body.contentHash ?? null,
      });
      return jsonOk({ result: "processed", ...res });
    }

    // ING-08: a genuinely-missing required column with nothing to remap → hard block.
    if (detected.status === "missing_required" && detected.missingRequired?.length) {
      // WP-NF2 NTF-11 `import_result` (failure). ING-08's loud-failure pairing: a refused
      // import is a toast that dies with the tab today, so it also gets a durable admin row.
      // Recipients INCLUDE the acting admin (§10.2) — no run_summary covers a run that never
      // happened. Best-effort (the emit swallows), so it can never turn a 422 into a 500.
      await notifyImportFailed(db, scope.tenantId, { filename: body.filename, failure: "missing_required" });
      return NextResponse.json(
        {
          code: "missing_required",
          message: `This file is missing required column(s): ${detected.missingRequired.join(", ")}. Add them and re-upload.`,
          traceId: newTraceId(),
          missingRequired: detected.missingRequired,
        },
        { status: 422 },
      );
    }

    // ING-02/08 (ADR-0039): drift or unknown → report it back with the specific columns that
    // are off. No in-app remap/confirm — but never a silent re-guess either.
    const base = detected.profile ?? null;
    // NTF-11: an unrecognized file is a FAILED import even though it answers 200 — nothing was
    // ingested and the admin has to act. Same durable record as the 422 above.
    await notifyImportFailed(db, scope.tenantId, { filename: body.filename, failure: "unrecognized" });
    return jsonOk({
      result: "unrecognized",
      profileName: base?.name ?? null,
      diff: detected.diff ?? null,
    });
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    if (e instanceof RequestInProgressError) return jsonError("in_progress", "This upload is already being processed.", 409);
    // NTF-11: the unexpected-failure leg. Deliberately NOT emitted for the auth and
    // in-progress branches above — an unauthenticated caller has no tenant to notify, and a
    // 409 replay is not a failure, it is the idempotency guard doing its job.
    //
    // `scope` is re-resolved rather than hoisted out of the try: the throw may have come FROM
    // getServerScope, in which case there is no tenant and nothing to notify. Its own failure
    // is swallowed for the same reason — a broken notification must not replace the real 500.
    await notifyUploadCrash(body.filename);
    return jsonServerError("process_failed", "Processing failed.", { message: e instanceof Error ? e.message : String(e) });
  }
}

/** The `process_failed` catch's emit, isolated so a second failure while REPORTING the first
 *  cannot escape into the response path. */
async function notifyUploadCrash(filename: string): Promise<void> {
  try {
    const scope = await getServerScope();
    await notifyImportFailed(getDb(), scope.tenantId, { filename, failure: "process_failed" });
  } catch (e) {
    // A failure while REPORTING a failure. The 500 still goes out — that is the whole point of
    // the swallow — but the swallow itself must not be silent (ADR-0014): this is the one path
    // where an admin is told nothing at all, in-app or by email, about an import that blew up,
    // so the only trace it ever leaves is this line. Ids and messages only, never seller data
    // (SEC-05); the filename is operator data, as in the notification itself.
    logError("import_result_crash_notify_failed", {
      filename,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
