import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { detectProfile } from "@/modules/sources";
import { loadProfilesForDetection } from "@/modules/sources/profile-store";
import { suggestMapping } from "@/modules/sources/mapping";
import { CANONICAL_FIELDS } from "@/modules/sources/types";
import { runUpload } from "@/modules/run/run-upload";
import { RequestInProgressError } from "@/lib/idempotency-db";
import { assertCsrf, authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { MAX_UPLOAD_ROWS, exceedsBodyLimit, parseContentLength } from "@/lib/upload-guard";
import { jsonOk, jsonError, jsonServerError, newTraceId } from "@/lib/http";
import { NextResponse } from "next/server";

// F-86: bound the serverless function's runtime for a large-run process.
export const maxDuration = 60;

// POST /api/uploads — detect the file's Source Profile (ING-02/08) and either process
// it (exact match) or return the drift/unknown mapping payload so the client can show
// the confirm-mapping screen. Confirmed mappings go to POST /api/uploads/confirm.
const BodySchema = z.object({
  filename: z.string().min(1).max(255),
  headers: z.array(z.string()).min(1),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(MAX_UPLOAD_ROWS), // SEC-03 row cap
  idempotencyKey: z.string().min(8).max(200).optional(),
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
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;

    const db = getDb();
    const profiles = await loadProfilesForDetection(db, scope);
    const detected = detectProfile(body.headers, profiles);
    const origin = new URL(req.url).origin;

    if (detected.status === "exact" && detected.profile) {
      const res = await runUpload(scope, {
        profile: detected.profile,
        filename: body.filename,
        rows: body.rows,
        origin,
        idempotencyKey: body.idempotencyKey,
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

    // ING-02/08: drift or unknown → surface a mapping to confirm (never silently guess).
    const base = detected.profile ?? null;
    return jsonOk({
      result: "needs_mapping",
      kind: detected.status, // "drift" | "unknown"
      baseProfileId: base?.id ?? null,
      baseProfileName: base?.name ?? null,
      strictness: base?.strictness ?? "flexible",
      uploadHeaders: body.headers,
      suggestedMapping: suggestMapping(base, body.headers),
      diff: detected.diff ?? null,
      missingRequired: detected.missingRequired ?? [],
      requiredColumns: base?.requiredColumns ?? [],
      canonicalFields: CANONICAL_FIELDS,
    });
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    if (e instanceof RequestInProgressError) return jsonError("in_progress", "This upload is already being processed.", 409);
    return jsonServerError("process_failed", "Processing failed.", { message: e instanceof Error ? e.message : String(e) });
  }
}
