import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { detectProfile } from "@/modules/sources";
import { loadProfilesForDetection } from "@/modules/sources/profile-store";
import { runUpload } from "@/modules/run/run-upload";
import { findDuplicateUpload } from "@/modules/run/queries";
import { RequestInProgressError } from "@/lib/idempotency-db";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { MAX_UPLOAD_ROWS, exceedsBodyLimit, parseContentLength } from "@/lib/upload-guard";
import { jsonOk, jsonError, jsonServerError, newTraceId } from "@/lib/http";
import { NextResponse } from "next/server";
import { requireCapabilityResponse } from "@/lib/authz";

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
    return jsonOk({
      result: "unrecognized",
      profileName: base?.name ?? null,
      diff: detected.diff ?? null,
    });
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    if (e instanceof RequestInProgressError) return jsonError("in_progress", "This upload is already being processed.", 409);
    return jsonServerError("process_failed", "Processing failed.", { message: e instanceof Error ? e.message : String(e) });
  }
}
